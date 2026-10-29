// 腾讯 iLink（微信 AI 机器人）协议的最小客户端。
//
// 协议参考 @xmanrui/dsh-im（MIT）的 src/channels/weixin/weixin-api.mjs，这里只保留
// 文字收发所需的子集：扫码登录、长轮询收消息、发文字、输入状态。
// 图片/文件/语音不做（MVP 只做文字）。
//
// 所有请求都走 https 且只信任 *.weixin.qq.com；令牌只随请求头走，不落日志。

export const QR_BASE_URL = 'https://ilinkai.weixin.qq.com/'
export const PROTOCOL_VERSION = '2.4.6'
export const DEFAULT_BOT_TYPE = '3'
export const DEFAULT_MAX_CHARS = 1800

const ILINK_APP_ID = 'bot'
const ILINK_CLIENT_VERSION = (2 << 16) | (4 << 8) | 6
const DEFAULT_TIMEOUT_MS = 15_000
const LONG_POLL_TIMEOUT_MS = 35_000

const LOGIN_STATUSES = new Set([
  'wait',
  'scaned',
  'confirmed',
  'expired',
  'scaned_but_redirect',
  'need_verifycode',
  'verify_code_blocked',
  'binded_redirect',
])

export class WeixinApiError extends Error {
  constructor(code, message, options = {}) {
    super(message, options)
    this.name = 'WeixinApiError'
    this.code = code
    this.status = options.status
    this.providerCode = options.providerCode
  }
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isWeixinHost(hostname) {
  const host = String(hostname || '').toLowerCase()
  return host === 'weixin.qq.com' || host.endsWith('.weixin.qq.com')
}

function safeBaseUrl(value, label) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new WeixinApiError('invalid-base-url', `${label}不是有效地址`)
  }
  if (url.protocol !== 'https:' || !isWeixinHost(url.hostname)
    || (url.port !== '' && url.port !== '443') || url.username || url.password) {
    throw new WeixinApiError('untrusted-base-url', `${label}不是受信任的微信地址`)
  }
  url.search = ''
  url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.toString()
}

function safeImageUrl(value) {
  const raw = text(value)
  if (!raw) throw new WeixinApiError('invalid-qr', '微信服务没有返回二维码图片地址')
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new WeixinApiError('invalid-qr', '微信服务返回了无效的二维码地址')
  }
  if (url.protocol !== 'https:' || !isWeixinHost(url.hostname)) {
    throw new WeixinApiError('untrusted-qr', '二维码地址不在受信任的微信域名内')
  }
  return url.toString()
}

function commonHeaders() {
  return {
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': String(ILINK_CLIENT_VERSION),
  }
}

function sessionHeaders(token) {
  const headers = {
    ...commonHeaders(),
    'content-type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    // 协议要求一个随机的 X-WECHAT-UIN；服务端只用它做去重/分桶。
    'X-WECHAT-UIN': Buffer.from(String(Math.floor(Math.random() * 0xffffffff)), 'utf8').toString('base64'),
  }
  if (text(token)) headers.Authorization = `Bearer ${text(token)}`
  return headers
}

function baseInfo() {
  return { channel_version: PROTOCOL_VERSION, bot_agent: 'dsh-wechat-bridge/0.1.0' }
}

function providerCodeOf(value, fields = ['ret', 'errcode']) {
  for (const field of fields) {
    const raw = value?.[field]
    if (raw === undefined || raw === null || raw === '' || raw === 0 || raw === '0') continue
    return String(raw)
  }
  return null
}

async function requestJson(fetchImpl, {
  method,
  baseUrl,
  endpoint,
  body,
  token,
  authenticated = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
}) {
  const base = safeBaseUrl(baseUrl, '微信服务地址')
  const url = new URL(endpoint, base)
  if (!isWeixinHost(url.hostname)) {
    throw new WeixinApiError('untrusted-endpoint', '拒绝访问不受信任的微信地址')
  }
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
  signal?.addEventListener('abort', onAbort, { once: true })
  let timedOut = false
  const timer = timeoutMs > 0
    ? setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    : null
  try {
    const response = await fetchImpl(url, {
      method,
      headers: authenticated ? sessionHeaders(token) : commonHeaders(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
      redirect: 'error',
    })
    if (!response.ok) {
      throw new WeixinApiError('http-error', `微信服务返回 HTTP ${response.status}`, { status: response.status })
    }
    try {
      return await response.json()
    } catch (error) {
      throw new WeixinApiError('invalid-response', '微信服务返回了无法解析的内容', { cause: error })
    }
  } catch (error) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    if (timedOut) throw new WeixinApiError('timeout', '请求微信服务超时', { cause: error })
    throw error instanceof WeixinApiError
      ? error
      : new WeixinApiError('network-error', '暂时无法连接微信服务', { cause: error })
  } finally {
    if (timer) clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** 从 iLink 消息里取文字（文字消息 type=1；语音转写 type=3 也带 text）。 */
export function extractText(message) {
  for (const item of message?.item_list ?? []) {
    if (item?.type === 1 && typeof item.text_item?.text === 'string') {
      const value = item.text_item.text.trim()
      if (value) return value
    }
    if (item?.type === 3 && typeof item.voice_item?.text === 'string') {
      const value = item.voice_item.text.trim()
      if (value) return value
    }
  }
  return null
}

/** 微信单条消息上限 1800 字符，超了按段落/句读切开。 */
export function splitText(value, maxChars = DEFAULT_MAX_CHARS) {
  const content = String(value ?? '').trim()
  if (!content) return []
  if (content.length <= maxChars) return [content]
  const parts = []
  let rest = content
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf('\n', maxChars)
    if (cut < maxChars * 0.5) cut = rest.lastIndexOf('。', maxChars)
    if (cut < maxChars * 0.5) cut = rest.lastIndexOf('！', maxChars)
    if (cut < maxChars * 0.5) cut = rest.lastIndexOf('？', maxChars)
    if (cut < maxChars * 0.5) cut = maxChars
    else cut += 1
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) parts.push(rest)
  return parts.filter(Boolean)
}

export function createWeixinApi({ fetchImpl = fetch } = {}) {
  return Object.freeze({
    async beginLogin({ botType = DEFAULT_BOT_TYPE, signal } = {}) {
      const response = await requestJson(fetchImpl, {
        method: 'POST',
        baseUrl: QR_BASE_URL,
        endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
        body: { local_token_list: [] },
        timeoutMs: 10_000,
        signal,
      })
      const rejected = providerCodeOf(response, ['errcode', 'ret'])
      if (rejected) throw new WeixinApiError('qr-request-rejected', '微信服务拒绝了二维码申请', { providerCode: rejected })
      const qrcode = text(response?.qrcode)
      if (!qrcode) throw new WeixinApiError('invalid-qr', '微信服务没有返回二维码令牌')
      const imageUrl = safeImageUrl(response?.qrcode_img_content)
      // iLink 返回的是「扫码落地页」的链接，不是图片：本地把它渲成二维码。
      // qrcode 是可选依赖；没装就退回让用户点链接。
      let imageDataUrl = null
      try {
        const { default: QRCode } = await import('qrcode')
        imageDataUrl = await QRCode.toDataURL(imageUrl, { margin: 1, width: 320, errorCorrectionLevel: 'M' })
      } catch {
        imageDataUrl = null
      }
      return { qrcode, imageUrl, imageDataUrl, baseUrl: QR_BASE_URL }
    },

    async pollLogin({ qrcode, baseUrl = QR_BASE_URL, signal }) {
      const token = text(qrcode)
      if (!token) throw new TypeError('qrcode is required')
      const response = await requestJson(fetchImpl, {
        method: 'GET',
        baseUrl,
        endpoint: `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(token)}`,
        authenticated: false,
        timeoutMs: LONG_POLL_TIMEOUT_MS,
        signal,
      })
      const status = text(response?.status)
      if (!LOGIN_STATUSES.has(status)) {
        throw new WeixinApiError('invalid-login-status', '微信服务返回了无法识别的扫码状态')
      }
      return {
        status,
        botToken: text(response?.bot_token),
        accountId: text(response?.ilink_bot_id),
        ownerUserId: text(response?.ilink_user_id),
        baseUrl: text(response?.baseurl) ? safeBaseUrl(response.baseurl, '连接地址') : null,
        redirectHost: text(response?.redirect_host) || null,
      }
    },

    async getUpdates({ baseUrl, token, getUpdatesBuf = '', signal }) {
      try {
        return await requestJson(fetchImpl, {
          method: 'POST',
          baseUrl,
          endpoint: 'ilink/bot/getupdates',
          body: { get_updates_buf: getUpdatesBuf, base_info: baseInfo() },
          token,
          timeoutMs: LONG_POLL_TIMEOUT_MS,
          signal,
        })
      } catch (error) {
        if (error instanceof WeixinApiError && error.code === 'timeout') {
          return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf }
        }
        throw error
      }
    },

    async sendText({ baseUrl, token, toUserId, text: content, contextToken, signal }) {
      const recipient = text(toUserId)
      const value = text(content)
      if (!recipient || !value) throw new TypeError('toUserId and text are required')
      const response = await requestJson(fetchImpl, {
        method: 'POST',
        baseUrl,
        endpoint: 'ilink/bot/sendmessage',
        token,
        signal,
        body: {
          msg: {
            from_user_id: '',
            to_user_id: recipient,
            client_id: `dsh-wechat-bridge-${crypto.randomUUID()}`,
            message_type: 2,
            message_state: 2,
            item_list: [{ type: 1, text_item: { text: value } }],
            ...(text(contextToken) ? { context_token: text(contextToken) } : {}),
          },
          base_info: baseInfo(),
        },
      })
      const rejected = providerCodeOf(response, ['ret', 'errcode'])
      if (rejected) throw new WeixinApiError('send-rejected', '微信服务拒绝了这条消息', { providerCode: rejected })
      return { ok: true }
    },

    async getTypingTicket({ baseUrl, token, toUserId, contextToken, signal }) {
      const recipient = text(toUserId)
      if (!recipient) return null
      const response = await requestJson(fetchImpl, {
        method: 'POST',
        baseUrl,
        endpoint: 'ilink/bot/getconfig',
        token,
        signal,
        timeoutMs: 10_000,
        body: {
          ilink_user_id: recipient,
          ...(text(contextToken) ? { context_token: text(contextToken) } : {}),
          base_info: baseInfo(),
        },
      })
      const ticket = text(response?.typing_ticket)
      return ticket || null
    },

    async sendTyping({ baseUrl, token, toUserId, typingTicket, status, signal }) {
      const recipient = text(toUserId)
      const ticket = text(typingTicket)
      if (!recipient || !ticket) return false
      const response = await requestJson(fetchImpl, {
        method: 'POST',
        baseUrl,
        endpoint: 'ilink/bot/sendtyping',
        token,
        signal,
        timeoutMs: 10_000,
        body: { ilink_user_id: recipient, typing_ticket: ticket, status: status === 1 ? 1 : 2, base_info: baseInfo() },
      })
      return !providerCodeOf(response, ['ret', 'errcode'])
    },

    async notifyStart({ baseUrl, token, signal }) {
      const response = await requestJson(fetchImpl, {
        method: 'POST',
        baseUrl,
        endpoint: 'ilink/bot/msg/notifystart',
        token,
        signal,
        timeoutMs: 10_000,
        body: { base_info: baseInfo() },
      })
      const rejected = providerCodeOf(response, ['errcode', 'ret'])
      if (rejected) throw new WeixinApiError('start-rejected', '微信账号连接启动失败', { providerCode: rejected })
      return true
    },

    async notifyStop({ baseUrl, token, signal }) {
      try {
        await requestJson(fetchImpl, {
          method: 'POST',
          baseUrl,
          endpoint: 'ilink/bot/msg/notifystop',
          token,
          signal,
          timeoutMs: 5_000,
          body: { base_info: baseInfo() },
        })
      } catch {
        // 停止通知失败不影响本地清理
      }
      return true
    },
  })
}
