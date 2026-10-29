// dsh-surf 的存储：QQ 桥 + 微博阅读共用一份 config.json。
// 位置：$DSH_HOME/integrations/dsh-surf/config.json（0600）

import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')

function defaults() {
  return {
    version: 1,
    qq: { url: 'ws://127.0.0.1:3001', token: '', selfId: '', connectedAt: '', lastError: '' },
    qqChats: {},
    qqBindings: [],
    weibo: {
      cookies: '',
      uid: '',
      count: 20,
      followingShare: 0.75,
      intervalMin: 0,
      enableShare: false,
      interests: '',
      screenName: '',
      lastLoginAt: '',
      lastFetchAt: '',
      lastError: '',
    },
    weiboSeen: {},
    weiboCache: [],
    settings: {},
  }
}

function norm(raw) {
  const base = defaults()
  if (!raw || typeof raw !== 'object') return base
  const qq = raw.qq && typeof raw.qq === 'object' ? raw.qq : {}
  const wb = raw.weibo && typeof raw.weibo === 'object' ? raw.weibo : {}
  return {
    version: 1,
    qq: {
      url: typeof qq.url === 'string' ? qq.url : base.qq.url,
      token: typeof qq.token === 'string' ? qq.token : '',
      selfId: typeof qq.selfId === 'string' ? qq.selfId : '',
      connectedAt: typeof qq.connectedAt === 'string' ? qq.connectedAt : '',
      lastError: typeof qq.lastError === 'string' ? qq.lastError : '',
    },
    qqChats: raw.qqChats && typeof raw.qqChats === 'object' && !Array.isArray(raw.qqChats) ? raw.qqChats : {},
    qqBindings: (Array.isArray(raw.qqBindings) ? raw.qqBindings : [])
      .filter((b) => b && typeof b.chatKey === 'string' && typeof b.sessionId === 'string')
      .map((b) => ({ chatKey: b.chatKey, sessionId: b.sessionId, createdAt: typeof b.createdAt === 'string' ? b.createdAt : '' })),
    weibo: {
      cookies: typeof wb.cookies === 'string' ? wb.cookies : '',
      uid: typeof wb.uid === 'string' ? wb.uid : '',
      count: Number.isFinite(Number(wb.count)) ? Math.min(50, Math.max(5, Math.round(Number(wb.count)))) : base.weibo.count,
      followingShare: Number.isFinite(Number(wb.followingShare)) ? Math.min(1, Math.max(0.5, Number(wb.followingShare))) : base.weibo.followingShare,
      intervalMin: Number.isFinite(Number(wb.intervalMin)) ? Math.max(0, Math.round(Number(wb.intervalMin))) : 0,
      enableShare: wb.enableShare === true,
      interests: typeof wb.interests === 'string' ? wb.interests : '',
      screenName: typeof wb.screenName === 'string' ? wb.screenName : '',
      lastLoginAt: typeof wb.lastLoginAt === 'string' ? wb.lastLoginAt : '',
      lastFetchAt: typeof wb.lastFetchAt === 'string' ? wb.lastFetchAt : '',
      lastError: typeof wb.lastError === 'string' ? wb.lastError : '',
    },
    weiboSeen: raw.weiboSeen && typeof raw.weiboSeen === 'object' && !Array.isArray(raw.weiboSeen) ? raw.weiboSeen : {},
    weiboCache: Array.isArray(raw.weiboCache) ? raw.weiboCache.slice(-100) : [],
    settings: raw.settings && typeof raw.settings === 'object' ? raw.settings : {},
  }
}

export function createStore({ dir = join(HOME, 'integrations', 'dsh-surf') } = {}) {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'config.json')
  let state = defaults()

  function load() {
    if (!existsSync(path)) return state
    try {
      state = norm(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      try {
        renameSync(path, `${path}.broken-${Date.now()}`)
      } catch {}
      state = defaults()
    }
    return state
  }

  function save() {
    const tmp = `${path}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8')
    renameSync(tmp, path)
    try {
      chmodSync(path, 0o600)
    } catch {}
  }

  function updateQq(patch) {
    if (patch && typeof patch === 'object') {
      if (typeof patch.url === 'string') state.qq.url = patch.url.trim()
      if (typeof patch.token === 'string') state.qq.token = patch.token.trim()
    }
    save()
    return state.qq
  }

  function updateWeibo(patch) {
    if (patch && typeof patch === 'object') {
      const w = state.weibo
      if (typeof patch.cookies === 'string') w.cookies = patch.cookies.trim()
      if (typeof patch.uid === 'string') w.uid = patch.uid.trim()
      if (Number.isFinite(Number(patch.count))) w.count = Math.min(50, Math.max(5, Math.round(Number(patch.count))))
      if (Number.isFinite(Number(patch.followingShare))) w.followingShare = Math.min(1, Math.max(0.5, Number(patch.followingShare)))
      if (Number.isFinite(Number(patch.intervalMin))) w.intervalMin = Math.max(0, Math.round(Number(patch.intervalMin)))
      if (typeof patch.enableShare === 'boolean') w.enableShare = patch.enableShare
      if (typeof patch.interests === 'string') w.interests = patch.interests.trim()
    }
    save()
    return state.weibo
  }

  function saveWeiboLogin({ cookies, uid, screenName }) {
    state.weibo.cookies = String(cookies || '').trim()
    if (uid) state.weibo.uid = String(uid)
    if (screenName) state.weibo.screenName = String(screenName)
    state.weibo.lastLoginAt = new Date().toISOString()
    state.weibo.lastError = ''
    save()
    return state.weibo
  }

  function bindQq(chatKey, sessionId) {
    const key = String(chatKey || '').trim()
    const sid = String(sessionId || '').trim()
    if (!key || !sid) throw new Error('chatKey 和 sessionId 都要给')
    state.qqBindings = state.qqBindings.filter((b) => b.chatKey !== key)
    state.qqBindings.push({ chatKey: key, sessionId: sid, createdAt: new Date().toISOString() })
    save()
    return state.qqBindings
  }

  function unbindQq(chatKey) {
    const key = String(chatKey || '').trim()
    const before = state.qqBindings.length
    state.qqBindings = state.qqBindings.filter((b) => b.chatKey !== key)
    save()
    return before !== state.qqBindings.length
  }

  function bindingForChat(chatKey) {
    return state.qqBindings.find((b) => b.chatKey === chatKey)
  }

  function bindingsForSession(sessionId) {
    return state.qqBindings.filter((b) => b.sessionId === sessionId)
  }

  function touchChat(chatKey, text) {
    state.qqChats[chatKey] = { lastText: String(text || '').slice(0, 200), at: new Date().toISOString() }
    save()
  }

  function markWeiboFetched(found) {
    state.weibo.lastFetchAt = new Date().toISOString()
    const now = Date.now()
    for (const post of found || []) {
      if (post?.id) state.weiboSeen[post.id] = now
    }
    // 只留 7 天的已读记录
    for (const [id, at] of Object.entries(state.weiboSeen)) {
      if (now - Number(at) > 7 * 24 * 3600 * 1000) delete state.weiboSeen[id]
    }
    state.weiboCache = (found || []).slice(0, 100)
    save()
  }

  load()

  return {
    path,
    get state() {
      return state
    },
    load,
    save,
    updateQq,
    updateWeibo,
    saveWeiboLogin,
    bindQq,
    unbindQq,
    bindingForChat,
    bindingsForSession,
    touchChat,
    markWeiboFetched,
  }
}
