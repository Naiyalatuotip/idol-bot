// 每日语言复盘的管理页。

export function renderPage({ prefix = '/dsh-aoi-daily' } = {}) {
  const safePrefix = JSON.stringify(prefix)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>每日语言复盘</title>
<style>
:root{--paper:#F7F2EB;--ink:#081F5C;--mid:#334EAC;--light:#7096D1;--wash:#D0E3FF;--line:#BAD6EB;--accent:#A33A2C}
*{box-sizing:border-box}
body{margin:0;padding:40px 22px 64px;background:var(--paper);color:var(--ink);font:15px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
main{max-width:860px;margin:0 auto}
h1{font-size:28px;margin:0 0 6px}
.sub{color:var(--mid);margin:0 0 22px}
.badge{display:inline-block;font-size:11px;letter-spacing:.14em;padding:3px 8px;border:1px solid var(--line);color:var(--light);margin-left:8px;vertical-align:middle}
section{border-top:1px solid var(--line);padding:18px 0}
h2{font-size:13px;letter-spacing:.16em;color:var(--light);font-weight:400;margin:0 0 12px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.row label{color:var(--mid);font-size:13px}
input[type=number]{width:80px}
input[type=text]{width:100%}
input,select{font:inherit;padding:6px 8px;border:1px solid var(--line);background:#fff;color:var(--ink)}
button{font:inherit;padding:7px 14px;border:1px solid var(--mid);background:var(--mid);color:#fff;cursor:pointer;border-radius:2px}
button.ghost{background:transparent;color:var(--mid)}
button.danger{background:transparent;border-color:var(--accent);color:var(--accent)}
button:disabled{opacity:.5;cursor:default}
.hint{color:var(--light);font-size:12px;line-height:1.8}
.list{border-top:1px solid var(--wash)}
.item{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--wash);font-size:13.5px}
.item .grow{flex:1}
.mono{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--mid)}
.muted{color:var(--light);font-size:12px}
.datebtn{font-size:12px;padding:4px 10px;margin:0 6px 6px 0;border:1px solid var(--line);background:#fff;color:var(--mid);cursor:pointer}
pre.digest{white-space:pre-wrap;background:#fffdf9;border:1px solid var(--line);padding:16px;font:13px/1.75 ui-monospace,Consolas,monospace;color:var(--ink);max-height:520px;overflow:auto}
.err{color:var(--accent);font-size:13px;white-space:pre-wrap}
footer{margin-top:24px;color:var(--light);font-size:12px}
</style>
</head>
<body>
<main>
<h1>每日语言复盘</h1>
<p class="sub">每天到点读一遍目标会话，找出语法 / 语义 / 口头的毛病，也总结对方怎么说话；产出的短规则会作为语言校准注入目标会话。</p>

<section>
<h2>设置</h2>
<div class="row">
<label><input type="checkbox" id="enabled"> 启用每日复盘</label>
<label>时间 <input type="number" id="hour" min="0" max="23"> : <input type="number" id="minute" min="0" max="59"></label>
<label>每次读 <input type="number" id="maxMessages" min="20" max="400"> 条</label>
<label><input type="checkbox" id="injectContext"> 把学到的规则注入目标会话</label>
</div>
<div class="row"><button id="save">保存设置</button><span class="muted" id="saved"></span></div>
</section>

<section>
<h2>复盘哪些会话</h2>
<p class="hint">不勾 = 自动选择「当前活着、preset=aoi」的会话。勾了就只复盘勾中的（可多选）。</p>
<div class="row"><label><input type="checkbox" id="allAuto"> 自动（preset=aoi）</label></div>
<div id="sessions" class="list"></div>
<div class="row" style="margin-top:10px"><button class="ghost" id="saveSessions">保存会话选择</button></div>
</section>

<section>
<h2>立即复盘</h2>
<div class="row"><button id="run">现在跑一次</button><span class="muted" id="runState"></span></div>
<p class="hint" id="lastRun"></p>
</section>

<section>
<h2>人格生长（话题偏向）</h2>
<div id="growth" class="list"></div>
<div class="row" style="margin-top:10px"><button class="danger" id="resetGrowth">清空成长档案</button></div>
</section>

<section>
<h2>生效中的规则</h2>
<div id="rules" class="list"></div>
<div class="row" style="margin-top:10px"><button class="danger" id="clearRules">清空全部规则</button></div>
</section>

<section>
<h2>往期复盘</h2>
<div id="digests"></div>
<pre class="digest" id="digestView">点上面的日期看内容。</pre>
</section>

<footer id="storage">配置：…</footer>
</main>
<script>
(function(){
  "use strict";
  var PREFIX = ${safePrefix};
  var state = null;
  function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function api(path, body){
    return fetch(PREFIX+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
      .then(function(r){return r.json().then(function(j){if(r.ok&&j&&j.ok!==false)return j; throw new Error((j&&(j.error||j.message))||('HTTP '+r.status));});});
  }
  function render(s){
    document.getElementById('enabled').checked = s.enabled;
    document.getElementById('hour').value = s.hour;
    document.getElementById('minute').value = s.minute;
    document.getElementById('maxMessages').value = s.maxMessages;
    document.getElementById('injectContext').checked = s.injectContext;
    document.getElementById('storage').textContent = '配置：' + s.storage;
    document.getElementById('lastRun').textContent = s.lastRunAt ? ('上次运行：' + s.lastRunAt + '（' + (s.lastResult && s.lastResult.ok ? '成功' : '失败') + '）' + (s.lastResult && s.lastResult.error ? ' · ' + s.lastResult.error : '')) : '还没跑过';

    var manual = (s.sessionIds||[]);
    document.getElementById('allAuto').checked = manual.length === 0;
    document.getElementById('sessions').innerHTML = (s.sessions||[]).map(function(x){
      var checked = manual.indexOf(x.id) >= 0 ? ' checked' : '';
      var mark = x.preset === 'aoi' ? ' · aoi' : (x.alive ? '' : ' · 未启动');
      return '<div class="item"><input type="checkbox" data-session="'+esc(x.id)+'"'+checked+'>'
        + '<div class="grow"><b>'+esc(x.title||'（未命名）')+'</b><div class="muted mono">'+esc(x.id)+mark+'</div></div></div>';
    }).join('') || '<p class="muted">没有会话。</p>';

    var g = s.growth || {};
    var gtopics = (g.topics||[]).map(function(x){
      return '<div class="item"><div class="grow">'+esc(x.topic)+' <span class="muted">权重 '+x.weight+'</span><div class="muted">'+esc(x.reason||'')+'</div></div></div>';
    }).join('');
    var gextra = (g.style||[]).length ? '<div class="muted" style="padding:8px 0">他吃哪一套：'+esc(g.style.join('；'))+'</div>' : '';
    var gavoid = (g.avoid||[]).length ? '<div class="muted" style="padding:8px 0">少碰：'+esc(g.avoid.join('；'))+'</div>' : '';
    document.getElementById('growth').innerHTML = (gtopics || gextra || gavoid)
      ? (gtopics + gextra + gavoid)
      : '<p class="muted">还没有成长档案。跑一次复盘就会开始积累。</p>';

    document.getElementById('rules').innerHTML = (s.rules||[]).length
      ? s.rules.map(function(r){return '<div class="item"><div class="grow">'+esc(r.text)+'<div class="muted">命中 '+r.hits+' 次 · 最近 '+esc(r.lastSeen.slice(0,10))+'</div></div><button class="danger" data-del="'+esc(r.text)+'">删</button></div>';}).join('')
      : '<p class="muted">还没有规则。跑一次复盘就会有。</p>';

    document.getElementById('digests').innerHTML = (s.digests||[]).map(function(d){
      return '<button class="datebtn" data-digest="'+esc(d)+'">'+esc(d)+'</button>';
    }).join('') || '<p class="muted">还没有复盘记录。</p>';
  }
  function refresh(){ return api('/api/state').then(function(s){state=s; render(s);}).catch(function(e){document.getElementById('runState').textContent='读取失败：'+e.message;}); }

  document.getElementById('save').addEventListener('click', function(){
    api('/api/config', {
      enabled: document.getElementById('enabled').checked,
      hour: Number(document.getElementById('hour').value),
      minute: Number(document.getElementById('minute').value),
      maxMessages: Number(document.getElementById('maxMessages').value),
      injectContext: document.getElementById('injectContext').checked
    }).then(function(){ document.getElementById('saved').textContent='已保存'; return refresh(); })
      .catch(function(e){ document.getElementById('saved').textContent='保存失败：'+e.message; });
  });

  document.getElementById('saveSessions').addEventListener('click', function(){
    var ids = [];
    document.querySelectorAll('[data-session]').forEach(function(el){ if(el.checked) ids.push(el.getAttribute('data-session')); });
    api('/api/config', { sessionIds: ids }).then(function(){ return refresh(); }).catch(function(e){ alert('保存失败：'+e.message); });
  });

  document.getElementById('allAuto').addEventListener('change', function(){
    if(this.checked) api('/api/config', { sessionIds: [] }).then(function(){ return refresh(); }).catch(function(){});
  });

  document.getElementById('run').addEventListener('click', function(){
    var btn = this; btn.disabled = true;
    document.getElementById('runState').textContent = '复盘进行中（要调一次模型，等十几秒）…';
    api('/api/run', {}).then(function(r){
      document.getElementById('runState').textContent = r.ok ? ('完成：新增 '+r.added.length+' 条规则' + (r.summary ? ' · ' + r.summary : '')) : ('失败：'+r.error);
      return refresh();
    }).catch(function(e){ document.getElementById('runState').textContent='失败：'+e.message; })
      .then(function(){ btn.disabled = false; });
  });

  document.getElementById('resetGrowth').addEventListener('click', function(){
    if(!confirm('清空成长档案？（话题权重和偏好都会清掉）')) return;
    api('/api/growth/reset', {}).then(function(){ return refresh(); }).catch(function(e){ alert(e.message); });
  });

  document.getElementById('clearRules').addEventListener('click', function(){
    if(!confirm('清空全部规则？')) return;
    api('/api/rules/clear', {}).then(function(){ return refresh(); }).catch(function(e){ alert(e.message); });
  });

  document.addEventListener('click', function(e){
    var t = e.target;
    if(!(t instanceof HTMLElement)) return;
    var del = t.getAttribute('data-del');
    if(del){ api('/api/rules/delete', { text: del }).then(function(){ return refresh(); }).catch(function(e){ alert(e.message); }); }
    var date = t.getAttribute('data-digest');
    if(date){
      api('/api/digest?date='+encodeURIComponent(date)).then(function(r){
        document.getElementById('digestView').textContent = r.markdown;
      }).catch(function(e){ document.getElementById('digestView').textContent = e.message; });
    }
  });

  refresh();
  setInterval(function(){ if(!state || !state.running) refresh(); }, 15000);
})();
</script>
</body>
</html>`
}
