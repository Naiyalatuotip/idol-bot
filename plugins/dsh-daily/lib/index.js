// dsh-daily —— 按天复盘角色的对话，学语法与语义习惯（也看对方怎么说话）。
//
// 每天到点（默认 03:30）：
//   读目标会话最近 N 条消息（follow 快照，冷会话也能读）→ 问一次默认模型 →
//   写一份 markdown 复盘 + 合并「可执行规则」→ 规则作为 systemPrompt.context
//   注入到目标会话（短、稳定，不破坏前缀缓存）。
//
// 目标是目标预设（config.targetPreset，默认 example）的活着的 agent 自动纳入；也可以在页面上手动勾会话。

import { createStore } from './store.mjs'
import { readSession, buildTranscript, buildMessages, callModel, parseAnalysis, renderDigest } from './analyze.mjs'
import { renderPage } from './page.mjs'

export const name = 'dsh-daily'
export const inject = ['webServer', 'sessions', 'agents', 'sessionTitle', 'sessionController', 'agentPresets', 'agentDefaultModel', 'llm', 'timer']

const PREFIX = '/dsh-daily'
const MAX_BODY_BYTES = 64 * 1024

function todayKey(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
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
  return JSON.parse(raw)
}

function sendJson(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function sendHtml(res, html) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(html)
}

export function apply(ctx) {
  const store = createStore()
  const stateTargetPreset = () => String(store.state.targetPreset || 'example')
  let running = false
  let lastError = null
  const mounted = new WeakSet()

  const log = (message) => {
    try {
      ctx.logger?.info?.('[dsh-daily] ' + message)
    } catch {}
  }

  const titleOf = (sessionId) => {
    try {
      const service = ctx.get('sessionTitle')
      const session = ctx.get('sessions')?.get?.(sessionId)
      const snapshot = service?.get?.(session || { id: sessionId })
      return typeof snapshot?.title === 'string' ? snapshot.title.trim() : ''
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

  function autoSessionIds() {
    const ids = new Set()
    try {
      for (const agent of ctx.agents.list() || []) {
        if (presetOf(agent) === (stateTargetPreset())) ids.add(String(agent.id))
      }
    } catch {}
    return [...ids]
  }

  function targetSessionIds() {
    const configured = (store.state.sessionIds || []).filter(Boolean)
    if (configured.length) return configured
    return autoSessionIds()
  }

  function sessionList() {
    const out = []
    const seen = new Set()
    try {
      for (const session of ctx.get('sessions')?.list?.() || []) {
        const id = String(session?.id || '')
        if (!id || seen.has(id)) continue
        seen.add(id)
        const agent = ctx.agents.get(id)
        out.push({
          id,
          title: titleOf(id),
          alive: Boolean(agent),
          preset: agent ? presetOf(agent) || '' : '',
        })
      }
    } catch {}
    return out.sort((a, b) => (a.title || 'zzz').localeCompare(b.title || 'zzz', 'zh'))
  }

  function growthLine() {
    if (!store.state.enabled || !store.state.injectContext) return ''
    const g = store.state.growth || {}
    const lean = (g.topics || []).filter((x) => Number(x.weight) >= 55).slice(0, 3).map((x) => x.topic)
    const avoid = (g.avoid || []).slice(0, 2)
    const style = (g.style || []).slice(0, 1)
    const parts = []
    if (lean.length) parts.push(`多聊：${lean.join('、')}`)
    if (avoid.length) parts.push(`少提：${avoid.join('、')}`)
    if (style.length) parts.push(style[0])
    return parts.length ? `【成长】${parts.join('；').slice(0, 120)}` : ''
  }

  function rulesLine() {
    if (!store.state.enabled || !store.state.injectContext) return ''
    const rules = store.state.rules.slice(0, 3)
    if (!rules.length) return ''
    const text = rules.map((r) => r.text).join('；')
    return `【语言校准】${text.slice(0, 150)}`
  }

  function contextText() {
    return [growthLine(), rulesLine()].filter(Boolean).join('\n')
  }

  function mountContext(agent) {
    if (!agent || mounted.has(agent)) return
    if (presetOf(agent) !== (stateTargetPreset())) return
    if (!store.state.injectContext) return
    mounted.add(agent)
    try {
      agent.ctx.systemPrompt.context({
        name: 'daily',
        order: 950,
        text: () => {
          try {
            return contextText()
          } catch {
            return ''
          }
        },
      })
      log(`已给会话 ${agent.id} 挂上语言校准 context`)
    } catch (error) {
      log(`挂 context 失败：${String(error?.message || error)}`)
    }
  }

  const mountTimer = ctx.interval(() => {
    try {
      for (const agent of ctx.agents.list() || []) mountContext(agent)
    } catch {}
  }, 3_000)
  ctx.effect(() => () => {
    try {
      mountTimer()
    } catch {}
  })

  async function runDaily({ trigger = 'manual' } = {}) {
    if (running) return { ok: false, error: '已经在跑了' }
    running = true
    lastError = null
    const date = todayKey()
    try {
      const ids = targetSessionIds()
      if (!ids.length) throw new Error('没有目标会话：先打开目标会话，或在页面上勾一个')
      const sessions = []
      for (const id of ids) {
        const messages = await readSession(ctx, id, store.state.maxMessages)
        sessions.push({ id, title: titleOf(id), messages })
      }
      const transcript = buildTranscript(sessions)
      if (!transcript.trim()) throw new Error('今天没有可读的对话')
      const rules = store.state.rules
      const { system, messages } = buildMessages({ transcript, rules, growth: store.state.growth })
      const raw = await callModel(ctx, { system, messages })
      const analysis = parseAnalysis(raw)
      const added = store.addRules(analysis.newRules)
      const removed = store.removeRules(analysis.removeRules)
      store.updateGrowth(analysis.growth)
      const markdown = renderDigest({ date, analysis, added, removed, sessions, transcript })
      const path = store.writeDigest(date, markdown)
      store.recordRun({
        date,
        sessions: sessions.filter((s) => s.messages.length).length,
        messages: sessions.reduce((n, s) => n + s.messages.length, 0),
        added: added.length,
        removed,
        ok: true,
      })
      log(`复盘完成（${trigger}）：${date}，新增 ${added.length} 条规则，写 ${path}`)
      return { ok: true, date, added, removed, path, summary: analysis.summary }
    } catch (error) {
      lastError = String(error?.message || error)
      store.recordRun({ date, sessions: 0, messages: 0, added: 0, removed: 0, ok: false, error: lastError })
      log(`复盘失败（${trigger}）：${lastError}`)
      return { ok: false, error: lastError }
    } finally {
      running = false
    }
  }

  function maybeRunScheduled() {
    if (!store.state.enabled || running) return
    const now = new Date()
    const date = todayKey(now)
    if (store.state.lastRunDate === date) return
    const minutes = now.getHours() * 60 + now.getMinutes()
    const target = store.state.hour * 60 + store.state.minute
    if (minutes < target) return
    void runDaily({ trigger: 'scheduled' })
  }

  const scheduleTimer = ctx.interval(maybeRunScheduled, 60_000)
  ctx.effect(() => () => {
    try {
      scheduleTimer()
    } catch {}
  })

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
    sendJson(res, {
      ok: true,
      enabled: store.state.enabled,
      hour: store.state.hour,
      minute: store.state.minute,
      sessionIds: store.state.sessionIds,
      maxMessages: store.state.maxMessages,
      injectContext: store.state.injectContext,
      rules: store.state.rules,
      growth: store.state.growth,
      digests: store.listDigests(),
      lastRunDate: store.state.lastRunDate,
      lastRunAt: store.state.lastRunAt,
      lastResult: store.state.lastResult,
      sessions: sessionList(),
      autoSessions: autoSessionIds(),
      running,
      lastError,
      storage: store.path,
    })
  })

  route(PREFIX + '/api/config', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '只接受 POST' }, 405)
    const patch = await readJson(req)
    sendJson(res, { ok: true, state: store.update(patch) })
  })

  route(PREFIX + '/api/run', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '只接受 POST' }, 405)
    const result = await runDaily({ trigger: 'manual' })
    sendJson(res, result)
  })

  route(PREFIX + '/api/rules/delete', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '只接受 POST' }, 405)
    const body = await readJson(req)
    const removed = store.removeRules([body.text || ''])
    sendJson(res, { ok: true, removed })
  })

  route(PREFIX + '/api/rules/clear', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '只接受 POST' }, 405)
    const removed = store.removeRules(store.state.rules.map((r) => r.text))
    sendJson(res, { ok: true, removed })
  })

  route(PREFIX + '/api/growth/reset', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '只接受 POST' }, 405)
    sendJson(res, { ok: true, growth: store.resetGrowth() })
  })

  route(PREFIX + '/api/digest', async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const date = (url.searchParams.get('date') || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendJson(res, { ok: false, error: '日期格式不对' }, 400)
    const markdown = store.readDigest(date)
    if (markdown === null) return sendJson(res, { ok: false, error: '这一天的复盘不存在' }, 404)
    sendJson(res, { ok: true, date, markdown })
  })

  log(`已启动：每天 ${String(store.state.hour).padStart(2, '0')}:${String(store.state.minute).padStart(2, '0')} 复盘；页面 ${PREFIX}/`)
}
