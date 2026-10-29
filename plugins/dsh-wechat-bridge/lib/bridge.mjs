// 微信 iLink ↔ DSH 会话的桥。
//
// 两个方向：
//   微信 → DSH：iLink 长轮询收到文字 → sessionController.prompt（会自动唤醒冷会话）
//   DSH → 微信：sessionController.follow 跟着绑定的会话日志走 → turn/end 时把这一轮
//               最后几条 assistant 文字发回微信
//
// 只转发「已经在设置页绑定过」的微信对话；没绑定的对话最多收到一次提示，
// 不做任何会话注入（避免谁扫到这个机器人就能驱动你的会话）。

import { randomUUID } from 'node:crypto'
import { createWeixinApi, extractText, splitText } from './weixin-api.mjs'

const HINT_COOLDOWN_MS = 10 * 60 * 1000
const PLUGIN_VERSION = '0.1.5'
const FOLLOW_RETRY_MS = 3_000
const ACCOUNT_RETRY_MS = 3_000
const LOGIN_TTL_MS = 5 * 60 * 1000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function messageText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

function sanitizeAccount(account) {
  return {
    accountId: account.accountId,
    botId: account.botId,
    ownerUserId: account.ownerUserId,
    baseUrl: account.baseUrl,
    connectedAt: account.connectedAt,
    lastError: account.lastError || null,
  }
}

export function createBridge({ ctx, store, api = createWeixinApi(), log = () => {}, isLoopback = () => true }) {
  const attempts = new Map()
  const runtimes = new Map()
  const follows = new Map()
  const hints = new Map()
  const contextTokens = new Map()
  const pendingFromWeChat = new Map()
  const typingTickets = new Map()
  const typingLoops = new Map()
  const logs = []
  let disposed = false

  const sessionsService = () => ctx.get('sessions')
  const titleService = () => ctx.get('sessionTitle')
  const sessionController = () => {
    try {
      return ctx.sessionController || ctx.get('sessionController')
    } catch {
      return undefined
    }
  }

  function short(id) {
    return String(id || '').slice(-6)
  }

  function note(message) {
    const line = `${new Date().toISOString()} ${message}`
    logs.push(line)
    if (logs.length > 200) logs.splice(0, logs.length - 200)
    log(message)
  }

  // 阅读延迟：收到消息先停一会儿，像真的“刚看到”。
  function readDelayMs(text) {
    if (store.state.settings.readDelay === false) return 0
    const len = String(text || '').length
    return Math.min(3500, 600 + len * 90) + Math.floor(Math.random() * 400)
  }

  // 输入状态：getconfig 拿 typing_ticket，再亮几秒、灭一两秒、再亮。
  async function typingTicketFor(account, chatId, contextToken) {
    const key = `${account.accountId}:${chatId}`
    const cached = typingTickets.get(key)
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.ticket
    if (typeof api.getTypingTicket !== 'function') return null
    const ticket = await api.getTypingTicket({
      baseUrl: account.baseUrl,
      token: account.token,
      toUserId: chatId,
      contextToken,
    })
    if (ticket) typingTickets.set(key, { ticket, at: Date.now() })
    return ticket || null
  }

  function stopTyping(chatId) {
    const loop = typingLoops.get(chatId)
    if (!loop) return
    loop.stopped = true
    typingLoops.delete(chatId)
    if (loop.account && loop.ticket) {
      void api.sendTyping({
        baseUrl: loop.account.baseUrl,
        token: loop.account.token,
        toUserId: chatId,
        typingTicket: loop.ticket,
        status: 2,
      }).catch(() => {})
    }
  }

  function startTyping(account, chatId, contextToken) {
    if (store.state.settings.typingBurst === false) return
    if (typingLoops.has(chatId)) return
    const loop = { stopped: false, account: null, ticket: null }
    typingLoops.set(chatId, loop)
    void (async () => {
      const started = Date.now()
      try {
        const ticket = await typingTicketFor(account, chatId, contextToken)
        if (!ticket || loop.stopped) return
        loop.account = account
        loop.ticket = ticket
        while (!loop.stopped && Date.now() - started < 90_000) {
          await api.sendTyping({
            baseUrl: account.baseUrl,
            token: account.token,
            toUserId: chatId,
            typingTicket: ticket,
            status: 1,
          }).catch(() => {})
          await sleep(2400 + Math.floor(Math.random() * 700))
          if (loop.stopped) break
          await api.sendTyping({
            baseUrl: account.baseUrl,
            token: account.token,
            toUserId: chatId,
            typingTicket: ticket,
            status: 2,
          }).catch(() => {})
          await sleep(900 + Math.floor(Math.random() * 500))
        }
      } catch {
        // 输入状态失败不影响回复
      }
    })()
  }

  function sessionObject(sessionId) {
    try {
      return sessionsService()?.get?.(String(sessionId))
    } catch {
      return undefined
    }
  }

  function titleOf(sessionId) {
    try {
      const snapshot = titleService()?.get?.(sessionObject(sessionId) || { id: sessionId })
      const title = typeof snapshot?.title === 'string' ? snapshot.title.trim() : ''
      if (title) return title
    } catch {}
    return ''
  }

  function listSessions() {
    const seen = new Set()
    const out = []
    try {
      for (const session of sessionsService()?.list?.() || []) {
        const id = String(session?.id ?? '')
        if (!id || seen.has(id)) continue
        seen.add(id)
        out.push({
          id,
          title: titleOf(id),
          cwd: typeof session?.cwd === 'string' ? session.cwd : '',
          alive: Boolean(ctx.agents.get(id)),
        })
      }
    } catch {}
    try {
      for (const agent of ctx.agents.list() || []) {
        const id = String(agent?.id ?? '')
        if (!id || seen.has(id)) continue
        seen.add(id)
        out.push({ id, title: titleOf(id), cwd: '', alive: true })
      }
    } catch {}
    return out.sort((a, b) => {
      const at = a.title || '\uffff'
      const bt = b.title || '\uffff'
      return at.localeCompare(bt, 'zh') || a.id.localeCompare(b.id)
    })
  }

  async function inject(sessionId, text) {
    const controller = sessionController()
    if (controller && typeof controller.prompt === 'function') {
      // ⚠ sessionController.prompt(request, signal) 的第二个参数是 AbortSignal，
      //   内部第一行就 signal.throwIfAborted()；不传会报
      //   "Cannot read properties of undefined (reading 'throwIfAborted')"。
      const call = new AbortController()
      const timer = setTimeout(() => call.abort(new Error('等待 DSH 接收消息超时')), 60_000)
      try {
        await controller.prompt({
          requestId: randomUUID(),
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text }],
        }, call.signal)
        pendingFromWeChat.set(String(sessionId), true)
        return 'prompt'
      } catch (error) {
        // 会话正在跑（agent-busy）时 prompt 会拒绝；退回到往活着的 agent 收件箱里塞。
        const agent = ctx.agents.get(String(sessionId))
        if (!agent || typeof agent.followup !== 'function') throw error
        await agent.followup({
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text }],
          source: { kind: 'wechat-bridge' },
        })
        pendingFromWeChat.set(String(sessionId), true)
        return 'followup'
      } finally {
        clearTimeout(timer)
      }
    }
    const agent = ctx.agents.get(String(sessionId))
    if (!agent || typeof agent.followup !== 'function') {
      throw new Error('这个会话现在没有活着的 agent，也无法通过 sessionController 唤醒')
    }
    await agent.followup({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'wechat-bridge' },
    })
    pendingFromWeChat.set(String(sessionId), true)
    return 'followup'
  }

  // 日常短回复里，她可能一口气写两三段（每段一句到两句）。
  // 这些段落按「独立气泡」发出去，像微信里连发几条；长文不拆。
  const BUBBLE_MAX_PARTS = 5
  const BUBBLE_MAX_CHARS = 260
  const BUBBLE_GAP_MS = 450

  function bubbleParts(text) {
    const raw = String(text || '').trim()
    if (!raw) return []
    if (raw.length > BUBBLE_MAX_CHARS) return [raw]
    const parts = raw.split(String.fromCharCode(10)).map((line) => line.trim()).filter(Boolean)
    if (parts.length <= 1) return [raw]
    if (parts.length <= BUBBLE_MAX_PARTS) return parts
    // 超过 5 段：前 4 段各发一条，剩下的并进第 5 条，避免丢内容
    const head = parts.slice(0, BUBBLE_MAX_PARTS - 1)
    const tail = parts.slice(BUBBLE_MAX_PARTS - 1).join(String.fromCharCode(10))
    return [...head, tail]
  }

  async function deliver(sessionId, text) {
    const bindings = store.bindingsForSession(sessionId)
    if (!bindings.length) {
      note(`deliver ${short(sessionId)} 跳过：没有绑定`)
      return
    }
    for (const binding of bindings) {
      const account = store.account(binding.accountId)
      if (!account) {
        note(`deliver ${short(sessionId)} 跳过：账号 ${short(binding.accountId)} 不在`)
        continue
      }
      stopTyping(binding.chatId)
      const chatKey = `${binding.accountId}:${binding.chatId}`
      const contextToken = contextTokens.get(chatKey) || store.state.chats[chatKey]?.contextToken || undefined
      for (const part of splitText(text)) {
        const bubbles = bubbleParts(part)
        for (let i = 0; i < bubbles.length; i++) {
          try {
            await api.sendText({
              baseUrl: account.baseUrl,
              token: account.token,
              toUserId: binding.chatId,
              text: bubbles[i],
              contextToken,
            })
            note(`deliver ${short(sessionId)} → ${short(binding.chatId)} 气泡 ${i + 1}/${bubbles.length}（${bubbles[i].length} 字）`)
          } catch (error) {
            note(`deliver ${short(sessionId)} → ${short(binding.chatId)} 失败：${String(error && error.message ? error.message : error)}`)
          }
          if (i < bubbles.length - 1) await sleep(BUBBLE_GAP_MS)
        }
      }
    }
  }

  function stopFollow(sessionId) {
    const runtime = follows.get(String(sessionId))
    if (!runtime) return
    follows.delete(String(sessionId))
    try {
      runtime.controller.abort()
    } catch {}
  }

  function ensureFollow(sessionId) {
    const id = String(sessionId)
    if (disposed || follows.has(id)) return
    if (!store.bindingsForSession(id).length) return
    const controller = sessionController()
    if (!controller || typeof controller.follow !== 'function') {
      // 插件 apply 时 sessionController 可能还没发布：等一会儿再挂，而不是永久放弃。
      note(`follow ${short(id)} 等待 sessionController`)
      setTimeout(() => ensureFollow(id), 1_500).unref?.()
      return
    }
    const runtime = { controller: new AbortController(), retry: null, lastError: null }
    follows.set(id, runtime)
    void runFollow(id, runtime)
      .then(() => {
        if (disposed || runtime.controller.signal.aborted || follows.get(id) !== runtime) return
        note(`follow ${short(id)} 流已结束，稍后重连`)
        follows.delete(id)
        setTimeout(() => ensureFollow(id), FOLLOW_RETRY_MS).unref?.()
      })
      .catch((error) => {
        if (runtime.controller.signal.aborted) return
        runtime.lastError = String(error && error.message ? error.message : error)
        note(`follow ${short(id)} 失败：${runtime.lastError}`)
        follows.delete(id)
        if (!disposed) setTimeout(() => ensureFollow(id), FOLLOW_RETRY_MS).unref?.()
      })
  }

  async function runFollow(sessionId, runtime) {
    const controller = sessionController()
    let lastSeq = -1
    let turnText = []
    let lastUserKind = 'user'
    const stream = controller.follow({ address: { kind: 'session', sessionId } }, runtime.controller.signal)
    note(`follow ${short(sessionId)} 已打开`)
    for await (const frame of stream) {
      if (runtime.controller.signal.aborted) break
      if (!frame || typeof frame !== 'object') continue
      if (frame.type === 'snapshot') {
        lastSeq = Number(frame.cursor) || 0
        note(`follow ${short(sessionId)} 快照 seq=${lastSeq}`)
        continue
      }
      if (frame.type !== 'event' || !frame.event) continue
      const event = frame.event
      const seq = Number(event.seq) || 0
      if (seq <= lastSeq) continue
      lastSeq = seq
      if (event.type === 'user/message') {
        // 这一轮是谁开的头：user = 网页/微信注入；speak-up / 定时任务 = 她自己的主动行为。
        const kind = event.data?.source?.kind
        if (typeof kind === 'string' && kind) lastUserKind = kind
      } else if (event.type === 'assistant/message') {
        const text = messageText(event.data?.message)
        if (text) {
          turnText.push(text)
          note(`follow ${short(sessionId)} assistant ${text.length} 字`)
        }
      } else if (event.type === 'turn/end') {
        const text = turnText.join('\n').trim()
        turnText = []
        const fromWeChat = pendingFromWeChat.get(sessionId) === true
        pendingFromWeChat.delete(sessionId)
        const ownInitiative = lastUserKind !== 'user'
        const mirrorWeb = store.state.settings.mirrorFromWeb !== false
        note(`follow ${short(sessionId)} turn/end 攒到 ${text.length} 字，来自微信=${fromWeChat}，发起方=${lastUserKind}，主动=${ownInitiative}`)
        lastUserKind = 'user'
        // 她自己的主动搭话 / 定时任务，不管 mirrorFromWeb 开关如何都要回微信；
        // 开关只用来挡「网页里用户问、网页里答」的那种回声。
        if (text && (fromWeChat || ownInitiative || mirrorWeb)) {
          await deliver(sessionId, text)
        } else if (text) {
          note(`follow ${short(sessionId)} 跳过推送：网页发起的对话且 mirrorFromWeb=false`)
        }
        for (const binding of store.bindingsForSession(sessionId)) stopTyping(binding.chatId)
      }
    }
  }

  function stopAccount(accountId) {
    const runtime = runtimes.get(String(accountId))
    if (!runtime) return
    runtimes.delete(String(accountId))
    try {
      runtime.controller.abort()
    } catch {}
  }

  function startAccount(accountId) {
    const id = String(accountId)
    if (disposed || runtimes.has(id)) return
    const account = store.account(id)
    if (!account) return
    const runtime = { controller: new AbortController() }
    runtimes.set(id, runtime)
    void runAccount(account, runtime).catch((error) => {
      if (runtime.controller.signal.aborted) return
      log('微信账号循环退出：' + String(error && error.message ? error.message : error))
      runtimes.delete(id)
      if (!disposed) setTimeout(() => startAccount(id), ACCOUNT_RETRY_MS).unref?.()
    })
  }

  async function runAccount(account, runtime) {
    try {
      await api.notifyStart({ baseUrl: account.baseUrl, token: account.token, signal: runtime.controller.signal })
    } catch (error) {
      const code = String(error?.providerCode || '')
      account.lastError = code === '-14' ? '令牌已失效，请重新扫码' : String(error?.message || error)
      store.save()
      if (code === '-14') return
    }
    while (!disposed && !runtime.controller.signal.aborted) {
      try {
        const response = await api.getUpdates({
          baseUrl: account.baseUrl,
          token: account.token,
          getUpdatesBuf: account.updatesBuf || '',
          signal: runtime.controller.signal,
        })
        const buffer = typeof response?.get_updates_buf === 'string' ? response.get_updates_buf : ''
        if (buffer && buffer !== account.updatesBuf) {
          account.updatesBuf = buffer
          if (account.lastError) account.lastError = null
          store.save()
        }
        for (const message of Array.isArray(response?.msgs) ? response.msgs : []) {
          try {
            await handleInbound(account, message)
          } catch (error) {
            log('处理入站消息失败：' + String(error && error.message ? error.message : error))
          }
        }
        // 正常情况下 getupdates 是 35 秒长轮询；但服务端/代理异常时会立刻返回空，
        // 这里必须让出事件循环，否则会变成忙等、把定时器和 HTTP 一起饿死。
        if (!Array.isArray(response?.msgs) || response.msgs.length === 0) await sleep(250)
      } catch (error) {
        if (runtime.controller.signal.aborted) break
        const code = String(error?.providerCode || '')
        if (code === '-14') {
          account.lastError = '令牌已失效，请重新扫码'
          store.save()
          break
        }
        log('收消息失败：' + String(error && error.message ? error.message : error))
        await sleep(ACCOUNT_RETRY_MS)
      }
    }
  }

  async function handleInbound(account, message) {
    const chatId = typeof message?.from_user_id === 'string' ? message.from_user_id.trim() : ''
    if (!chatId) return
    const text = extractText(message)
    note(`inbound ${short(chatId)} ${text ? text.length + ' 字' : '非文字'}`)
    const chatKey = `${account.accountId}:${chatId}`
    if (typeof message?.context_token === 'string' && message.context_token) {
      contextTokens.set(chatKey, message.context_token)
    }
    store.touchChat({
      accountId: account.accountId,
      chatId,
      lastText: text || '',
      contextToken: typeof message?.context_token === 'string' ? message.context_token : undefined,
    })
    const binding = store.bindingForChat(chatId)
    if (!binding || binding.accountId !== account.accountId) {
      maybeHint(chatKey, account, chatId)
      return
    }
    if (!text) {
      maybeHint(`${chatKey}:nontext`, account, chatId, '目前只支持文字消息哦')
      return
    }
    const delay = readDelayMs(text)
    if (delay > 0) {
      note(`阅读延迟 ${short(chatId)} ${delay}ms`)
      await sleep(delay)
    }
    startTyping(account, chatId, message?.context_token)
    try {
      const mode = await inject(binding.sessionId, text)
      note(`inbound ${short(chatId)} → ${short(binding.sessionId)} 注入成功（${mode}）`)
    } catch (error) {
      stopTyping(chatId)
      note(`inbound ${short(chatId)} → ${short(binding.sessionId)} 注入失败：${String(error && error.message ? error.message : error)}`)
      await api.sendText({
        baseUrl: account.baseUrl,
        token: account.token,
        toUserId: chatId,
        text: `这条消息没能送进 DSH：${String(error && error.message ? error.message : error)}`,
      }).catch(() => {})
    }
  }

  function maybeHint(chatKey, account, chatId, body) {
    const now = Date.now()
    const last = hints.get(chatKey) || 0
    if (now - last < HINT_COOLDOWN_MS) return
    hints.set(chatKey, now)
    const text = body || '这个微信对话还没有绑定 DSH 会话。在 DSH 里打开「微信桥」页面，选一个对话绑定后再发消息吧。'
    void api.sendText({ baseUrl: account.baseUrl, token: account.token, toUserId: chatId, text }).catch(() => {})
  }

  async function beginLogin() {
    const { qrcode, imageUrl, imageDataUrl, baseUrl } = await api.beginLogin()
    const attemptId = randomUUID()
    const attempt = {
      attemptId,
      qrcode,
      imageUrl,
      imageDataUrl,
      baseUrl,
      status: 'wait',
      error: null,
      accountId: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + LOGIN_TTL_MS,
      controller: new AbortController(),
    }
    attempts.set(attemptId, attempt)
    void pollAttempt(attempt)
    return { attemptId, imageUrl, imageDataUrl, status: attempt.status, expiresAt: attempt.expiresAt }
  }

  async function pollAttempt(attempt) {
    while (!disposed && !attempt.controller.signal.aborted) {
      if (Date.now() > attempt.expiresAt) {
        attempt.status = 'expired'
        attempt.error = '二维码已过期，请重新生成'
        return
      }
      try {
        const result = await api.pollLogin({ qrcode: attempt.qrcode, baseUrl: attempt.baseUrl, signal: attempt.controller.signal })
        attempt.status = result.status
        if (result.status === 'confirmed') {
          if (!result.botToken || !result.accountId || !result.ownerUserId) {
            attempt.status = 'failed'
            attempt.error = '微信授权成功，但返回的凭据不完整'
            return
          }
          const account = {
            accountId: result.accountId,
            ownerUserId: result.ownerUserId,
            baseUrl: result.baseUrl || attempt.baseUrl,
            token: result.botToken,
            botId: result.accountId.slice(-8),
            connectedAt: new Date().toISOString(),
            updatesBuf: '',
            lastError: null,
          }
          store.upsertAccount(account)
          attempt.accountId = account.accountId
          attempt.status = 'connected'
          startAccount(account.accountId)
          return
        }
        if (result.status === 'scaned_but_redirect' && result.redirectHost) {
          attempt.baseUrl = redirectBase(result.redirectHost, attempt.baseUrl)
        }
        if (result.status === 'need_verifycode') {
          attempt.status = 'failed'
          attempt.error = '这个微信需要在手机上输入配对码，第一版不支持'
          return
        }
        if (result.status === 'verify_code_blocked') {
          attempt.status = 'failed'
          attempt.error = '配对码错误次数过多，请重新生成二维码'
          return
        }
        if (result.status === 'expired' || result.status === 'binded_redirect') {
          attempt.error = result.status === 'expired' ? '二维码已过期，请重新生成' : '这个微信已绑定在别处'
          return
        }
      } catch (error) {
        if (attempt.controller.signal.aborted) return
        attempt.error = String(error && error.message ? error.message : error)
        await sleep(2_000)
        continue
      }
      await sleep(1_500)
    }
  }

  function redirectBase(host, fallback) {
    try {
      const raw = String(host || '').trim()
      if (!raw) return fallback
      const url = new URL(raw.includes('://') ? raw : 'https://' + raw)
      if (url.protocol !== 'https:' || !/(^|\.)weixin\.qq\.com$/.test(url.hostname.toLowerCase())) return fallback
      url.search = ''
      url.hash = ''
      if (!url.pathname.endsWith('/')) url.pathname += '/'
      return url.toString()
    } catch {
      return fallback
    }
  }

  function loginState(attemptId) {
    const attempt = attempts.get(String(attemptId))
    if (!attempt) return { ok: false, error: '这次扫码已经结束，请重新生成二维码' }
    return {
      ok: true,
      attemptId: attempt.attemptId,
      status: attempt.status,
      imageUrl: attempt.imageUrl,
      imageDataUrl: attempt.imageDataUrl,
      accountId: attempt.accountId,
      error: attempt.error,
      expiresAt: attempt.expiresAt,
    }
  }

  function cancelLogin(attemptId) {
    const attempt = attempts.get(String(attemptId))
    if (!attempt) return false
    try {
      attempt.controller.abort()
    } catch {}
    attempts.delete(String(attemptId))
    return true
  }

  function publicState() {
    const bindings = store.bindings().map((binding) => {
      const account = store.account(binding.accountId)
      return {
        chatId: binding.chatId,
        accountId: binding.accountId,
        accountLabel: account ? (account.ownerUserId || account.botId) : binding.accountId,
        sessionId: binding.sessionId,
        sessionTitle: titleOf(binding.sessionId),
        createdAt: binding.createdAt,
        following: follows.has(String(binding.sessionId)),
        followError: follows.get(String(binding.sessionId))?.lastError || null,
      }
    })
    return {
      ok: true,
      version: PLUGIN_VERSION,
      accounts: store.accounts().map(sanitizeAccount),
      // contextToken 是回复凭据，只留在本地，不进任何 HTTP 响应
      chats: store.chats().map(({ contextToken, ...chat }) => chat),
      bindings,
      sessions: listSessions(),
      settings: store.state.settings,
      storage: store.path,
      loopback: isLoopback(),
      logs: logs.slice(-60),
    }
  }

  function bind({ accountId, chatId, sessionId }) {
    const account = store.account(String(accountId))
    if (!account) throw new Error('这个微信账号还没连上')
    const chat = String(chatId || '').trim()
    const session = String(sessionId || '').trim()
    if (!chat || !session) throw new Error('chatId 和 sessionId 都要给')
    if (!sessionObject(session) && !ctx.agents.get(session)) throw new Error('这个会话不存在')
    store.bind({ accountId: account.accountId, chatId: chat, sessionId: session, createdAt: new Date().toISOString() })
    ensureFollow(session)
    return publicState()
  }

  function unbind(chatId) {
    const binding = store.bindingForChat(String(chatId))
    const removed = store.unbind(String(chatId))
    if (binding && !store.bindingsForSession(binding.sessionId).length) stopFollow(binding.sessionId)
    return removed
  }

  function removeAccount(accountId) {
    const id = String(accountId)
    const account = store.account(id)
    if (!account) return false
    const affected = new Set(store.bindings().filter((b) => b.accountId === id).map((b) => b.sessionId))
    stopAccount(id)
    void api.notifyStop({ baseUrl: account.baseUrl, token: account.token }).catch(() => {})
    store.removeAccount(id)
    for (const sessionId of affected) {
      if (!store.bindingsForSession(sessionId).length) stopFollow(sessionId)
    }
    return true
  }

  function setSettings(patch) {
    return store.updateSettings({
      ...(typeof patch?.mirrorFromWeb === 'boolean' ? { mirrorFromWeb: patch.mirrorFromWeb } : {}),
    })
  }

  async function debugInject({ sessionId, text }) {
    if (!text) throw new Error('text 不能为空')
    const bindings = store.bindingsForSession(String(sessionId))
    if (!bindings.length) throw new Error('这个会话还没有绑定微信对话')
    const mode = await inject(String(sessionId), String(text))
    return { ok: true, mode }
  }

  function start() {
    note(`启动：账号 ${store.accounts().length} 个，绑定 ${store.bindings().length} 个，sessionController=${Boolean(sessionController())}`)
    for (const account of store.accounts()) startAccount(account.accountId)
    for (const binding of store.bindings()) ensureFollow(binding.sessionId)
  }

  function dispose() {
    disposed = true
    for (const attempt of attempts.values()) {
      try {
        attempt.controller.abort()
      } catch {}
    }
    attempts.clear()
    for (const id of [...runtimes.keys()]) stopAccount(id)
    for (const id of [...follows.keys()]) stopFollow(id)
  }

  return {
    start,
    dispose,
    beginLogin,
    loginState,
    cancelLogin,
    publicState,
    bind,
    unbind,
    removeAccount,
    setSettings,
    debugInject,
    inject,
    deliver,
    hasBindings: () => store.bindings().length > 0,
  }
}
