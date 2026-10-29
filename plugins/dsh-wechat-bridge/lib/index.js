// dsh-wechat-bridge —— 把 DSH 里指定的对话接到微信私聊（腾讯 iLink 官方机器人通道）。
//
// 形态：
//   · 一个 bundle 包，装进 profile 后由 cordis.patch.yml 插入一行插件；
//   · 宿主半边提供 HTTP 接口 + 一个管理页（/dsh-wechat-bridge/）；
//   · 不做客户端设置页（先跑通，后面想搬进设置页再说）。
//
// 安全边界：
//   · 只有用户在管理页显式绑定过的微信对话才会被注入 DSH 会话；
//   · 未绑定的对话最多收到一条提示，不进入任何会话；
//   · 令牌只落本机 JSON（0600），任何 HTTP 响应都不回传令牌。

import { createStore } from './store.mjs'
import { createBridge } from './bridge.mjs'
import { renderPage } from './page.mjs'

export const name = 'dsh-wechat-bridge'
export const inject = ['webServer', 'sessions', 'agents', 'sessionTitle', 'sessionController']

const PREFIX = '/dsh-wechat-bridge'
const MAX_BODY_BYTES = 64 * 1024

function isLoopback(req) {
  const address = req?.socket?.remoteAddress || req?.connection?.remoteAddress || ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

async function readJson(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('请求体太大')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

function sendJson(res, value, status = 200) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

function sendHtml(res, html) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  res.end(html)
}

export function apply(ctx, config = {}) {
  const log = (message) => {
    try {
      ctx.logger?.info?.('[dsh-wechat-bridge] ' + message)
    } catch {}
  }

  const store = createStore()
  const bridge = createBridge({ ctx, store, log, isLoopback })

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

  const page = (req, res) => sendHtml(res, renderPage({ prefix: PREFIX }))

  route(PREFIX, page)
  route(PREFIX + '/', page)

  route(PREFIX + '/api/state', async (req, res) => {
    sendJson(res, bridge.publicState())
  })

  route(PREFIX + '/api/login/start', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '只接受 POST' }, 405)
    const result = await bridge.beginLogin()
    sendJson(res, { ok: true, ...result })
  })

  route(PREFIX + '/api/login/status', async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const attemptId = url.searchParams.get('attemptId') || ''
    sendJson(res, bridge.loginState(attemptId))
  })

  route(PREFIX + '/api/login/cancel', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '只接受 POST' }, 405)
    const body = await readJson(req)
    sendJson(res, { ok: bridge.cancelLogin(body.attemptId || '') })
  })

  route(PREFIX + '/api/account/remove', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '只接受 POST' }, 405)
    const body = await readJson(req)
    sendJson(res, { ok: bridge.removeAccount(body.accountId || ''), state: bridge.publicState() })
  })

  route(PREFIX + '/api/bind', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '只接受 POST' }, 405)
    const body = await readJson(req)
    const state = bridge.bind({
      accountId: body.accountId || '',
      chatId: body.chatId || '',
      sessionId: body.sessionId || '',
    })
    sendJson(res, { ok: true, state })
  })

  route(PREFIX + '/api/unbind', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '只接受 POST' }, 405)
    const body = await readJson(req)
    sendJson(res, { ok: bridge.unbind(body.chatId || ''), state: bridge.publicState() })
  })

  route(PREFIX + '/api/settings', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '只接受 POST' }, 405)
    const body = await readJson(req)
    sendJson(res, { ok: true, settings: bridge.setSettings(body) })
  })

  // 只给本机调试用：模拟一条微信消息进入绑定的会话，验证注入链路是否通。
  route(PREFIX + '/api/debug/inject', async (req, res) => {
    if (!isLoopback(req)) return sendJson(res, { ok: false, error: '只允许本机调用' }, 403)
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '只接受 POST' }, 405)
    const body = await readJson(req)
    const result = await bridge.debugInject({ sessionId: body.sessionId || '', text: body.text || '' })
    sendJson(res, result)
  })

  ctx.effect(() => () => bridge.dispose())
  bridge.start()
  log(`已启动：管理页 ${PREFIX}/ ，配置 ${store.path}`)
}
