// 插件自己的 JSON 存储：账号、绑定、见过的微信对话。
// 位置：$DSH_HOME/integrations/dsh-wechat-bridge/config.json
// 令牌只存在本机这个文件里（权限 0600），不通过任何 HTTP 接口回传。

import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')

function emptyState() {
  return {
    version: 1,
    accounts: [],
    bindings: [],
    chats: {},
    settings: { mirrorFromWeb: true, readDelay: true, typingBurst: true },
  }
}

function fileMode(path) {
  try {
    chmodSync(path, 0o600)
  } catch {
    // Windows 上无所谓；失败不影响读写
  }
}

export function createStore({ dir = join(HOME, 'integrations', 'dsh-wechat-bridge') } = {}) {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'config.json')
  let state = emptyState()

  function normalize(raw) {
    const base = emptyState()
    if (!raw || typeof raw !== 'object') return base
    const accounts = Array.isArray(raw.accounts) ? raw.accounts : []
    const bindings = Array.isArray(raw.bindings) ? raw.bindings : []
    return {
      version: 1,
      accounts: accounts
        .filter((a) => a && typeof a.accountId === 'string' && typeof a.token === 'string' && typeof a.baseUrl === 'string')
        .map((a) => ({
          accountId: a.accountId,
          ownerUserId: typeof a.ownerUserId === 'string' ? a.ownerUserId : '',
          baseUrl: a.baseUrl,
          token: a.token,
          botId: typeof a.botId === 'string' ? a.botId : a.accountId.slice(-8),
          connectedAt: typeof a.connectedAt === 'string' ? a.connectedAt : new Date().toISOString(),
          updatesBuf: typeof a.updatesBuf === 'string' ? a.updatesBuf : '',
        })),
      bindings: bindings
        .filter((b) => b && typeof b.chatId === 'string' && typeof b.sessionId === 'string')
        .map((b) => ({
          chatId: b.chatId,
          accountId: typeof b.accountId === 'string' ? b.accountId : '',
          sessionId: b.sessionId,
          createdAt: typeof b.createdAt === 'string' ? b.createdAt : new Date().toISOString(),
        })),
      chats: raw.chats && typeof raw.chats === 'object' && !Array.isArray(raw.chats) ? raw.chats : {},
      settings: {
        mirrorFromWeb: raw.settings?.mirrorFromWeb !== false,
        readDelay: raw.settings?.readDelay !== false,
        typingBurst: raw.settings?.typingBurst !== false,
      },
    }
  }

  function load() {
    if (!existsSync(path)) return state
    try {
      state = normalize(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      // 读坏了不覆盖：留一份 .broken 供排查，然后从空状态开始
      try {
        renameSync(path, `${path}.broken-${Date.now()}`)
      } catch {}
      state = emptyState()
    }
    return state
  }

  function save() {
    const tmp = `${path}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8')
    renameSync(tmp, path)
    fileMode(path)
  }

  load()

  return {
    path,
    get state() {
      return state
    },
    load,
    save,
    accounts() {
      return state.accounts
    },
    account(accountId) {
      return state.accounts.find((a) => a.accountId === accountId)
    },
    upsertAccount(account) {
      const index = state.accounts.findIndex((a) => a.accountId === account.accountId)
      if (index >= 0) state.accounts[index] = { ...state.accounts[index], ...account }
      else state.accounts.push(account)
      save()
    },
    removeAccount(accountId) {
      state.accounts = state.accounts.filter((a) => a.accountId !== accountId)
      state.bindings = state.bindings.filter((b) => b.accountId !== accountId)
      for (const key of Object.keys(state.chats)) {
        if (state.chats[key].accountId === accountId) delete state.chats[key]
      }
      save()
    },
    bindings() {
      return state.bindings
    },
    bindingsForSession(sessionId) {
      return state.bindings.filter((b) => b.sessionId === sessionId)
    },
    bindingForChat(chatId) {
      return state.bindings.find((b) => b.chatId === chatId)
    },
    bind(binding) {
      state.bindings = state.bindings.filter((b) => b.chatId !== binding.chatId)
      state.bindings.push(binding)
      save()
      return binding
    },
    unbind(chatId) {
      const before = state.bindings.length
      state.bindings = state.bindings.filter((b) => b.chatId !== chatId)
      save()
      return state.bindings.length !== before
    },
    touchChat({ accountId, chatId, lastText, contextToken }) {
      const key = `${accountId}:${chatId}`
      const previous = state.chats[key]
      state.chats[key] = {
        accountId,
        chatId,
        lastText: String(lastText ?? '').slice(0, 200),
        lastAt: new Date().toISOString(),
        ...(contextToken ? { contextToken } : previous?.contextToken ? { contextToken: previous.contextToken } : {}),
      }
      save()
    },
    chats() {
      return Object.values(state.chats).sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)))
    },
    updateSettings(patch) {
      state.settings = { ...state.settings, ...patch }
      save()
      return state.settings
    },
  }
}
