// 管理页：扫码接入微信、选 DSH 会话、绑定/解绑。
// 纯静态 HTML + fetch，不引外部资源；只做本机管理用。

export function renderPage({ prefix = '/dsh-wechat-bridge' } = {}) {
  const safePrefix = JSON.stringify(prefix)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>微信 ↔ DSH 对话桥</title>
<style>
:root{--paper:#F7F2EB;--ink:#081F5C;--mid:#334EAC;--light:#7096D1;--wash:#D0E3FF;--line:#BAD6EB;--accent:#A33A2C}
*{box-sizing:border-box}
body{margin:0;padding:40px 22px 64px;background:var(--paper);color:var(--ink);font:15px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
main{max-width:860px;margin:0 auto}
h1{font-size:30px;line-height:1.25;margin:0 0 6px;letter-spacing:.02em}
.sub{color:var(--mid);margin:0 0 22px}
.badge{display:inline-block;font-size:11px;letter-spacing:.14em;padding:3px 8px;border:1px solid var(--line);color:var(--light);margin-left:8px;vertical-align:middle}
section{border-top:1px solid var(--line);padding:20px 0}
h2{font-size:13px;letter-spacing:.16em;color:var(--light);font-weight:400;margin:0 0 14px}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--line);margin-bottom:8px;background:#fffdf9}
.row .grow{flex:1 1 240px;min-width:200px}
.mono{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--mid)}
.muted{color:var(--light);font-size:12px}
button{font:inherit;padding:7px 14px;border:1px solid var(--mid);background:var(--mid);color:#fff;cursor:pointer;border-radius:2px}
button.ghost{background:transparent;color:var(--mid)}
button.danger{background:transparent;border-color:var(--accent);color:var(--accent)}
button:disabled{opacity:.5;cursor:default}
select{font:inherit;padding:6px 8px;border:1px solid var(--line);background:#fff;color:var(--ink);max-width:min(360px,100%)}
input[type=checkbox]{width:16px;height:16px;accent-color:var(--mid)}
.hint{color:var(--mid);font-size:13px;margin:0 0 12px}
.empty{color:var(--light);font-size:13px;padding:8px 0}
#qrPanel{border:1px solid var(--line);background:#fffdf9;padding:18px;margin-top:12px;display:none}
#qrPanel.on{display:block}
#qrImg{width:220px;height:220px;image-rendering:pixelated;border:1px solid var(--line);background:#fff}
#qrStatus{color:var(--mid);margin:10px 0}
.err{color:var(--accent);font-size:13px;white-space:pre-wrap}
details{margin-top:16px;color:var(--mid);font-size:13px}
summary{cursor:pointer}
code{font-family:ui-monospace,Consolas,monospace;font-size:12px;background:var(--wash);padding:1px 5px}
table{width:100%;border-collapse:collapse;font-size:13px}
td,th{text-align:left;padding:8px 6px;border-bottom:1px solid var(--wash);vertical-align:top}
th{color:var(--light);font-weight:400;font-size:11px;letter-spacing:.12em}
footer{margin-top:26px;color:var(--light);font-size:12px}
</style>
</head>
<body>
<main>
<h1>微信 ↔ DSH 对话桥<span class="badge">iLink</span></h1>
<p class="sub">扫码接入一个微信机器人 → 用你的微信给它发一句话 → 在下面把这个微信对话和 DSH 会话绑定。之后两个方向都走文字转发；只有绑定过的对话会被注入 DSH。</p>

<section>
<h2>微信账号</h2>
<div id="accountList"></div>
<div style="margin-top:12px">
<button id="loginBtn">扫码接入微信</button>
<span class="muted" id="loginHint" style="margin-left:10px"></span>
</div>
<div id="qrPanel">
<img id="qrImg" alt="微信登录二维码">
<div id="qrStatus">正在向微信申请二维码…</div>
<div style="margin:10px 0"><a id="qrLink" href="#" target="_blank" rel="noopener noreferrer" style="display:none;color:var(--mid)">在浏览器打开扫码页</a></div>
<button class="ghost" id="cancelBtn">取消这次扫码</button>
</div>
</section>

<section>
<h2>微信对话</h2>
<p class="hint">对话是收到微信消息后自动出现在这里的。绑定后，这个微信对话的消息会作为用户消息进入所选的 DSH 会话。</p>
<div id="chatList"></div>
</section>

<section>
<h2>已绑定</h2>
<div id="bindList"></div>
</section>

<section>
<h2>设置</h2>
<div class="row">
<label class="grow"><input type="checkbox" id="mirror"> 把 DSH 网页里发出的回答也同步回微信（关闭后只回微信自己问的）</label>
</div>
<div class="row">
<label class="grow"><input type="checkbox" id="readDelay"> 阅读延迟（收到消息先停 1–4 秒再回，像刚看到）</label>
</div>
<div class="row">
<label class="grow"><input type="checkbox" id="typingBurst"> 断续输入状态（她打字时亮几秒、灭一下、再亮）</label>
</div>
</section>

<details>
<summary>扫码登录接口（给别的程序调用）</summary>
<p>
<code>POST ${prefix}/api/login/start</code> → <code>{ ok, attemptId, imageUrl, expiresAt }</code><br>
<code>GET ${prefix}/api/login/status?attemptId=…</code> → <code>{ status: wait | scaned | confirmed | expired | failed }</code><br>
<code>GET ${prefix}/api/state</code> → 账号 / 微信对话 / DSH 会话 / 绑定<br>
<code>POST ${prefix}/api/bind</code> body <code>{ accountId, chatId, sessionId }</code><br>
<code>POST ${prefix}/api/unbind</code> body <code>{ chatId }</code>
</p>
<p class="muted">接口只在本机 web 服务上注册；调试注入接口只在回环地址可用。</p>
</details>

<footer id="meta">配置目录：<span class="mono" id="storage">…</span>　·　v0.1.5</footer>
</main>
<script>
(function(){
  "use strict";
  var PREFIX = ${safePrefix};
  var state = { accounts: [], chats: [], bindings: [], sessions: [], settings: {} };
  var attemptId = null;
  var pollTimer = null;
  var qrPanel = document.getElementById('qrPanel');
  var qrImg = document.getElementById('qrImg');
  var qrStatus = document.getElementById('qrStatus');

  function esc(value){
    return String(value == null ? '' : value)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function shortId(id){ return String(id || '').slice(-10); }
  function api(path, body){
    return fetch(PREFIX + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function(r){ return r.json().then(function(j){ if (r.ok && j && j.ok !== false) return j; throw new Error((j && (j.error || j.message)) || ('HTTP ' + r.status)); }); });
  }

  function sessionOptions(selected){
    if (!state.sessions.length) return '<option value="">（还没有 DSH 会话）</option>';
    return state.sessions.map(function(s){
      var label = (s.title || '（未命名）') + ' · ' + shortId(s.id);
      return '<option value="' + esc(s.id) + '"' + (s.id === selected ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
  }

  function render(){
    var accounts = state.accounts || [];
    document.getElementById('accountList').innerHTML = accounts.length
      ? accounts.map(function(a){
          return '<div class="row"><div class="grow"><b>' + esc(a.ownerUserId || a.botId) + '</b> '
            + '<span class="mono">' + esc(a.accountId) + '</span>'
            + '<div class="muted">接入于 ' + esc(a.connectedAt || '') + (a.lastError ? ' · <span class="err">' + esc(a.lastError) + '</span>' : '') + '</div></div>'
            + '<button class="danger" data-remove="' + esc(a.accountId) + '">移除</button></div>';
        }).join('')
      : '<p class="empty">还没有接入微信账号。</p>';

    var chats = state.chats || [];
    document.getElementById('chatList').innerHTML = chats.length
      ? chats.map(function(c){
          var binding = (state.bindings || []).filter(function(b){ return b.chatId === c.chatId; })[0];
          var right = binding
            ? '<div class="muted">已绑定：' + esc(binding.sessionTitle || shortId(binding.sessionId)) + '</div><button class="danger" data-unbind="' + esc(c.chatId) + '">解绑</button>'
            : '<select data-session-for="' + esc(c.chatId) + '">' + sessionOptions('') + '</select><button data-bind="' + esc(c.chatId) + '" data-account="' + esc(c.accountId) + '">绑定</button>';
          return '<div class="row"><div class="grow"><b class="mono">' + esc(shortId(c.chatId)) + '</b> '
            + '<span class="muted">' + esc(c.accountId) + '</span>'
            + '<div class="muted">' + esc((c.lastText || '').slice(0, 80) || '（非文字消息）') + ' · ' + esc(c.lastAt || '') + '</div></div>' + right + '</div>';
        }).join('')
      : '<p class="empty">还没收到任何微信消息。扫码接入后，用微信给机器人发一句话就会出现在这里。</p>';

    var bindings = state.bindings || [];
    document.getElementById('bindList').innerHTML = bindings.length
      ? '<table><thead><tr><th>微信对话</th><th>账号</th><th>DSH 会话</th><th></th></tr></thead><tbody>'
        + bindings.map(function(b){
            return '<tr><td class="mono">' + esc(shortId(b.chatId)) + '</td><td class="muted">' + esc(b.accountLabel || '') + '</td>'
              + '<td>' + esc(b.sessionTitle || '（未命名）') + ' <span class="mono">' + esc(shortId(b.sessionId)) + '</span></td>'
              + '<td><button class="danger" data-unbind="' + esc(b.chatId) + '">解绑</button></td></tr>';
          }).join('') + '</tbody></table>'
      : '<p class="empty">还没有绑定。先让微信发一条消息过来，再在上面选一个 DSH 会话。</p>';

    document.getElementById('mirror').checked = state.settings.mirrorFromWeb !== false;
    document.getElementById('readDelay').checked = state.settings.readDelay !== false;
    document.getElementById('typingBurst').checked = state.settings.typingBurst !== false;
    document.getElementById('storage').textContent = state.storage || '';
  }

  function refresh(){
    return api('/api/state').then(function(s){ state = s; render(); }).catch(function(e){
      document.getElementById('accountList').innerHTML = '<p class="err">读取状态失败：' + esc(e.message) + '</p>';
    });
  }

  function stopPoll(){
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function showQr(payload){
    qrPanel.classList.add('on');
    var link = document.getElementById('qrLink');
    if (payload.imageDataUrl) {
      qrImg.style.display = 'block';
      qrImg.src = payload.imageDataUrl;
    } else {
      qrImg.style.display = 'none';
    }
    if (payload.imageUrl) {
      link.href = payload.imageUrl;
      link.style.display = 'inline';
    } else {
      link.style.display = 'none';
    }
    qrStatus.textContent = payload.imageDataUrl ? '等待扫码…' : '二维码图片没能生成，请点下面链接用手机打开';
    attemptId = payload.attemptId;
    stopPoll();
    pollTimer = setInterval(pollLogin, 2000);
  }

  function pollLogin(){
    if (!attemptId) return;
    api('/api/login/status?attemptId=' + encodeURIComponent(attemptId)).then(function(s){
      var map = { wait: '等待扫码…', scaned: '已扫码，请在手机上确认', confirmed: '已确认，正在接入…', connected: '已接入', expired: '二维码已过期，请重新生成', failed: '接入失败' };
      qrStatus.textContent = map[s.status] || s.status;
      if (s.error) qrStatus.textContent += '（' + s.error + '）';
      if (s.status === 'connected') {
        stopPoll(); attemptId = null; qrPanel.classList.remove('on'); refresh();
      } else if (s.status === 'expired' || s.status === 'failed') {
        stopPoll();
      }
    }).catch(function(e){ qrStatus.textContent = '查询失败：' + e.message; });
  }

  document.getElementById('loginBtn').addEventListener('click', function(){
    this.disabled = true;
    var btn = this;
    api('/api/login/start', {}).then(showQr).catch(function(e){ qrStatus.textContent = '申请二维码失败：' + e.message; qrPanel.classList.add('on'); })
      .then(function(){ btn.disabled = false; });
  });

  document.getElementById('cancelBtn').addEventListener('click', function(){
    if (attemptId) api('/api/login/cancel', { attemptId: attemptId }).catch(function(){});
    stopPoll(); attemptId = null; qrPanel.classList.remove('on');
  });

  document.addEventListener('click', function(event){
    var target = event.target;
    if (!(target instanceof HTMLElement)) return;
    var bindChat = target.getAttribute('data-bind');
    if (bindChat) {
      var accountId = target.getAttribute('data-account');
      var select = document.querySelector('[data-session-for="' + bindChat.replace(/"/g, '\\"') + '"]');
      if (!select || !select.value) { alert('先选一个 DSH 会话'); return; }
      target.disabled = true;
      api('/api/bind', { accountId: accountId, chatId: bindChat, sessionId: select.value })
        .then(function(){ refresh(); }).catch(function(e){ alert('绑定失败：' + e.message); })
        .then(function(){ target.disabled = false; });
    }
    var unbindChat = target.getAttribute('data-unbind');
    if (unbindChat) {
      target.disabled = true;
      api('/api/unbind', { chatId: unbindChat }).then(function(){ refresh(); }).catch(function(e){ alert('解绑失败：' + e.message); });
    }
    var removeId = target.getAttribute('data-remove');
    if (removeId) {
      if (!confirm('移除这个微信账号？绑定会一起清掉。')) return;
      target.disabled = true;
      api('/api/account/remove', { accountId: removeId }).then(function(){ refresh(); }).catch(function(e){ alert('移除失败：' + e.message); });
    }
  });

  document.getElementById('mirror').addEventListener('change', function(){
    api('/api/settings', { mirrorFromWeb: this.checked }).then(function(){ refresh(); }).catch(function(e){ alert('保存失败：' + e.message); });
  });
  document.getElementById('readDelay').addEventListener('change', function(){
    api('/api/settings', { readDelay: this.checked }).then(function(){ refresh(); }).catch(function(e){ alert('保存失败：' + e.message); });
  });
  document.getElementById('typingBurst').addEventListener('change', function(){
    api('/api/settings', { typingBurst: this.checked }).then(function(){ refresh(); }).catch(function(e){ alert('保存失败：' + e.message); });
  });

  refresh();
  setInterval(function(){ if (!attemptId) refresh(); }, 5000);
})();
</script>
</body>
</html>`
}
