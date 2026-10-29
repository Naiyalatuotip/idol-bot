// dsh-surf —— QQ 接入（OneBot v11 WS）+ 微博阅读/分享。
//
// QQ：QQ 消息 → OneBot WS → sessionController.prompt → DSH 回合 → follow → 分气泡回 QQ。
// 微博：账号 cookies 读「关注」「推荐」时间线，按兴趣排序；提供 weibo_browse 工具，
//       也可以定时把候选素材塞进目标会话让她主动分享。

import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createStore } from './store.mjs'
import { createQqBridge } from './qq.mjs'
import { browse, formatPosts, buildSharePrompt, startLogin, checkLogin, whoami } from './weibo.mjs'
import { renderPage } from './page.mjs'

export const name = 'dsh-surf'
export const inject = ['webServer', 'sessions', 'agents', 'sessionTitle', 'sessionController', 'tools', 'agentPresets', 'timer']

const PREFIX = '/dsh-surf'
const VERSION = '0.3.2'
const LOGIN_TTL = 5 * 60 * 1000
const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')

function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function sendJson(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

async function readBody(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 128 * 1024) throw new Error('请求体太大')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  return raw ? JSON.parse(raw) : {}
}

function growthTopics() {
  try {
    const file = join(HOME, 'aoi-daily', 'config.json')
    if (!existsSync(file)) return []
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return (data.growth?.topics || []).filter((x) => Number(x.weight) >= 55).map((x) => x.topic)
  } catch {
    return []
  }
}

export function apply(ctx) {
  const store = createStore()
  const qq = createQqBridge({ ctx, store, log: () => {} })
  const mounted = new WeakSet()
  const loginAttempts = new Map()
  let lastShareAt = 0
  let sharing = false
  let lastShareNote = ''
  const logs = []

  const note = (message) => {
    const line = `${new Date().toISOString()} ${message}`
    logs.push(line)
    if (logs.length > 200) logs.splice(0, logs.length - 200)
    try { ctx.logger?.info?.('[dsh-surf] ' + message) } catch {}
  }

  const titleOf = (sessionId) => {
    try {
      const session = ctx.get('sessions')?.get?.(sessionId)
      const snap = ctx.get('sessionTitle')?.get?.(session || { id: sessionId })
      return typeof snap?.title === 'string' ? snap.title.trim() : ''
    } catch {
      return ''
    }
  }

  const presetOf = (agent) => {
    try {
      return ctx.agentPresets?.composedPreset?.(agent.ctx)
    } catch {
      return undefined
    }
  }

  function sessionList() {
    const out = []
    try {
      for (const s of ctx.get('sessions')?.list?.() || []) {
        const id = String(s?.id || '')
        if (!id) continue
        const agent = ctx.agents.get(id)
        out.push({ id, title: titleOf(id), alive: Boolean(agent), preset: agent ? presetOf(agent) || '' : '' })
      }
    } catch {}
    return out
  }

  function publicState() {
    return {
      ok: true,
      version: VERSION,
      qq: { ...qq.status(), tokenMasked: store.state.qq.token ? '••••' + store.state.qq.token.slice(-4) : '', chats: Object.entries(store.state.qqChats).map(([key, v]) => ({ chatKey: key, ...v })), bindings: store.state.qqBindings },
      weibo: {
        configured: Boolean(store.state.weibo.cookies),
        uid: store.state.weibo.uid,
        count: store.state.weibo.count,
        followingShare: store.state.weibo.followingShare,
        intervalMin: store.state.weibo.intervalMin,
        enableShare: store.state.weibo.enableShare,
        interests: store.state.weibo.interests,
        screenName: store.state.weibo.screenName || '',
        lastLoginAt: store.state.weibo.lastLoginAt || '',
        lastFetchAt: store.state.weibo.lastFetchAt,
        lastError: store.state.weibo.lastError,
        cookiesMasked: store.state.weibo.cookies ? store.state.weibo.cookies.slice(0, 6) + '…' + store.state.weibo.cookies.slice(-4) : '',
        cache: store.state.weiboCache.slice(0, 20).map((p) => ({ id: p.id, author: p.author, text: String(p.text || '').slice(0, 140), url: p.url, source: p.source, why: p.why, likes: p.likes, reposts: p.reposts, comments: p.comments })),
      },
      sessions: sessionList(),
      lastShareAt: lastShareAt ? new Date(lastShareAt).toISOString() : '',
      lastShareNote,
      logs: logs.slice(-60),
    }
  }

  async function fetchWeibo({ kind = 'mixed', count = 0 } = {}) {
    const cfg = store.state.weibo
    const result = await browse(cfg, { kind, count, seen: store.state.weiboSeen, growthTopics: growthTopics() })
    store.state.weibo.lastFetchAt = new Date().toISOString()
    store.state.weibo.lastError = result.errors?.length ? result.errors.join('；') : ''
    store.markWeiboFetched(result.posts)
    return result
  }

  function weiboTool() {
    return {
      name: 'weibo_browse',
      description: '看微博：读「关注」和「推荐」时间线，按他的兴趣挑几条。用户说「看看微博」「首页刷到什么」「有什么好玩的」时用。只读，不点赞不转发。',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['following', 'recommend', 'mixed'], description: '看关注、推荐，还是两边都看；默认 mixed' },
          count: { type: 'number', description: '读多少条，5–50，默认用设置里的数量' },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: { text: { type: 'string' } } },
        render(_args, value) {
          return [{ type: 'text', text: String(value?.text || '没读到微博') }]
        },
      },
      async execute(args = {}) {
        try {
          const result = await fetchWeibo({ kind: String(args.kind || 'mixed'), count: Number(args.count) || 0 })
          return { text: formatPosts(result.posts, { max: 8 }) }
        } catch (error) {
          const msg = String(error?.message || error)
          store.state.weibo.lastError = msg
          store.save()
          return { text: `没读到微博：${msg}\n（先在「冲浪」设置页填 cookies）` }
        }
      },
    }
  }

  function mountTool(agent) {
    if (!agent || mounted.has(agent)) return
    if (presetOf(agent) !== 'aoi') return
    mounted.add(agent)
    try {
      agent.ctx.tools.register(weiboTool())
      note(`已给 ${agent.id.slice(-6)} 挂上 weibo_browse`)
    } catch (error) {
      note('挂 weibo_browse 失败：' + String(error?.message || error))
    }
  }

  const mountTimer = ctx.interval(() => {
    try {
      for (const agent of ctx.agents.list() || []) mountTool(agent)
    } catch {}
  }, 3000)
  ctx.effect(() => () => mountTimer())

  async function shareNow() {
    if (sharing) return { ok: false, error: '正在分享' }
    sharing = true
    try {
      const result = await fetchWeibo({ kind: 'mixed' })
      // 分享优先从「关注」里挑，推荐只作为兜底
      const preferred = result.posts.filter((p) => p.source === 'following')
      const pick = preferred.find((p) => !store.state.weiboSeen[p.id])
        || preferred[0]
        || result.posts.find((p) => !store.state.weiboSeen[p.id])
        || result.posts[0]
      if (!pick) throw new Error('没有可分享的微博')
      const prompt = buildSharePrompt([pick])
      const targets = (ctx.agents.list() || []).filter((a) => presetOf(a) === 'aoi')
      if (!targets.length) throw new Error('没有活着的目标会话')
      for (const agent of targets) {
        await agent.followup({
          id: `weibo-share-${Date.now()}`,
          role: 'user',
          content: [{ type: 'text', text: prompt }],
          source: { kind: 'weibo-share' },
        })
      }
      store.state.weiboSeen[pick.id] = Date.now()
      store.save()
      lastShareAt = Date.now()
      lastShareNote = `分享了 @${pick.author}：${pick.text.slice(0, 40)}`
      return { ok: true, pick, targets: targets.length }
    } catch (error) {
      lastShareNote = '分享失败：' + String(error?.message || error)
      return { ok: false, error: lastShareNote }
    } finally {
      sharing = false
    }
  }

  const shareTimer = ctx.interval(() => {
    const w = store.state.weibo
    if (!w.enableShare || !w.intervalMin || !w.cookies) return
    if (Date.now() - lastShareAt < w.intervalMin * 60000) return
    if (lastShareAt && todayKey(new Date(lastShareAt)) !== todayKey()) {
      // 新的一天也允许
    }
    void shareNow()
  }, 60_000)
  ctx.effect(() => () => shareTimer())

  const route = (path, handler) =>
    ctx.effect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path,
        handler: async (req, res) => {
          try {
            await handler(req, res)
          } catch (error) {
            if (!res.headersSent) sendJson(res, { ok: false, error: String(error?.message || error) }, 400)
            else res.end()
          }
        },
      })
    )

  const page = (req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(renderPage({ prefix: PREFIX }))
  }
  route(PREFIX, page)
  route(PREFIX + '/', page)

  route(PREFIX + '/api/state', (req, res) => sendJson(res, publicState()))

  route(PREFIX + '/api/qq/config', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '只接受 POST' }, 405)
    const body = await readBody(req)
    store.updateQq(body)
    qq.stop()
    qq.start()
    sendJson(res, { ok: true, qq: qq.status() })
  })

  route(PREFIX + '/api/qq/reconnect', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '只接受 POST' }, 405)
    qq.stop()
    qq.start()
    sendJson(res, { ok: true, qq: qq.status() })
  })

  route(PREFIX + '/api/qq/bind', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '只接受 POST' }, 405)
    const body = await readBody(req)
    try {
      qq.bind(String(body.chatKey || ''), String(body.sessionId || ''))
      sendJson(res, { ok: true, bindings: store.state.qqBindings })
    } catch (error) {
      sendJson(res, { ok: false, error: String(error?.message || error) }, 400)
    }
  })

  route(PREFIX + '/api/qq/unbind', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '只接受 POST' }, 405)
    const body = await readBody(req)
    qq.unbind(String(body.chatKey || ''))
    sendJson(res, { ok: true, bindings: store.state.qqBindings })
  })

  route(PREFIX + '/api/weibo/login/start', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '只接受 POST' }, 405)
    // 清掉过期 attempt
    for (const [id, a] of loginAttempts) if (Date.now() - a.createdAt > LOGIN_TTL) loginAttempts.delete(id)
    try {
      const started = await startLogin()
      const attemptId = `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      loginAttempts.set(attemptId, { ...started, createdAt: Date.now(), status: 'wait' })
      sendJson(res, { ok: true, attemptId, imageDataUrl: started.imageDataUrl, expiresAt: Date.now() + LOGIN_TTL })
    } catch (error) {
      sendJson(res, { ok: false, error: String(error?.message || error) })
    }
  })

  route(PREFIX + '/api/weibo/login/status', async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const attemptId = String(url.searchParams.get('attemptId') || '')
    const attempt = loginAttempts.get(attemptId)
    if (!attempt) return sendJson(res, { ok: false, error: '这次扫码已经结束，请重新生成二维码' })
    if (Date.now() - attempt.createdAt > LOGIN_TTL) {
      loginAttempts.delete(attemptId)
      return sendJson(res, { ok: true, status: 'expired' })
    }
    try {
      const result = await checkLogin(attempt)
      if (result.status === 'confirmed') {
        loginAttempts.delete(attemptId)
        store.saveWeiboLogin({ cookies: result.cookies, uid: result.uid, screenName: result.screenName })
        note(`微博扫码登录成功：${result.screenName || result.uid || '未知账号'}`)
        return sendJson(res, { ok: true, status: 'confirmed', uid: result.uid, screenName: result.screenName })
      }
      if (result.status === 'expired') loginAttempts.delete(attemptId)
      sendJson(res, { ok: true, status: result.status, retcode: result.retcode })
    } catch (error) {
      sendJson(res, { ok: false, error: String(error?.message || error) })
    }
  })

  route(PREFIX + '/api/weibo/login/cancel', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '只接受 POST' }, 405)
    const body = await readBody(req).catch(() => ({}))
    if (body.attemptId) loginAttempts.delete(String(body.attemptId))
    sendJson(res, { ok: true })
  })

  route(PREFIX + '/api/weibo/import', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '只接受 POST' }, 405)
    const body = await readBody(req).catch(() => ({}))
    const file = String(body.path || '').trim()
    if (!file) throw new Error('请给 cookies.json 的路径（body.path）')
    
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'))
      const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null
      if (!obj) throw new Error('cookies 文件不是 JSON 对象')
      const cookies = Object.entries(obj)
        .filter(([, v]) => typeof v === 'string' && v.trim())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
      if (!cookies) throw new Error('文件里没有可用的 cookie')
      const me = await whoami(cookies)
      if (!me) throw new Error('这些 cookies 不是登录态（可能已过期，先在 weibo_comment_hunter 里跑 python run.py login）')
      store.saveWeiboLogin({ cookies, uid: me.uid, screenName: me.screenName })
      note(`从 ${file} 导入微博 cookies：${me.screenName || me.uid}`)
      sendJson(res, { ok: true, uid: me.uid, screenName: me.screenName })
    } catch (error) {
      sendJson(res, { ok: false, error: String(error?.message || error) })
    }
  })

  route(PREFIX + '/api/weibo/config', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '只接受 POST' }, 405)
    const body = await readBody(req)
    store.updateWeibo(body)
    sendJson(res, { ok: true, weibo: publicState().weibo })
  })

  route(PREFIX + '/api/weibo/test', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '只接受 POST' }, 405)
    try {
      const result = await fetchWeibo({ kind: 'mixed' })
      sendJson(res, { ok: true, count: result.posts.length, text: formatPosts(result.posts, { max: 5 }), errors: result.errors })
    } catch (error) {
      sendJson(res, { ok: false, error: String(error?.message || error) })
    }
  })

  route(PREFIX + '/api/weibo/share', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '只接受 POST' }, 405)
    sendJson(res, await shareNow())
  })

  qq.start()
  ctx.effect(() => () => qq.stop())
  note('已启动：QQ 桥 + 微博阅读')
}
