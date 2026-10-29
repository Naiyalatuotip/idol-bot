// 每日语言复盘的存储：配置、学到的规则、每天的复盘正文。
// 位置：$DSH_HOME/aoi-daily/{config.json, digests/YYYY-MM-DD.md}

import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')

function defaults() {
  return {
    version: 1,
    enabled: true,
    hour: 3,
    minute: 30,
    sessionIds: [],
    maxMessages: 120,
    injectContext: true,
    rules: [],
    growth: { topics: [], style: [], avoid: [], updatedAt: '' },
    lastRunDate: '',
    lastRunAt: '',
    lastResult: null,
    runs: [],
  }
}

function normalizeRule(rule) {
  if (!rule || typeof rule !== 'object') return null
  const text = String(rule.text || '').trim()
  if (!text) return null
  return {
    id: String(rule.id || ''),
    text: text.slice(0, 120),
    hits: Number.isFinite(Number(rule.hits)) ? Math.max(1, Math.round(Number(rule.hits))) : 1,
    firstSeen: typeof rule.firstSeen === 'string' ? rule.firstSeen : new Date().toISOString(),
    lastSeen: typeof rule.lastSeen === 'string' ? rule.lastSeen : new Date().toISOString(),
  }
}

function normalize(raw) {
  const base = defaults()
  if (!raw || typeof raw !== 'object') return base
  const rules = (Array.isArray(raw.rules) ? raw.rules : []).map(normalizeRule).filter(Boolean).slice(0, 24)
  return {
    version: 1,
    enabled: raw.enabled !== false,
    hour: Number.isFinite(Number(raw.hour)) ? Math.min(23, Math.max(0, Math.round(Number(raw.hour)))) : base.hour,
    minute: Number.isFinite(Number(raw.minute)) ? Math.min(59, Math.max(0, Math.round(Number(raw.minute)))) : base.minute,
    sessionIds: (Array.isArray(raw.sessionIds) ? raw.sessionIds : []).filter((x) => typeof x === 'string' && x.trim()).slice(0, 32),
    maxMessages: Number.isFinite(Number(raw.maxMessages)) ? Math.min(400, Math.max(20, Math.round(Number(raw.maxMessages)))) : base.maxMessages,
    injectContext: raw.injectContext !== false,
    rules,
    growth: normalizeGrowth(raw.growth),
    lastRunDate: typeof raw.lastRunDate === 'string' ? raw.lastRunDate : '',
    lastRunAt: typeof raw.lastRunAt === 'string' ? raw.lastRunAt : '',
    lastResult: raw.lastResult && typeof raw.lastResult === 'object' ? raw.lastResult : null,
    runs: (Array.isArray(raw.runs) ? raw.runs : []).slice(-30),
  }
}

function clampWeight(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 50)))
}

function normalizeGrowth(raw) {
  const g = raw && typeof raw === 'object' ? raw : {}
  const topics = (Array.isArray(g.topics) ? g.topics : [])
    .filter((x) => x && typeof x.topic === 'string' && x.topic.trim())
    .map((x) => ({
      topic: String(x.topic).trim().slice(0, 20),
      weight: clampWeight(x.weight),
      reason: String(x.reason || '').slice(0, 80),
      updatedAt: typeof x.updatedAt === 'string' ? x.updatedAt : '',
    }))
    .slice(0, 16)
  const style = (Array.isArray(g.style) ? g.style : []).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 80)).slice(0, 8)
  const avoid = (Array.isArray(g.avoid) ? g.avoid : []).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 80)).slice(0, 6)
  return { topics, style, avoid, updatedAt: typeof g.updatedAt === 'string' ? g.updatedAt : '' }
}

export function createStore({ dir = join(HOME, 'aoi-daily') } = {}) {
  mkdirSync(join(dir, 'digests'), { recursive: true })
  const configPath = join(dir, 'config.json')
  let state = defaults()

  function load() {
    if (!existsSync(configPath)) return state
    try {
      state = normalize(JSON.parse(readFileSync(configPath, 'utf8')))
    } catch {
      try {
        renameSync(configPath, `${configPath}.broken-${Date.now()}`)
      } catch {}
      state = defaults()
    }
    return state
  }

  function save() {
    const tmp = `${configPath}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8')
    renameSync(tmp, configPath)
  }

  function key(text) {
    return String(text || '').replace(/[\s，。！？、；：""''（）()]/g, '').toLowerCase()
  }

  function update(patch) {
    if (patch && typeof patch === 'object') {
      if (typeof patch.enabled === 'boolean') state.enabled = patch.enabled
      if (Number.isFinite(Number(patch.hour))) state.hour = Math.min(23, Math.max(0, Math.round(Number(patch.hour))))
      if (Number.isFinite(Number(patch.minute))) state.minute = Math.min(59, Math.max(0, Math.round(Number(patch.minute))))
      if (Array.isArray(patch.sessionIds)) state.sessionIds = patch.sessionIds.filter((x) => typeof x === 'string' && x.trim()).slice(0, 32)
      if (Number.isFinite(Number(patch.maxMessages))) state.maxMessages = Math.min(400, Math.max(20, Math.round(Number(patch.maxMessages))))
      if (typeof patch.injectContext === 'boolean') state.injectContext = patch.injectContext
    }
    save()
    return state
  }

  function addRules(texts) {
    const added = []
    const now = new Date().toISOString()
    for (const raw of texts || []) {
      const text = String(raw || '').trim().slice(0, 120)
      if (!text) continue
      const k = key(text)
      if (!k) continue
      const existing = state.rules.find((r) => key(r.text) === k)
      if (existing) {
        existing.hits += 1
        existing.lastSeen = now
        continue
      }
      // 近似去重：一方包含另一方（长度 ≥6）就算同一条
      const close = state.rules.find((r) => {
        const a = key(r.text)
        return a.length >= 6 && k.length >= 6 && (a.includes(k) || k.includes(a))
      })
      if (close) {
        close.hits += 1
        close.lastSeen = now
        continue
      }
      state.rules.push({ id: `r-${Date.now()}-${added.length}`, text, hits: 1, firstSeen: now, lastSeen: now })
      added.push(text)
    }
    // 保留命中最多的 16 条
    state.rules = state.rules.sort((a, b) => b.hits - a.hits || b.lastSeen.localeCompare(a.lastSeen)).slice(0, 16)
    if (added.length) save()
    return added
  }

  function removeRules(texts) {
    const keys = (texts || []).map(key).filter(Boolean)
    if (!keys.length) return 0
    const before = state.rules.length
    state.rules = state.rules.filter((r) => {
      const k = key(r.text)
      return !keys.some((x) => k === x || (k.length >= 6 && x.length >= 6 && (k.includes(x) || x.includes(k))))
    })
    const removed = before - state.rules.length
    if (removed) save()
    return removed
  }

  // 人格生长：话题权重 + 风格/回避偏好。
  // 规则：旧权重每天向 50 回落 1；新 delta 每天最多 ±12；话题最多 16 个。
  function updateGrowth(patch) {
    const now = new Date().toISOString()
    const g = state.growth
    const topics = new Map(g.topics.map((x) => [x.topic, { ...x }]))
    // 先衰减
    for (const item of topics.values()) {
      item.weight = clampWeight(item.weight > 50 ? item.weight - 1 : item.weight < 50 ? item.weight + 1 : 50)
    }
    for (const raw of (patch && Array.isArray(patch.topics) ? patch.topics : [])) {
      const topic = String(raw?.topic || '').trim().slice(0, 20)
      if (!topic) continue
      const delta = Math.max(-12, Math.min(12, Math.round(Number(raw?.delta) || 0)))
      const current = topics.get(topic)
      if (current) {
        current.weight = clampWeight(current.weight + delta)
        current.reason = String(raw?.reason || current.reason || '').slice(0, 80)
        current.updatedAt = now
      } else {
        topics.set(topic, { topic, weight: clampWeight(50 + delta), reason: String(raw?.reason || '').slice(0, 80), updatedAt: now })
      }
    }
    state.growth = {
      topics: [...topics.values()].sort((a, b) => b.weight - a.weight).slice(0, 16),
      style: (Array.isArray(patch?.style) && patch.style.length ? patch.style : g.style)
        .filter((x) => typeof x === 'string' && x.trim())
        .map((x) => x.trim().slice(0, 80))
        .slice(0, 8),
      avoid: (Array.isArray(patch?.avoid) && patch.avoid.length ? patch.avoid : g.avoid)
        .filter((x) => typeof x === 'string' && x.trim())
        .map((x) => x.trim().slice(0, 80))
        .slice(0, 6),
      updatedAt: now,
    }
    save()
    return state.growth
  }

  function resetGrowth() {
    state.growth = { topics: [], style: [], avoid: [], updatedAt: '' }
    save()
    return state.growth
  }

  function recordRun(entry) {
    state.lastRunDate = entry.date
    state.lastRunAt = new Date().toISOString()
    state.lastResult = {
      ok: entry.ok !== false,
      date: entry.date,
      sessions: entry.sessions,
      messages: entry.messages,
      added: entry.added,
      removed: entry.removed,
      error: entry.error || null,
    }
    state.runs.push({ ...state.lastResult, at: state.lastRunAt })
    state.runs = state.runs.slice(-30)
    save()
  }

  function digestPath(date) {
    return join(dir, 'digests', `${date}.md`)
  }

  function writeDigest(date, markdown) {
    const path = digestPath(date)
    const tmp = `${path}.tmp-${process.pid}`
    writeFileSync(tmp, markdown, 'utf8')
    renameSync(tmp, path)
    return path
  }

  function readDigest(date) {
    const path = digestPath(date)
    if (!existsSync(path)) return null
    return readFileSync(path, 'utf8')
  }

  function listDigests() {
    try {
      return readdirSync(join(dir, 'digests'))
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .sort()
        .reverse()
        .slice(0, 60)
        .map((f) => f.slice(0, 10))
    } catch {
      return []
    }
  }

  load()

  return {
    path: configPath,
    get state() {
      return state
    },
    load,
    save,
    update,
    addRules,
    removeRules,
    updateGrowth,
    resetGrowth,
    recordRun,
    writeDigest,
    readDigest,
    listDigests,
  }
}
