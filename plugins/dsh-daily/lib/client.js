// DSH「每日复盘」· 网页半边
//
// 在 DSH 设置左侧栏加一项「每日复盘」，读写宿主半边的 /dsh-daily/* 路由。
// 槽位名 'settings.section' 与 dsh-speak-up / dsh-fish-memory 一致。

window.__ModuleLoader__.load({
  id: 'dsh-daily',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const inject = ['slots']
    const B = '/dsh-daily'

    const get = (p) => fetch(B + p, { cache: 'no-store' }).then((r) => r.json()).catch(() => null)
    const post = (p, body) =>
      fetch(B + p, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
        .then((r) => r.json())
        .catch(() => null)

    const h = React.createElement

    const S = {
      wrap: {
        padding: '12px 14px 24px',
        fontSize: 13,
        lineHeight: 1.7,
        background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,.92))',
        border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))',
        borderRadius: 12,
      },
      h: { fontSize: 14, fontWeight: 600, margin: '16px 0 8px' },
      dim: { opacity: 0.62, fontSize: 12 },
      card: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 8,
        padding: '10px 12px',
        marginBottom: 10,
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      row: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' },
      lab: { minWidth: 150, fontSize: 12.5 },
      input: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '4px 8px',
        background: 'transparent',
        color: 'inherit',
        width: 90,
      },
      btn: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '4px 10px',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
      },
      btnOn: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '4px 10px',
        background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,.06))',
        color: 'inherit',
        cursor: 'pointer',
      },
      bar: { height: 6, borderRadius: 3, background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,.08))', overflow: 'hidden' },
      fill: { height: '100%', background: 'var(--dsw-alias-brand, #4f7cff)' },
      pre: {
        whiteSpace: 'pre-wrap',
        fontFamily: 'ui-monospace, Consolas, monospace',
        fontSize: 11.5,
        maxHeight: 320,
        overflow: 'auto',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: 8,
      },
      topic: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 },
      topicName: { minWidth: 80, fontSize: 12.5 },
      topicBar: { flex: 1, minWidth: 120 },
    }

    const 行 = (标签, 控件) => h('div', { style: S.row }, h('div', { style: S.lab }, 标签), 控件)
    const 按钮 = (文字, onClick, 关) =>
      h('button', { type: 'button', style: S.btn, onClick, disabled: !!关 }, 文字)

    function Section() {
      const [态, 设态] = React.useState(null)
      const [说, 设说] = React.useState('')
      const [忙, 设忙] = React.useState(false)
      const [文, 设文] = React.useState('')

      const 拉 = React.useCallback(() => {
        get('/api/state').then((r) => {
          if (r && r.ok) 设态(r)
        })
      }, [])
      React.useEffect(() => { 拉() }, [拉])

      if (!态) return h('div', { style: S.wrap }, '读取中…')

      const 改 = (补丁) => 设态((旧) => ({ ...旧, ...补丁 }))

      const 保存 = () => {
        设忙(true)
        post('/api/config', {
          enabled: 态.enabled,
          hour: Number(态.hour),
          minute: Number(态.minute),
          maxMessages: Number(态.maxMessages),
          injectContext: 态.injectContext,
        })
          .then((r) => { 设说(r && r.ok ? '已保存' : '保存失败'); 拉() })
          .catch(() => 设说('保存失败'))
          .then(() => 设忙(false))
      }

      const 跑 = () => {
        设忙(true)
        设说('复盘进行中（要调一次模型，等十几秒）…')
        post('/api/run', {})
          .then((r) => {
            if (r && r.ok) {
              设说('完成：新增 ' + (r.added ? r.added.length : 0) + ' 条规则' + (r.summary ? ' · ' + r.summary : ''))
            } else {
              设说('失败：' + ((r && r.error) || '未知错误'))
            }
            拉()
          })
          .catch(() => 设说('失败'))
          .then(() => 设忙(false))
      }

      const 看复盘 = (d) => {
        get('/api/digest?date=' + encodeURIComponent(d)).then((r) => {
          设文(r && r.ok ? r.markdown : '读取失败：' + ((r && r.error) || ''))
        })
      }

      const g = 态.growth || {}
      const topics = (g.topics || []).slice(0, 6)
      const 规则们 = (态.rules || []).slice(0, 6)
      const 日期们 = (态.digests || []).slice(0, 8)

      return h('div', { style: S.wrap },
        h('div', { style: S.h }, '每日复盘'),
        h('div', { style: S.dim }, '每天读一遍目标会话，找语法/语义/用词问题，并总结对方的语言习惯与话题偏好；产出的规则和成长档案会注入目标会话。'),
        h('div', { style: { ...S.dim, marginTop: 4 } },
          '上次运行：' + (态.lastRunAt || '还没跑过') + '（' + (态.lastResult && 态.lastResult.ok ? '成功' : '失败') + '）' +
            (态.lastResult && 态.lastResult.error ? ' · ' + 态.lastResult.error : '')),

        h('div', { style: S.h }, '设置'),
        h('div', { style: S.card },
          行('启用', h('input', {
            type: 'checkbox',
            checked: !!态.enabled,
            onChange: (e) => 改({ enabled: e.target.checked }),
          })),
          行('每天几点', h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            h('input', { type: 'number', min: 0, max: 23, value: 态.hour, style: S.input, onChange: (e) => 改({ hour: e.target.value }) }),
            '：',
            h('input', { type: 'number', min: 0, max: 59, value: 态.minute, style: S.input, onChange: (e) => 改({ minute: e.target.value }) }),
          )),
          行('每次读多少条', h('input', { type: 'number', min: 20, max: 400, value: 态.maxMessages, style: S.input, onChange: (e) => 改({ maxMessages: e.target.value }) })),
          行('注入到会话', h('input', {
            type: 'checkbox',
            checked: !!态.injectContext,
            onChange: (e) => 改({ injectContext: e.target.checked }),
          })),
          h('div', { style: { display: 'flex', gap: 8, marginTop: 6 } },
            按钮('保存设置', 保存, 忙),
            按钮('现在跑一次', 跑, 忙),
            h('span', { style: S.dim }, 说),
          ),
        ),

        h('div', { style: S.h }, '人格生长（话题偏向）'),
        h('div', { style: S.card },
          topics.length
            ? topics.map((t) =>
                h('div', { key: t.topic, style: S.topic },
                  h('div', { style: S.topicName }, t.topic),
                  h('div', { style: { ...S.topicBar, ...S.bar } },
                    h('div', { style: { ...S.fill, width: Math.max(0, Math.min(100, Number(t.weight) || 0)) + '%' } }),
                  ),
                  h('div', { style: { ...S.dim, minWidth: 30, textAlign: 'right' } }, String(t.weight)),
                ),
              )
            : h('div', { style: S.dim }, '还没有成长档案。跑一次复盘就会开始积累。'),
          g.style && g.style.length ? h('div', { style: { ...S.dim, marginTop: 6 } }, '他吃哪一套：' + g.style.join('；')) : null,
          g.avoid && g.avoid.length ? h('div', { style: { ...S.dim, marginTop: 4 } }, '少碰：' + g.avoid.join('；')) : null,
          h('div', { style: { marginTop: 8 } },
            按钮('清空成长档案', () => {
              if (!window.confirm('清空成长档案？')) return
              post('/api/growth/reset', {}).then(() => 拉())
            }),
          ),
        ),

        h('div', { style: S.h }, '生效中的规则'),
        h('div', { style: S.card },
          规则们.length
            ? 规则们.map((r, i) => h('div', { key: i, style: { marginBottom: 4 } }, '· ' + r.text + (r.hits ? '（命中 ' + r.hits + ' 次）' : '')))
            : h('div', { style: S.dim }, '还没有规则。'),
          h('div', { style: { marginTop: 8 } },
            按钮('清空全部规则', () => {
              if (!window.confirm('清空全部规则？')) return
              post('/api/rules/clear', {}).then(() => 拉())
            }),
          ),
        ),

        h('div', { style: S.h }, '往期复盘'),
        h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 } },
          日期们.length
            ? 日期们.map((d) => 按钮(d, () => 看复盘(d)))
            : h('div', { style: S.dim }, '还没有复盘记录。'),
        ),
        h('pre', { style: S.pre }, 文 || '点上面的日期看内容。'),
      )
    }

    const apply = (ctx) => {
      const slots = ctx.get('slots')
      slots.inject('settings.section', () =>
        slots.register(
          { name: 'settings.section', id: 'daily', order: 54, label: () => '每日复盘' },
          Section,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
