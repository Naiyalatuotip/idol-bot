// DSH「冲浪」设置页：QQ 接入 + 微博阅读。
// 槽位 settings.section，id surf。

window.__ModuleLoader__.load({
  id: 'dsh-surf',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const inject = ['slots']
    const B = '/dsh-surf'
    const get = (p) => fetch(B + p, { cache: 'no-store' }).then((r) => r.json()).catch(() => null)
    const post = (p, body) =>
      fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
        .then((r) => r.json())
        .catch(() => null)
    const h = React.createElement
    const S = {
      wrap: { padding: '12px 14px 24px', fontSize: 13, lineHeight: 1.7, background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,.92))', border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))', borderRadius: 12 },
      h: { fontSize: 14, fontWeight: 600, margin: '16px 0 8px' },
      dim: { opacity: 0.62, fontSize: 12 },
      card: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: '10px 12px', marginBottom: 10, background: 'var(--dsw-alias-bg-layer-1)' },
      row: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' },
      lab: { minWidth: 110, fontSize: 12.5 },
      input: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '4px 8px', background: 'transparent', color: 'inherit' },
      btn: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '4px 10px', background: 'transparent', color: 'inherit', cursor: 'pointer' },
      pre: { whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11.5, maxHeight: 260, overflow: 'auto', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: 8 },
    }
    const 行 = (label, ctl) => h('div', { style: S.row }, h('div', { style: S.lab }, label), ctl)
    const 按钮 = (t, fn, off) => h('button', { type: 'button', style: S.btn, onClick: fn, disabled: !!off }, t)

    function Section() {
      const [s, setS] = React.useState(null)
      const [url, setUrl] = React.useState('')
      const [token, setToken] = React.useState('')
      const [cookies, setCookies] = React.useState('')
      const [login, setLogin] = React.useState({ attemptId: '', image: '', status: '' })
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const [result, setResult] = React.useState('')
      const load = React.useCallback(() => {
        get('/api/state').then((r) => {
          if (!r || !r.ok) return
          setS(r)
          setUrl(r.qq?.url || '')
        })
      }, [])
      React.useEffect(() => { load() }, [load])
      React.useEffect(() => {
        if (!login.attemptId) return
        let stop = false
        const tick = () => {
          get('/api/weibo/login/status?attemptId=' + encodeURIComponent(login.attemptId)).then((r) => {
            if (stop || !r) return
            if (!r.ok) { setLogin({ attemptId: '', image: '', status: r.error || '扫码失败' }); return }
            if (r.status === 'confirmed') {
              setLogin({ attemptId: '', image: '', status: '登录成功' + (r.screenName ? '：' + r.screenName : '') })
              load()
            } else if (r.status === 'expired') {
              setLogin({ attemptId: '', image: '', status: '二维码过期，重新扫码' })
            } else if (r.status === 'scanned') {
              setLogin((v) => ({ ...v, status: '已扫描，请在手机上确认' }))
            } else {
              setLogin((v) => ({ ...v, status: '等待扫码…' }))
            }
          }).catch(() => {})
        }
        const t = setInterval(tick, 2000)
        tick()
        return () => { stop = true; clearInterval(t) }
      }, [login.attemptId, load])
      if (!s) return h('div', { style: S.wrap }, '读取中…')

      const q = s.qq || {}
      const w = s.weibo || {}
      const saveQq = () => {
        setBusy(true)
        post('/api/qq/config', { url, token: token || undefined })
          .then((r) => { setNote(r?.ok ? '已保存并重连' : '保存失败'); setToken(''); load() })
          .catch(() => setNote('保存失败'))
          .then(() => setBusy(false))
      }
      const startLogin = () => {
        setBusy(true)
        post('/api/weibo/login/start', {})
          .then((r) => {
            if (r?.ok) setLogin({ attemptId: r.attemptId, image: r.imageDataUrl, status: '等待扫码…' })
            else setLogin({ attemptId: '', image: '', status: '生成失败：' + (r?.error || '') })
          })
          .catch((e) => setLogin({ attemptId: '', image: '', status: '生成失败：' + e.message }))
          .then(() => setBusy(false))
      }
      const importWch = () => {
        setBusy(true)
        post('/api/weibo/import', {})
          .then((r) => { setNote(r?.ok ? ('导入成功：' + (r.screenName || r.uid)) : ('导入失败：' + (r.error || ''))); load() })
          .catch((e) => setNote('导入失败：' + e.message))
          .then(() => setBusy(false))
      }
      const saveWb = () => {
        const body = { uid: w.uid, count: w.count, followingShare: w.followingShare, intervalMin: w.intervalMin, enableShare: w.enableShare, interests: w.interests }
        if (cookies.trim()) body.cookies = cookies.trim()
        setBusy(true)
        post('/api/weibo/config', body)
          .then((r) => { setNote(r?.ok ? '微博设置已保存' : '保存失败'); setCookies(''); load() })
          .catch(() => setNote('保存失败'))
          .then(() => setBusy(false))
      }
      const test = () => {
        setBusy(true)
        setResult('读取中…')
        post('/api/weibo/test', {})
          .then((r) => {
            setResult(r?.ok ? r.text : '失败：' + (r?.error || '未知'))
            load()
          })
          .catch((e) => setResult('失败：' + e.message))
          .then(() => setBusy(false))
      }
      const share = () => {
        setBusy(true)
        post('/api/weibo/share', {})
          .then((r) => { setNote(r?.ok ? '已塞给目标会话，让她分享' : '失败：' + (r?.error || '')); load() })
          .catch((e) => setNote('失败：' + e.message))
          .then(() => setBusy(false))
      }

      return h('div', { style: S.wrap },
        h('div', { style: S.h }, '冲浪（QQ / 微博）'),
        h('div', { style: S.dim }, 'QQ 走 OneBot v11 正向 WebSocket；微博只读关注/推荐时间线。详细绑定在独立页 /dsh-surf/。'),
        h('div', { style: S.h }, 'QQ 接入'),
        h('div', { style: S.card },
          h('div', { style: S.dim }, (q.connected ? '● 已连接' : '○ 未连接') + (q.selfId ? ' · 账号 ' + q.selfId : '') + (q.lastError ? ' · ' + q.lastError : '')),
          行('WS 地址', h('input', { style: { ...S.input, flex: 1, minWidth: 220 }, value: url, onChange: (e) => setUrl(e.target.value) })),
          行('Access Token', h('input', { style: { ...S.input, flex: 1, minWidth: 180 }, value: token, placeholder: q.tokenMasked || '没有就留空', onChange: (e) => setToken(e.target.value) })),
          h('div', { style: { display: 'flex', gap: 8 } }, 按钮('保存并重连', saveQq, busy), 按钮('重连', () => post('/api/qq/reconnect', {}).then(load), busy)),
          h('div', { style: S.dim }, '已绑定 ' + ((q.bindings || []).length) + ' 个 QQ 对话；绑定请打开独立页。'),
        ),
        h('div', { style: S.h }, '微博阅读'),
        h('div', { style: S.card },
          h('div', { style: S.dim }, w.configured ? ('已登录' + (w.screenName ? '：' + w.screenName : (w.uid ? ' · UID ' + w.uid : '')) + (w.lastLoginAt ? ' · ' + String(w.lastLoginAt).slice(0, 10) : '')) : '还没登录，点下面扫码'),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 } },
            按钮('扫码登录', startLogin, busy),
            按钮('从爬虫项目导入', importWch, busy),
            login.status ? h('span', { style: S.dim }, login.status) : null,
          ),
          login.image ? h('img', { src: login.image, alt: '微博登录二维码', style: { width: 160, height: 160, marginTop: 8, border: '1px solid var(--dsw-alias-border-l2)', background: '#fff' } }) : null,
          h('details', { style: { marginTop: 8 } },
            h('summary', { style: S.dim }, '手动填 cookies（备用）'),
            h('textarea', { style: { ...S.input, width: '100%', minHeight: 60, fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }, placeholder: '粘贴 weibo.com 的 Cookie（至少 SUB/SUBP）', value: cookies, onChange: (e) => setCookies(e.target.value) }),
          ),
          h('div', { style: S.row },
            行('UID', h('input', { style: { ...S.input, width: 130 }, value: w.uid || '', onChange: (e) => setS({ ...s, weibo: { ...w, uid: e.target.value } }) })),
            行('每次读', h('input', { style: { ...S.input, width: 70 }, type: 'number', value: w.count || 20, onChange: (e) => setS({ ...s, weibo: { ...w, count: Number(e.target.value) } }) })),
            行('关注比例', h('input', { style: { ...S.input, width: 70 }, type: 'number', min: 0.5, max: 1, step: 0.05, value: w.followingShare == null ? 0.75 : w.followingShare, onChange: (e) => setS({ ...s, weibo: { ...w, followingShare: Number(e.target.value) } }) })),
            行('定时间隔(分)', h('input', { style: { ...S.input, width: 70 }, type: 'number', value: w.intervalMin || 0, onChange: (e) => setS({ ...s, weibo: { ...w, intervalMin: Number(e.target.value) } }) })),
          ),
          h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 } },
            h('input', { type: 'checkbox', checked: !!w.enableShare, onChange: (e) => setS({ ...s, weibo: { ...w, enableShare: e.target.checked } }) }),
            '定时把候选素材塞给目标会话，让她主动分享',
          ),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            按钮('保存', saveWb, busy),
            按钮('试读一次', test, busy),
            按钮('现在分享一条', share, busy),
          ),
          h('div', { style: S.dim }, (w.lastFetchAt ? '上次读：' + w.lastFetchAt : '还没读过') + (w.lastError ? ' · ' + w.lastError : '')),
          h('div', { style: S.dim }, note),
        ),
        h('div', { style: S.h }, '读到的'),
        h('pre', { style: S.pre }, result || '点「试读一次」。'),
      )
    }

    const apply = (ctx) => {
      const slots = ctx.get('slots')
      if (!slots) return
      slots.inject('settings.section', () =>
        slots.register({ name: 'settings.section', id: 'surf', order: 55, label: () => '冲浪（QQ/微博）' }, Section),
      )
    }
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
