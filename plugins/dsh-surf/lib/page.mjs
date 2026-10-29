export function renderPage({ prefix = '/dsh-surf' } = {}) {
  const P = JSON.stringify(prefix)
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>冲浪 · QQ / 微博</title>
<style>
:root{--paper:#F7F2EB;--ink:#081F5C;--mid:#334EAC;--light:#7096D1;--wash:#D0E3FF;--line:#BAD6EB;--accent:#A33A2C}
*{box-sizing:border-box}body{margin:0;padding:36px 20px 64px;background:var(--paper);color:var(--ink);font:15px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
main{max-width:900px;margin:0 auto}h1{font-size:26px;margin:0 0 4px}.sub{color:var(--mid);margin:0 0 18px}
.tabs{display:flex;gap:8px;margin:0 0 16px}.tabs button{font:inherit;padding:6px 14px;border:1px solid var(--line);background:#fff;color:var(--mid);cursor:pointer}
.tabs button.on{background:var(--mid);color:#fff;border-color:var(--mid)}
section{border-top:1px solid var(--line);padding:16px 0}h2{font-size:12px;letter-spacing:.16em;color:var(--light);font-weight:400;margin:0 0 10px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px}.row label{color:var(--mid);font-size:13px}
input,textarea,select{font:inherit;padding:6px 8px;border:1px solid var(--line);background:#fff;color:var(--ink)}
textarea{width:100%;min-height:90px;font-family:ui-monospace,Consolas,monospace;font-size:12px}
button{font:inherit;padding:6px 12px;border:1px solid var(--mid);background:var(--mid);color:#fff;cursor:pointer;border-radius:2px}
button.ghost{background:transparent;color:var(--mid)}button.danger{background:transparent;border-color:var(--accent);color:var(--accent)}
button:disabled{opacity:.5;cursor:default}.muted{color:var(--light);font-size:12px}.mono{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--mid)}
.item{padding:8px 0;border-bottom:1px solid var(--wash);font-size:13px}.grow{flex:1}
.badge{display:inline-block;font-size:11px;padding:2px 7px;border:1px solid var(--line);color:var(--light);margin-left:6px}
.badge.ok{color:#2f6b3a;border-color:#9cc7a5}.badge.no{color:var(--accent);border-color:#d9a79f}
pre{white-space:pre-wrap;background:#fffdf9;border:1px solid var(--line);padding:12px;font:12px/1.7 ui-monospace,Consolas,monospace;max-height:360px;overflow:auto}
</style></head><body><main>
<h1>冲浪<span class="badge">QQ + 微博</span></h1>
<p class="sub">QQ 走 OneBot v11 正向 WebSocket（NapCat / SnowLuma / Lagrange）；微博用账号 cookies 只读关注与推荐时间线。</p>
<div class="tabs"><button id="tabQQ" class="on">QQ 接入</button><button id="tabWB">微博阅读</button></div>

<div id="paneQQ">
<section><h2>连接</h2>
<div class="row"><label>WS 地址</label><input id="qqUrl" style="flex:1;min-width:280px" placeholder="ws://127.0.0.1:3001"></div>
<div class="row"><label>Access Token</label><input id="qqToken" style="flex:1;min-width:200px" placeholder="没有就留空"></div>
<div class="row"><button id="qqSave">保存并重连</button><button class="ghost" id="qqReconnect">重连</button><span class="muted" id="qqState"></span></div>
</section>
<section><h2>收到的 QQ 对话</h2><div id="qqChats" class="item"></div></section>
<section><h2>绑定</h2><div id="qqBindings"></div>
<div class="row" style="margin-top:10px"><select id="qqChatSelect"></select><select id="qqSessionSelect"></select><button id="qqBind">绑定</button></div>
</section>
<section><h2>日志</h2><pre id="logs"></pre></section>
</div>

<div id="paneWB" style="display:none">
<section><h2>账号</h2>
<div class="row"><button id="wbLogin">扫码登录</button><button class="ghost" id="wbCancel" style="display:none">取消</button><button class="ghost" id="wbImport">从 weibo_comment_hunter 导入</button><span class="muted" id="wbLoginState"></span></div>
<div id="wbQrBox" style="display:none;margin:8px 0"><img id="wbQr" alt="微博登录二维码" style="width:180px;height:180px;border:1px solid var(--line);background:#fff"></div>
<details style="margin:8px 0"><summary class="muted">手动填 cookies（备用）</summary>
<div class="row"><label style="min-width:70px">Cookies</label><textarea id="wbCookies" placeholder="从浏览器复制 weibo.com 的 Cookie（至少要有 SUB / SUBP）"></textarea></div>
</details>
<div class="row"><label>UID</label><input id="wbUid" style="width:160px"><label>每次读</label><input id="wbCount" type="number" min="5" max="50" style="width:80px"><label>关注比例</label><input id="wbShare" type="number" min="0.5" max="1" step="0.05" style="width:70px"><label>定时间隔（分钟，0=关）</label><input id="wbInterval" type="number" min="0" style="width:80px"></div>
<div class="row"><label>兴趣词（逗号分隔，可留空用默认）</label><input id="wbInterests" style="flex:1;min-width:280px"></div>
<div class="row"><label><input type="checkbox" id="wbShare"> 定时把候选素材塞给目标会话，让她主动分享</label></div>
<div class="row"><button id="wbSave">保存</button><button class="ghost" id="wbTest">试读一次</button><button class="ghost" id="wbShareNow">现在分享一条</button><span class="muted" id="wbState"></span></div>
</section>
<section><h2>最近读到的</h2><div id="wbCache"></div></section>
<section><h2>结果</h2><pre id="wbResult">点「试读一次」看结果。</pre></section>
</div>
<footer class="muted" style="margin-top:20px">配置：<span id="storage"></span></footer>
</main>
<script>
(function(){
  var P=${P};var st=null;
  function setVal(id,v){var el=document.getElementById(id);if(el&&document.activeElement!==el)el.value=v}
  function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
  function api(p,b){return fetch(P+p,{method:b===undefined?'GET':'POST',headers:b===undefined?{}:{'content-type':'application/json'},body:b===undefined?undefined:JSON.stringify(b)}).then(function(r){return r.json().then(function(j){if(r.ok&&j&&j.ok!==false)return j;throw new Error((j&&(j.error||j.message))||('HTTP '+r.status))})})}
  function refresh(){api('/api/state').then(function(s){st=s;render()}).catch(function(e){document.getElementById('qqState').textContent='读取失败：'+e.message})}
  function render(){
    var q=st.qq||{};
    setVal('qqUrl', q.url||'');
    var qt=document.getElementById('qqToken'); qt.value=''; qt.placeholder=q.tokenMasked?('已保存 '+q.tokenMasked+'（重填会覆盖）'):'没有就留空';
    document.getElementById('qqState').innerHTML=(q.connected?'<span class="badge ok">已连接</span>':'<span class="badge no">未连接</span>')+' '+(q.selfId?('账号 '+esc(q.selfId)):'')+' '+esc(q.lastError||'');
    document.getElementById('qqChats').innerHTML=(q.chats||[]).map(function(c){return '<div class="item"><b>'+esc(c.chatKey)+'</b> <span class="muted">'+esc(c.at||'')+'</span><div class="muted">'+esc(c.lastText||'')+'</div></div>'}).join('')||'<p class="muted">还没有收到 QQ 消息。</p>';
    var chatSel=document.getElementById('qqChatSelect');chatSel.innerHTML=(q.chats||[]).map(function(c){return '<option value="'+esc(c.chatKey)+'">'+esc(c.chatKey)+'</option>'}).join('');
    var sess=st.sessions||[];document.getElementById('qqSessionSelect').innerHTML=sess.map(function(s){return '<option value="'+esc(s.id)+'">'+esc((s.title||'（未命名）')+(s.alive?'':' · 未启动'))+'</option>'}).join('');
    document.getElementById('qqBindings').innerHTML=(q.bindings||[]).map(function(b){return '<div class="item"><b>'+esc(b.chatKey)+'</b> → '+esc(b.sessionId)+' <button class="danger" data-unbind="'+esc(b.chatKey)+'">解绑</button></div>'}).join('')||'<p class="muted">还没有绑定。</p>';
    var w=st.weibo||{};
    var wc=document.getElementById('wbCookies'); if(document.activeElement!==wc) wc.value='';
    wc.placeholder=w.configured?('已保存 '+w.cookiesMasked+'（重新填会覆盖）'):'从浏览器复制 weibo.com 的 Cookie';
    var ls=document.getElementById('wbLoginState');
    if(w.configured) ls.textContent='已登录'+(w.screenName?('：'+w.screenName):(w.uid?(' UID '+w.uid):''))+(w.lastLoginAt?(' · '+w.lastLoginAt.slice(0,10)):'');
    else if(!ls.textContent) ls.textContent='还没登录，点左边扫码';
    setVal('wbUid', w.uid||'');setVal('wbCount', w.count||20);
    setVal('wbInterval', w.intervalMin||0);setVal('wbShare', w.followingShare==null?0.75:w.followingShare);setVal('wbInterests', w.interests||'');
    document.getElementById('wbShare').checked=!!w.enableShare;
    document.getElementById('wbState').textContent=(w.lastFetchAt?('上次读：'+w.lastFetchAt):'还没读过')+(w.lastError?(' · '+w.lastError):'');
    document.getElementById('wbCache').innerHTML=(w.cache||[]).map(function(p){return '<div class="item"><div><b>'+esc(p.author||'')+'</b> <span class="muted">'+esc(p.why||'')+'</span></div><div class="muted">'+esc(p.text||'')+'</div><div class="mono">'+esc(p.url||'')+'</div></div>'}).join('')||'<p class="muted">还没有。</p>';
    document.getElementById('logs').textContent=(st.logs||[]).join('\\n');
    document.getElementById('storage').textContent=P.startsWith('/')?'~/.dsh/integrations/dsh-surf/config.json':'';
  }
  document.getElementById('tabQQ').onclick=function(){this.classList.add('on');document.getElementById('tabWB').classList.remove('on');document.getElementById('paneQQ').style.display='';document.getElementById('paneWB').style.display='none'};
  document.getElementById('tabWB').onclick=function(){this.classList.add('on');document.getElementById('tabQQ').classList.remove('on');document.getElementById('paneWB').style.display='';document.getElementById('paneQQ').style.display='none'};
  document.getElementById('qqSave').onclick=function(){api('/api/qq/config',{url:document.getElementById('qqUrl').value,token:document.getElementById('qqToken').value}).then(refresh).catch(function(e){alert(e.message)})};
  document.getElementById('qqReconnect').onclick=function(){api('/api/qq/reconnect',{}).then(refresh).catch(function(e){alert(e.message)})};
  document.getElementById('qqBind').onclick=function(){var c=document.getElementById('qqChatSelect').value,s=document.getElementById('qqSessionSelect').value;if(!c||!s)return alert('先选 QQ 对话和会话');api('/api/qq/bind',{chatKey:c,sessionId:s}).then(refresh).catch(function(e){alert(e.message)})};
  var loginAttempt=null, loginTimer=null;
  function stopPoll(){if(loginTimer){clearInterval(loginTimer);loginTimer=null}}
  function pollLogin(){
    if(!loginAttempt)return;
    fetch(P+'/api/weibo/login/status?attemptId='+encodeURIComponent(loginAttempt)).then(function(r){return r.json()}).then(function(j){
      if(!j.ok){document.getElementById('wbLoginState').textContent=j.error||'扫码状态读取失败';stopPoll();return}
      if(j.status==='wait'){document.getElementById('wbLoginState').textContent='等待扫码…'}
      else if(j.status==='scanned'){document.getElementById('wbLoginState').textContent='已扫描，请在手机上确认'}
      else if(j.status==='confirmed'){
        document.getElementById('wbLoginState').textContent='登录成功'+(j.screenName?('：'+j.screenName):'');
        document.getElementById('wbQrBox').style.display='none';
        document.getElementById('wbCancel').style.display='none';
        loginAttempt=null;stopPoll();refresh();
      } else if(j.status==='expired'){
        document.getElementById('wbLoginState').textContent='二维码过期了，重新点扫码';
        document.getElementById('wbQrBox').style.display='none';
        document.getElementById('wbCancel').style.display='none';
        loginAttempt=null;stopPoll();
      }
    }).catch(function(){});
  }
  document.getElementById('wbLogin').onclick=function(){
    document.getElementById('wbLoginState').textContent='正在生成二维码…';
    fetch(P+'/api/weibo/login/start',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(function(r){return r.json()}).then(function(j){
      if(!j.ok){document.getElementById('wbLoginState').textContent='生成失败：'+(j.error||'');return}
      loginAttempt=j.attemptId;
      var img=document.getElementById('wbQr');img.src=j.imageDataUrl;
      document.getElementById('wbQrBox').style.display='';
      document.getElementById('wbCancel').style.display='';
      document.getElementById('wbLoginState').textContent='等待扫码…';
      stopPoll();loginTimer=setInterval(pollLogin,2000);
    }).catch(function(e){document.getElementById('wbLoginState').textContent='生成失败：'+e.message});
  };
  document.getElementById('wbCancel').onclick=function(){
    if(loginAttempt)fetch(P+'/api/weibo/login/cancel',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({attemptId:loginAttempt})}).catch(function(){});
    loginAttempt=null;stopPoll();
    document.getElementById('wbQrBox').style.display='none';
    document.getElementById('wbCancel').style.display='none';
    document.getElementById('wbLoginState').textContent='已取消';
  };
  document.getElementById('wbImport').onclick=function(){
    document.getElementById('wbLoginState').textContent='正在导入 cookies…';
    fetch(P+'/api/weibo/import',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(function(r){return r.json()}).then(function(j){
      if(j.ok){document.getElementById('wbLoginState').textContent='导入成功：'+(j.screenName||j.uid);refresh()}
      else document.getElementById('wbLoginState').textContent='导入失败：'+(j.error||'');
    }).catch(function(e){document.getElementById('wbLoginState').textContent='导入失败：'+e.message});
  };
  document.getElementById('wbSave').onclick=function(){var b={uid:document.getElementById('wbUid').value,count:Number(document.getElementById('wbCount').value),followingShare:Number(document.getElementById('wbShare').value),intervalMin:Number(document.getElementById('wbInterval').value),enableShare:document.getElementById('wbShare').checked,interests:document.getElementById('wbInterests').value};var ck=document.getElementById('wbCookies').value.trim();if(ck)b.cookies=ck;api('/api/weibo/config',b).then(refresh).catch(function(e){alert(e.message)})};
  document.getElementById('wbTest').onclick=function(){document.getElementById('wbResult').textContent='读取中…';api('/api/weibo/test',{}).then(function(r){document.getElementById('wbResult').textContent=r.text+(r.errors&&r.errors.length?'\\n\\n（部分失败：'+r.errors.join('；')+'）':'');refresh()}).catch(function(e){document.getElementById('wbResult').textContent='失败：'+e.message;refresh()})};
  document.getElementById('wbShareNow').onclick=function(){api('/api/weibo/share',{}).then(function(r){alert(r.ok?'已塞给目标会话，让她分享':'失败：'+r.error);refresh()}).catch(function(e){alert(e.message)})};
  document.addEventListener('click',function(e){var t=e.target;if(!(t instanceof HTMLElement))return;var k=t.getAttribute('data-unbind');if(k){api('/api/qq/unbind',{chatKey:k}).then(refresh).catch(function(e){alert(e.message)})}});
  refresh();setInterval(refresh,15000);
})();
</script></body></html>`
}
