// QQ 接入：OneBot v11 正向 WebSocket（NapCat / SnowLuma / Lagrange 都行）。
// 链路：QQ 消息 → OneBot WS → 本模块 → sessionController.prompt → DSH 回合
//       DSH 回复 → follow 事件流 → 分气泡 → send_private_msg / send_group_msg

import { randomUUID } from 'node:crypto'

const RECONNECT_MIN = 3000
const RECONNECT_MAX = 30000
const ACTION_TIMEOUT = 15000
const HINT_COOLDOWN = 10 * 60 * 1000
const BUBBLE_MAX = 5
const BUBBLE_GAP = 450

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function messageText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  return blocks
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

export function extractText(message) {
  if (typeof message === 'string') return message.trim()
  if (!Array.isArray(message)) return ''
  return message
    .map((seg) => {
      if (!seg || typeof seg !== 'object') return ''
      if (seg.type === 'text') return String(seg.data?.text ?? '')
      if (seg.type === 'image') return '[图片]'
      if (seg.type === 'face') return '[表情]'
      if (seg.type === 'at') return `@${seg.data?.qq ?? ''}`
      return ''
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

function bubbleParts(text) {
  const raw = String(text || '').trim()
  if (!raw) return []
  if (raw.length > 260) return [raw]
  const parts = raw.split(String.fromCharCode(10)).map((x) => x.trim()).filter(Boolean)
  if (parts.length <= 1) return [raw]
  if (parts.length <= BUBBLE_MAX) return parts
  return [...parts.slice(0, BUBBLE_MAX - 1), parts.slice(BUBBLE_MAX - 1).join(String.fromCharCode(10))]
}

export function createQqBridge({ ctx, store, log = () => {} }) {
  let ws = null
  let selfId = ''
  let running = false
  let reconnectMs = RECONNECT_MIN
  let reconnectTimer = null
  let echoSeq = 0
  const pending = new Map()
  const follows = new Map()
  const hints = new Map()
  const pendingFromQq = new Set()
  const logs = []

  const note = (message) => {
    const line = `${new Date().toISOString()} ${message}`
    logs.push(line)
    if (logs.length > 200) logs.splice(0, logs.length - 200)
    log(message)
  }

  function wsUrl() {
    const base = String(store.state.qq.url || '').trim() || 'ws://127.0.0.1:3001'
    const token = String(store.state.qq.token || '').trim()
    if (!token) return base
    return base + (base.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(token)
  }

  function action(actionName, params = {}) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== 1) {
        reject(new Error('OneBot 还没连上'))
        return
      }
      const echo = `surf-${++echoSeq}`
      const timer = setTimeout(() => {
        pending.delete(echo)
        reject(new Error(`OneBot ${actionName} 超时`))
      }, ACTION_TIMEOUT)
      pending.set(echo, { resolve, reject, timer })
      try {
        ws.send(JSON.stringify({ action: actionName, params, echo }))
      } catch (error) {
        clearTimeout(timer)
        pending.delete(echo)
        reject(error)
      }
    })
  }

  function connect() {
    if (!running) return
    let socket
    try {
      socket = new WebSocket(wsUrl())
    } catch (error) {
      note('QQ 连接失败：' + String(error?.message || error))
      scheduleReconnect()
      return
    }
    ws = socket
    socket.addEventListener('open', () => {
      note('QQ OneBot 已连接')
      reconnectMs = RECONNECT_MIN
      store.state.qq.connectedAt = new Date().toISOString()
      store.save()
      void action('get_login_info')
        .then((res) => {
          const id = res?.data?.user_id
          if (id) {
            selfId = String(id)
            store.state.qq.selfId = selfId
            store.save()
          }
          note('QQ 登录账号：' + (selfId || '未知'))
        })
        .catch((error) => note('get_login_info 失败：' + String(error?.message || error)))
      for (const b of store.state.qqBindings) ensureFollow(b.sessionId)
    })
    socket.addEventListener('message', (event) => {
      let payload
      try {
        payload = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
      } catch {
        return
      }
      if (payload.echo && pending.has(payload.echo)) {
        const p = pending.get(payload.echo)
        pending.delete(payload.echo)
        clearTimeout(p.timer)
        if (payload.status === 'failed' || payload.retcode) p.reject(new Error(payload.wording || payload.message || 'OneBot 调用失败'))
        else p.resolve(payload)
        return
      }
      if (payload.post_type) void handleEvent(payload)
    })
    socket.addEventListener('close', () => {
      note('QQ 连接断开')
      ws = null
      for (const [echo, p] of pending) {
        clearTimeout(p.timer)
        p.reject(new Error('连接断开'))
        pending.delete(echo)
      }
      scheduleReconnect()
    })
    socket.addEventListener('error', () => {
      // close 事件会跟着来，这里只记一笔
      note('QQ 连接出错（等重连）')
    })
  }

  function scheduleReconnect() {
    if (!running || reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, reconnectMs)
    reconnectMs = Math.min(RECONNECT_MAX, Math.round(reconnectMs * 1.6))
  }

  async function handleEvent(event) {
    if (event.post_type !== 'message') return
    const kind = event.message_type === 'group' ? 'group' : 'private'
    const id = kind === 'group' ? event.group_id : event.user_id
    const sender = event.sender?.user_id ?? event.user_id
    if (!id) return
    if (selfId && String(sender) === String(selfId)) return
    if (String(event.user_id) === String(selfId)) return
    const chatKey = `${kind}:${id}`
    const text = extractText(event.message ?? event.raw_message ?? '')
    store.touchChat(chatKey, text)
    note(`QQ 收到 ${chatKey}：${text ? text.length + ' 字' : '非文字'}`)
    const binding = store.bindingForChat(chatKey)
    if (!binding) {
      const now = Date.now()
      if (now - (hints.get(chatKey) || 0) > HINT_COOLDOWN) {
        hints.set(chatKey, now)
        void send(chatKey, '这个 QQ 对话还没绑定 DSH 会话。在 DSH 的「QQ 接入」页面选一个会话绑定后再发消息吧。').catch(() => {})
      }
      return
    }
    if (!text) {
      void send(chatKey, '目前只支持文字消息哦').catch(() => {})
      return
    }
    pendingFromQq.add(String(binding.sessionId))
    try {
      await inject(binding.sessionId, text)
      note(`QQ → ${binding.sessionId.slice(-6)} 注入成功`)
    } catch (error) {
      pendingFromQq.delete(String(binding.sessionId))
      note(`QQ → ${binding.sessionId.slice(-6)} 注入失败：${String(error?.message || error)}`)
      void send(chatKey, `这条消息没能送进 DSH：${String(error?.message || error)}`).catch(() => {})
    }
  }

  async function inject(sessionId, text) {
    const controller = ctx.get('sessionController')
    if (controller && typeof controller.prompt === 'function') {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(new Error('超时')), 60000)
      try {
        await controller.prompt({
          requestId: `qq-${randomUUID()}`,
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text }],
        }, ac.signal)
        return 'prompt'
      } catch (error) {
        note(`prompt 失败，尝试 followup：${String(error?.message || error)}`)
      } finally {
        clearTimeout(timer)
      }
    }
    const agent = ctx.agents.get(String(sessionId))
    if (!agent || typeof agent.followup !== 'function') throw new Error('这个会话没有活着的 agent，也无法唤醒')
    await agent.followup({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'qq-bridge' },
    })
    return 'followup'
  }

  async function send(chatKey, text) {
    const [kind, id] = String(chatKey).split(':')
    const actionName = kind === 'group' ? 'send_group_msg' : 'send_private_msg'
    const params = kind === 'group' ? { group_id: Number(id), message: [{ type: 'text', data: { text } }] } : { user_id: Number(id), message: [{ type: 'text', data: { text } }] }
    return action(actionName, params)
  }

  async function deliver(sessionId, text) {
    const bindings = store.bindingsForSession(sessionId)
    if (!bindings.length) return
    for (const b of bindings) {
      const parts = bubbleParts(text)
      for (let i = 0; i < parts.length; i++) {
        try {
          await send(b.chatKey, parts[i])
          note(`QQ 发送 ${b.chatKey} 气泡 ${i + 1}/${parts.length}`)
        } catch (error) {
          note(`QQ 发送失败：${String(error?.message || error)}`)
        }
        if (i < parts.length - 1) await sleep(BUBBLE_GAP)
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
    if (follows.has(id)) return
    if (!store.bindingsForSession(id).length) return
    const controller = ctx.get('sessionController')
    if (!controller || typeof controller.follow !== 'function') return
    const runtime = { controller: new AbortController() }
    follows.set(id, runtime)
    void runFollow(id, runtime).catch((error) => {
      if (runtime.controller.signal.aborted) return
      note(`跟随会话失败：${String(error?.message || error)}`)
      follows.delete(id)
      setTimeout(() => ensureFollow(id), 5000)
    })
  }

  async function runFollow(sessionId, runtime) {
    const controller = ctx.get('sessionController')
    let lastSeq = -1
    let turnText = []
    let lastUserKind = 'user'
    const stream = controller.follow({ address: { kind: 'session', sessionId } }, runtime.controller.signal)
    for await (const frame of stream) {
      if (runtime.controller.signal.aborted) break
      if (!frame || typeof frame !== 'object') continue
      if (frame.type === 'snapshot') {
        lastSeq = Number(frame.cursor) || 0
        continue
      }
      if (frame.type !== 'event' || !frame.event) continue
      const event = frame.event
      const seq = Number(event.seq) || 0
      if (seq <= lastSeq) continue
      lastSeq = seq
      if (event.type === 'user/message') {
        const kind = event.data?.source?.kind
        if (typeof kind === 'string' && kind) lastUserKind = kind
      } else if (event.type === 'assistant/message') {
        const text = messageText(event.data?.message)
        if (text) turnText.push(text)
      } else if (event.type === 'turn/end') {
        const text = turnText.join('\n').trim()
        turnText = []
        const fromQq = pendingFromQq.has(String(sessionId))
        pendingFromQq.delete(String(sessionId))
        const ownInitiative = lastUserKind !== 'user'
        lastUserKind = 'user'
        const mirror = store.state.settings.mirrorFromWeb !== false
        if (text && (fromQq || ownInitiative || mirror)) await deliver(sessionId, text)
      }
    }
  }

  function bind(chatKey, sessionId) {
    store.bindQq(chatKey, sessionId)
    ensureFollow(sessionId)
    return true
  }

  function unbind(chatKey) {
    const binding = store.bindingForChat(chatKey)
    store.unbindQq(chatKey)
    if (binding && !store.bindingsForSession(binding.sessionId).length) stopFollow(binding.sessionId)
    return true
  }

  function start() {
    if (running) return
    running = true
    connect()
  }

  function stop() {
    running = false
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = null
    for (const id of [...follows.keys()]) stopFollow(id)
    try {
      ws?.close()
    } catch {}
    ws = null
  }

  function status() {
    return {
      connected: ws?.readyState === 1,
      selfId,
      url: store.state.qq.url,
      connectedAt: store.state.qq.connectedAt,
      lastError: store.state.qq.lastError,
    }
  }

  return {
    start,
    stop,
    bind,
    unbind,
    status,
    logs,
    send,
  }
}
