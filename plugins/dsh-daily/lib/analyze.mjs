// 每日语言复盘的“读对话 + 问模型 + 写复盘”。
// 只读会话事件，不改会话；产出一份 md 和若干条可执行规则。

import { randomUUID } from 'node:crypto'

const MAX_TRANSCRIPT_CHARS = 6000

export function messageText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

// 会话里混着几种「不是人说的话」：运行时快照、技能清单、主动搭话的内心念头。
// 复盘时全部跳过，否则会把系统提示当成对方在说话。
const NOISE_PREFIXES = [
  'Current runtime context.',
  '<system-reminder>',
  '<available_skills>',
  '（下面这句是**你自己心里冒出来的念头**',
  '（下面这句是你自己心里冒出来的念头',
]
function isNoise(text) {
  const head = String(text || '').trimStart()
  return NOISE_PREFIXES.some((prefix) => head.startsWith(prefix))
}

function recordMessage(record) {
  const event = record?.event || record
  if (!event || typeof event !== 'object') return null
  if (event.type !== 'user/message' && event.type !== 'assistant/message') return null
  const data = event.data || {}
  const message = data.message || data
  const text = messageText(message)
  if (!text || isNoise(text)) return null
  return {
    role: event.type === 'user/message' ? 'user' : 'assistant',
    text,
    seq: Number(event.seq) || 0,
  }
}

/** 用 follow 的开场快照读最近 maxMessages 条；读完立刻中止，不挂长连接。 */
export async function readSession(ctx, sessionId, maxMessages = 120) {
  const controller = ctx.get('sessionController')
  if (!controller || typeof controller.follow !== 'function') throw new Error('sessionController 不可用')
  const signal = new AbortController()
  const messages = []
  try {
    const stream = controller.follow({ address: { kind: 'session', sessionId }, maxMessages }, signal.signal)
    for await (const frame of stream) {
      if (frame?.type !== 'snapshot') break
      for (const record of frame.records || []) {
        const item = recordMessage(record)
        if (item) messages.push(item)
      }
      break
    }
  } finally {
    try {
      signal.abort()
    } catch {}
  }
  return messages
}

export function buildTranscript(sessions) {
  const lines = []
  let chars = 0
  for (const session of sessions) {
    if (!session.messages.length) continue
    lines.push(`【会话：${session.title || session.id}】`)
    for (const m of session.messages) {
      const line = `${m.role === 'user' ? 'S' : 'A'}: ${m.text.replace(/\n+/g, ' ').slice(0, 300)}`
      if (chars + line.length > MAX_TRANSCRIPT_CHARS) break
      lines.push(line)
      chars += line.length
    }
    if (chars >= MAX_TRANSCRIPT_CHARS) break
  }
  return lines.join('\n')
}

export function buildMessages({ transcript, rules, growth }) {
  const system = [
    '你是这个角色的语言教练，只做一件事：根据今天的真实对话，指出她说话的问题、总结对方（用户）的语言习惯，并产出可以直接执行的短规则。',
    '判断标准：她话多、句子短、反应快、先接住对方；爱用宝宝/呜呜/笑死我了/帅死了这些词；不端着、不说教、不客服腔。',
    '规则只写用词、语气、性格一致性、语义是否说清楚——**不要**产出字数、换行、开头格式、比例、分段这类格式规则。',
    '规则必须短（≤40 字）、可执行、不空泛；禁止写“要自然”“要有感情”这类废话；不要改人设，不要写具体台词。',
    '只输出 JSON，不要解释、不要 Markdown 代码块。',
  ].join('\n')
  const ruleLines = (rules || []).length
    ? rules.map((r, i) => `${i + 1}. ${r.text}`).join('\n')
    : '（还没有规则）'
  const g = growth && typeof growth === 'object' ? growth : {}
  const lean = (g.topics || []).filter((x) => Number(x.weight) >= 55).slice(0, 4).map((x) => `${x.topic}(${x.weight})`)
  const growthLines = [
    `多聊：${lean.length ? lean.join('、') : '（还没有明显偏向）'}`,
    `少主动提：${(g.avoid || []).slice(0, 3).join('、') || '（无）'}`,
    `风格：${(g.style || []).slice(0, 3).join('；') || '（无）'}`,
  ].join('\n')
  const user = [
    '今天的对话（S=对方，A=角色）：',
    transcript || '（今天没有可读的对话）',
    '',
    '当前生效的规则：',
    ruleLines,
    '',
    '当前的成长档案（话题权重 0–100，50 是中性）：',
    growthLines,
    '',
    '请根据今天的对话更新成长档案。判断依据是**他的反应**：他回得长、主动追问、笑、接梗 → 这个话题加分；他回得短（嗯/哦/行吧）、换话题、隔很久才回、情绪变冷 → 减分。他的情绪也要算进去：他累/烦的时候，先照顾情绪的话题加分，硬聊轻松话题减分。',
    'delta 范围 -12～12，只写今天真正出现过的话题；没有明显证据就不写。style/avoid 只在证据清楚时写，最多各 3 条，不要写格式规则。',
    '',
    '请输出这个 JSON（newRules 至少 2 条，只写用词/语气/语义；removeRules 只在某条旧规则明显错/过时才写）：',
    '{',
    '  "summary": "≤80 字的今日观察",',
    '  "issues": [{"kind":"语法|语义|节奏|口头禅","problem":"","fix":"","evidence":"原句"}],',
    '  "userHabits": [{"habit":"对方的语言习惯","howToRespond":"角色该怎么接"}],',
    '  "newRules": ["≤40 字的可执行规则"],',
    '  "removeRules": ["要删掉的旧规则原文"],',
    '  "growth": {',
    '    "topics": [{"topic": "话题名", "delta": 0, "reason": "他的反应证据"}],',
    '    "style": ["最多 3 条，他吃哪一套"],',
    '    "avoid": ["最多 3 条，他明显不接的话题/说法"]',
    '  }',
    '}',
  ].join('\n')
  return {
    system,
    messages: [{
      role: 'user',
      id: randomUUID(),
      content: [{ type: 'text', text: user }],
      source: { kind: 'plugin', plugin: 'dsh-daily' },
    }],
  }
}

export async function callModel(ctx, { system, messages, maxTokens = 1800 }) {
  const selection = ctx.get('agentDefaultModel')?.currentSelection?.() || {}
  const provider = selection.provider
  const model = selection.model
  if (!provider || !model) throw new Error('拿不到默认模型（agentDefaultModel）')
  let out = ''
  for await (const chunk of ctx.llm.stream({ provider, model, system, messages, maxTokens, temperature: 0.2 })) {
    if (!chunk) continue
    if (chunk.type === 'text-delta') out += chunk.text
    if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
      throw new Error(`模型返回错误：${chunk.reason.failure?.message || 'unknown'}`)
    }
  }
  return out
}

export function parseAnalysis(raw) {
  const text = String(raw || '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型没有返回 JSON')
  const data = JSON.parse(text.slice(start, end + 1))
  const list = (value) => (Array.isArray(value) ? value : [])
  return {
    summary: String(data.summary || '').trim().slice(0, 200),
    issues: list(data.issues).filter((x) => x && x.problem).slice(0, 8).map((x) => ({
      kind: String(x.kind || '语法').slice(0, 10),
      problem: String(x.problem || '').slice(0, 160),
      fix: String(x.fix || '').slice(0, 160),
      evidence: String(x.evidence || '').slice(0, 160),
    })),
    userHabits: list(data.userHabits).filter((x) => x && x.habit).slice(0, 6).map((x) => ({
      habit: String(x.habit || '').slice(0, 160),
      howToRespond: String(x.howToRespond || '').slice(0, 160),
    })),
    newRules: list(data.newRules).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 8),
    removeRules: list(data.removeRules).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 6),
    growth: {
      topics: list(data.growth?.topics).filter((x) => x && x.topic).slice(0, 8).map((x) => ({
        topic: String(x.topic || '').slice(0, 20),
        delta: Math.max(-12, Math.min(12, Math.round(Number(x.delta) || 0))),
        reason: String(x.reason || '').slice(0, 80),
      })),
      style: list(data.growth?.style).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3),
      avoid: list(data.growth?.avoid).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3),
    },
  }
}

export function renderDigest({ date, analysis, added, removed, sessions, transcript }) {
  const lines = []
  lines.push(`# ${date} 语言复盘`, '')
  lines.push(`> 会话 ${sessions.length} 个｜消息 ${sessions.reduce((n, s) => n + s.messages.length, 0)} 条｜生成于 ${new Date().toLocaleString('zh-CN')}`, '')
  if (analysis.summary) lines.push('## 今日观察', '', analysis.summary, '')
  if (analysis.issues.length) {
    lines.push('## 角色的问题', '', '| 类型 | 问题 | 改法 | 证据 |', '|---|---|---|---|')
    for (const x of analysis.issues) lines.push(`| ${x.kind} | ${x.problem} | ${x.fix} | ${x.evidence} |`)
    lines.push('')
  }
  if (analysis.userHabits.length) {
    lines.push('## 对方的语言习惯', '', '| 习惯 | 角色该怎么接 |', '|---|---|')
    for (const x of analysis.userHabits) lines.push(`| ${x.habit} | ${x.howToRespond} |`)
    lines.push('')
  }
  if (analysis.growth && (analysis.growth.topics.length || analysis.growth.style.length || analysis.growth.avoid.length)) {
    lines.push('## 人格生长（话题与偏好）', '')
    if (analysis.growth.topics.length) {
      lines.push('| 话题 | delta | 依据 |', '|---|---|---|')
      for (const x of analysis.growth.topics) lines.push(`| ${x.topic} | ${x.delta > 0 ? '+' : ''}${x.delta} | ${x.reason} |`)
      lines.push('')
    }
    if (analysis.growth.style.length) lines.push('**他吃哪一套**：' + analysis.growth.style.join('；'), '')
    if (analysis.growth.avoid.length) lines.push('**少碰**：' + analysis.growth.avoid.join('；'), '')
  }
  if (added.length) {
    lines.push('## 新学到的规则', '')
    for (const text of added) lines.push(`- ${text}`)
    lines.push('')
  }
  if (removed) lines.push('## 移除的规则', '', `- 共移除 ${removed} 条（见上一版复盘/规则列表）`, '')
  lines.push('## 对话样本', '', '```', transcript || '（无）', '```', '')
  return lines.join('\n')
}
