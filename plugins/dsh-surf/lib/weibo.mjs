// 微博阅读：用账号 cookies 读「关注」和「推荐」时间线，按他的兴趣排序。
// 只读，不点赞、不转发、不评论。

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'

const DEFAULT_WORDS = [
  '瓦', '瓦罗兰特', '无畏契约', 'Valorant', 'VCT', 'FNC', 'EDG', 'CSGO', 'CS2', 'ropz', 'vitality', 'spirit', 'falcons',
  '三角洲', '战场', '阴阳师', '战双', 'LoL', '英雄联盟', 'FPS', 'Apex', 'OW', '守望先锋',
  '诡秘', '道诡', '神秘复苏', '瘟疫医生', '斩神', '克苏鲁', '克系', '西幻', '玄幻', '轻小说',
  '番剧', '新番', '孤独摇滚', 'MyGO', 'GBC', '鲁路修', '辉夜', '约战', '刀剑', '狐妖小红娘',
  '摄影', '相机', '出片', '修图', '调色', '剪辑', 'MAD', 'music', 'phonk', 'jpop', 'jrock', '说唱',
  'sd', 'StarDiary', '地偶', '偶像', '舞台', '返图', '安可', '毕业',
]

function headers(cookies) {
  const jar = String(cookies || '')
  const csrf = (jar.split(';').map((x) => x.trim()).find((x) => x.startsWith('X-CSRF-TOKEN=') || x.startsWith('XSRF-TOKEN=')) || '').split('=').slice(1).join('=')
  return {
    cookie: jar,
    'user-agent': UA,
    referer: 'https://weibo.com/',
    accept: 'application/json, text/plain, */*',
    'x-requested-with': 'XMLHttpRequest',
    ...(csrf ? { 'x-csrf-token': decodeURIComponent(csrf), 'x-xsrf-token': decodeURIComponent(csrf) } : {}),
  }
}

async function fetchJson(url, cookies, signal) {
  const res = await fetch(url, { headers: headers(cookies), signal })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}：${text.slice(0, 120)}`)
  if (text.trim().startsWith('<')) throw new Error('微博返回了网页而不是 JSON（cookies 可能失效）')
  return JSON.parse(text)
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

export function htmlToText(html) {
  return decodeEntities(String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizePost(raw, source) {
  const m = raw?.mblog || raw?.status || raw
  if (!m || typeof m !== 'object') return null
  const user = m.user || {}
  const id = String(m.id ?? m.mid ?? m.mblogid ?? '')
  const text = htmlToText(m.text_raw ?? m.text ?? '')
  if (!id || !text) return null
  const mblogid = String(m.mblogid ?? '')
  const url = mblogid && user.id ? `https://weibo.com/${user.id}/${mblogid}` : `https://m.weibo.cn/detail/${String(m.mid ?? id)}`
  return {
    id,
    mid: String(m.mid ?? ''),
    text,
    author: String(user.screen_name ?? user.name ?? '').trim(),
    authorId: String(user.id ?? ''),
    likes: Number(m.attitudes_count) || 0,
    reposts: Number(m.reposts_count) || 0,
    comments: Number(m.comments_count) || 0,
    createdAt: String(m.created_at ?? ''),
    url,
    source,
    images: Array.isArray(m.pic_ids) ? m.pic_ids.length : Number(m.pic_num) || 0,
  }
}

function collectStatuses(payload) {
  const out = []
  const push = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const p = normalizePost(item, '')
        if (p) out.push(p)
      }
    }
  }
  const data = payload?.data ?? payload
  push(data?.statuses)
  push(data?.list)
  push(data?.cards?.map((c) => c?.mblog || c?.card_group?.map((g) => g?.mblog)).flat())
  push(data?.groups?.map((g) => g?.statuses).flat())
  return out.filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i)
}

async function fetchFollowing(count, cookies, signal) {
  const urls = [
    `https://weibo.com/ajax/feed/friendstimeline?list_id=0&since_id=0&max_id=0&count=${count}&refresh=0`,
  ]
  let lastError = null
  for (const url of urls) {
    try {
      const json = await fetchJson(url, cookies, signal)
      const list = collectStatuses(json)
      if (list.length) return list.map((p) => ({ ...p, source: 'following' }))
      lastError = new Error('没有解析到微博（接口返回空）')
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('关注时间线读不到')
}

async function fetchRecommend(count, cookies, signal) {
  const urls = [
    `https://weibo.com/ajax/feed/hottimeline?since_id=0&max_id=0&count=${count}&refresh=0&group_id=102803&containerid=102803&extparam=discover%7Cnew_feed`,
    `https://m.weibo.cn/api/container/getIndex?containerid=102803&page_type=0`,
  ]
  let lastError = null
  for (const url of urls) {
    try {
      const json = await fetchJson(url, cookies, signal)
      const list = collectStatuses(json)
      if (list.length) return list.map((p) => ({ ...p, source: 'recommend' }))
      lastError = new Error('没有解析到微博（接口返回空）')
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('推荐时间线读不到')
}

function wordsFrom(cfgText, growthText) {
  const raw = [cfgText, growthText, DEFAULT_WORDS.join(' ')].join(' ')
  return [...new Set(raw.split(/[\s,，、;；|/]+/).map((x) => x.trim()).filter(Boolean))].slice(0, 120)
}

function ageHours(createdAt) {
  const t = Date.parse(createdAt)
  if (!Number.isFinite(t)) return 24
  return Math.max(0, (Date.now() - t) / 3600000)
}

export function rankPosts(posts, { interests = '', growthTopics = [], seen = {} } = {}) {
  const words = wordsFrom(interests, growthTopics.join(' '))
  const now = Date.now()
  return posts
    .map((post) => {
      const hits = []
      for (const w of words) if (post.text.includes(w)) {
        hits.push(w)
        if (hits.length >= 3) break
      }
      const engagement = post.likes + post.reposts * 2 + post.comments * 1.5
      const engScore = Math.log10(1 + engagement) * 3
      const hours = ageHours(post.createdAt)
      const freshScore = hours < 1 ? 3 : hours < 6 ? 2 : hours < 24 ? 1 : 0
      const seenPenalty = seen[post.id] ? -4 : 0
      // 兴趣命中权重高于纯热度：目标是「他可能感兴趣」，不是热榜
      const score = hits.length * 6 + engScore + freshScore + seenPenalty
      const why = hits.length
        ? `提到 ${hits.join(' / ')}`
        : engagement > 500
          ? '热度高'
          : hours < 6
            ? '刚发不久'
            : '推荐里翻到的'
      return { ...post, score: Math.round(score * 10) / 10, why }
    })
    .sort((a, b) => b.score - a.score)
}

export function formatPosts(posts, { max = 8 } = {}) {
  return posts.slice(0, max).map((p, i) => {
    const stats = `${p.likes} 赞 / ${p.reposts} 转 / ${p.comments} 评`
    return `${i + 1}. [${p.source === 'following' ? '关注' : '推荐'}] ${p.author || '（无署名）'}：${p.text.slice(0, 120)}${p.text.length > 120 ? '…' : ''}\n   ${stats} · ${p.why}\n   ${p.url}`
  }).join('\n\n')
}

export async function browse(cfg, { kind = 'mixed', count = 0, seen = {}, growthTopics = [] } = {}) {
  if (!cfg.cookies) throw new Error('还没填微博 cookies（设置页 → 微博）')
  const total = Math.max(5, Math.min(50, Number(count) || cfg.count || 20))
  const share = Math.min(1, Math.max(0.5, Number(cfg.followingShare) || 0.75))
  let fCount = 0
  let rCount = 0
  if (kind === 'following') fCount = total
  else if (kind === 'recommend') rCount = total
  else {
    fCount = Math.max(1, Math.round(total * share))
    rCount = Math.max(0, total - fCount)
    if (total >= 2 && rCount === 0) rCount = 1
    if (total >= 2 && fCount === 0) fCount = 1
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('微博请求超时')), 20000)
  try {
    const jobs = []
    if (fCount) jobs.push({ source: 'following', quota: fCount, promise: fetchFollowing(fCount, cfg.cookies, controller.signal) })
    if (rCount) jobs.push({ source: 'recommend', quota: rCount, promise: fetchRecommend(rCount, cfg.cookies, controller.signal) })
    const results = await Promise.allSettled(jobs.map((j) => j.promise))
    const errors = []
    const pools = { following: [], recommend: [] }
    results.forEach((res, i) => {
      if (res.status === 'fulfilled') pools[jobs[i].source] = res.value
      else errors.push(String(res.reason?.message || res.reason))
    })
    const rankedF = rankPosts(pools.following, { interests: cfg.interests, growthTopics, seen }).slice(0, fCount)
    const rankedR = rankPosts(pools.recommend, { interests: cfg.interests, growthTopics, seen }).slice(0, rCount)
    // 按 3 关注 : 1 推荐 交错（组内仍按分数），让 3/4 的比例在阅读顺序上也成立
    let posts = []
    let fi = 0
    let ri = 0
    while (fi < rankedF.length || ri < rankedR.length) {
      for (let k = 0; k < 3 && fi < rankedF.length; k++) posts.push(rankedF[fi++])
      if (ri < rankedR.length) posts.push(rankedR[ri++])
    }
    // 一边失败时用另一边补足数量，但不会把比例反过来
    if (posts.length < total) {
      const spare = (rankedF.length ? rankedR : rankedF).filter((p) => !posts.some((x) => x.id === p.id))
      posts = posts.concat(spare.slice(0, total - posts.length))
    }
    if (!posts.length) throw new Error(errors.join('；') || '没读到微博')
    return { posts, errors, mix: { following: rankedF.length, recommend: rankedR.length } }
  } finally {
    clearTimeout(timer)
  }
}


export function buildSharePrompt(posts, { now = new Date() } = {}) {
  const top = posts.slice(0, 3)
  const lines = [
    `（微博分享提示：现在是 ${now.toLocaleString('zh-CN')}，你刚刷了会儿微博，看到下面这些。挑一条你觉得他会感兴趣的，用你自己的口吻跟他说说，不要像新闻播报，也不要一次把三条都念完。）`,
    '',
    '素材：',
    ...top.map((p, i) => `${i + 1}. ${p.author}：${p.text.slice(0, 160)}${p.text.length > 160 ? '…' : ''}\n   ${p.url}\n   为什么可能有意思：${p.why}`),
    '',
    '要求：只挑一条；先用一句说清是什么，再补一两句你的看法；不要提“推荐/算法/定时任务”。',
  ]
  return lines.join('\n')
}

// ---------- 扫码登录 ----------
// 流程来自公开实现：qrcode/image 拿 qrid+图片 → qrcode/check 轮询 →
// retcode 20000000 拿 alt → login.php 换 crossDomainUrlList → 逐条取 cookie。
const LOGIN_REFERER = 'https://weibo.com/'

function createJar() {
  const map = new Map()
  return {
    addFrom(res) {
      let list = []
      try { list = res.headers.getSetCookie?.() || [] } catch { list = [] }
      if (!list.length) {
        const raw = res.headers.get('set-cookie')
        if (raw) list = [raw]
      }
      for (const line of list) {
        const parts = String(line).split(';')
        const pair = parts[0]
        const i = pair.indexOf('=')
        if (i <= 0) continue
        const k = pair.slice(0, i).trim()
        const v = pair.slice(i + 1).trim()
        let domain = ''
        for (const attr of parts.slice(1)) {
          const j = attr.indexOf('=')
          if (j > 0 && attr.slice(0, j).trim().toLowerCase() === 'domain') domain = attr.slice(j + 1).trim().toLowerCase()
        }
        const prev = map.get(k)
        // 同名 cookie：weibo.com 域优先，其余先到先得（避免登录域和微博域的 SUB 互相覆盖）
        const preferNew = !prev || (domain.includes('weibo') && !String(prev.domain || '').includes('weibo'))
        if (preferNew) map.set(k, { value: v, domain })
      }
    },
    header() {
      return [...map.entries()].map(([k, item]) => `${k}=${item.value}`).join('; ')
    },
    string() {
      return [...map.entries()].map(([k, item]) => `${k}=${item.value}`).join('; ')
    },
    get(k) { return map.get(k)?.value },
  }
}

async function jarGet(jar, url, { signal } = {}) {
  let current = url
  for (let hop = 0; hop < 6; hop++) {
    const headers = {
      'user-agent': UA,
      referer: LOGIN_REFERER,
      accept: 'application/json, text/plain, */*',
    }
    const cookie = jar.header()
    if (cookie) headers.cookie = cookie
    const res = await fetch(current, { headers, redirect: 'manual', signal })
    jar.addFrom(res)
    const loc = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString()
      continue
    }
    return res
  }
  throw new Error('重定向次数太多')
}

function parseJsonp(text) {
  const s = String(text || '').trim()
  const a = s.indexOf('(')
  const b = s.lastIndexOf(')')
  if (a >= 0 && b > a) return JSON.parse(s.slice(a + 1, b))
  return JSON.parse(s)
}

const PASSPORT = 'https://passport.weibo.com'
const LOGIN_PAGE = 'https://passport.weibo.com/sso/signin'

async function postForm(jar, path, params) {
  const query = new URLSearchParams(params).toString()
  const url = `${PASSPORT}${path}?${query}`
  const headers = {
    'content-type': 'application/x-www-form-urlencoded',
    'user-agent': UA,
    referer: LOGIN_PAGE,
    origin: 'https://passport.weibo.com',
    accept: 'application/json, text/plain, */*',
  }
  const cookie = jar.header()
  if (cookie) headers.cookie = cookie
  const res = await fetch(url, { method: 'POST', headers, body: query })
  jar.addFrom(res, url)
  return res
}

export async function startLogin() {
  const jar = createJar()
  // 新的 passport 接口：查询串和表单都要带 entry/size，否则报 size error
  const res = await postForm(jar, '/sso/v2/qrcode/image', { entry: 'weibo', size: 180 })
  const data = await res.json()
  if (Number(data?.retcode) !== 20000000) throw new Error(data?.msg || '没拿到二维码（passport 返回异常）')
  const qrid = String(data?.data?.qrid || '')
  const image = String(data?.data?.image || '')
  if (!qrid || !image) throw new Error('没拿到二维码（qrid/image 为空）')
  const imageUrl = image.startsWith('http') ? image : 'https:' + image
  const imgRes = await fetch(imageUrl, { headers: { 'user-agent': UA, referer: LOGIN_PAGE } })
  if (!imgRes.ok) throw new Error(`二维码图片下载失败（HTTP ${imgRes.status}）`)
  const buf = Buffer.from(await imgRes.arrayBuffer())
  const mime = imgRes.headers.get('content-type') || 'image/png'
  return { qrid, imageDataUrl: `data:${mime};base64,${buf.toString('base64')}`, jar }
}

export async function whoami(cookies) {
  const cookie = String(cookies || '')
  if (!cookie) return null
  try {
    const res = await fetch('https://m.weibo.cn/api/config', { headers: { cookie, 'user-agent': UA, referer: 'https://m.weibo.cn/' } })
    const json = await res.json()
    if (json?.data?.login !== true) return null
    const uid = String(json.data.uid || '')
    let screenName = ''
    try {
      const p = await fetch(`https://weibo.com/ajax/profile/info?uid=${uid}`, { headers: { ...headers(cookie), referer: `https://weibo.com/u/${uid}` } })
      const pj = await p.json()
      screenName = String(pj?.data?.user?.screen_name || '')
    } catch {}
    return { uid, screenName }
  } catch {
    return null
  }
}

async function verifyLogin(jar) {
  return whoami(jar.header())
}

export async function checkLogin({ qrid, jar }) {
  const res = await postForm(jar, '/sso/v2/qrcode/check', { entry: 'weibo', qrid })
  const data = await res.json()
  const retcode = Number(data?.retcode)
  if (retcode === 20000000) {
    const url = String(data?.data?.url || '')
    if (!url) throw new Error('扫码成功但没有跳转地址')
    await jarGet(jar, url)
    // 跟到微博首页，让 weibo.com 域的 cookie 落地
    try { await jarGet(jar, 'https://weibo.com/') } catch {}
    const me = await verifyLogin(jar)
    const cookies = jar.string()
    if (!cookies) throw new Error('登录成功但没收集到 cookies')
    return { status: 'confirmed', cookies, uid: me?.uid || '', screenName: me?.screenName || '' }
  }
  if (retcode === 50114003 || retcode === 50114004 || retcode === 50114015) return { status: 'expired', retcode }
  if (retcode === 50114002) return { status: 'scanned' }
  return { status: 'wait', retcode }
}

