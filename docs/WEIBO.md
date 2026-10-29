# 微博阅读（dsh-surf）

`plugins/dsh-surf` 里的微博部分：**扫码登录 → 只读关注/推荐时间线 → 按兴趣排序 → 在对话里分享**。
不点赞、不转发、不评论，只读公开内容。

---

## 1. 能力

| 能力 | 说明 |
|---|---|
| 扫码登录 | `passport.weibo.com/sso/v2/qrcode/image` 出码；`check` 轮询；成功后跟官方跳转收 cookies |
| 关注时间线 | `weibo.com/ajax/feed/friendstimeline` |
| 推荐时间线 | `weibo.com/ajax/feed/hottimeline` |
| 配比 | 默认 **关注 3/4、推荐 1/4**，可在设置里改 `0.5–1` |
| 排序 | 互动量 + 新鲜度 + 兴趣词命中（设置 + 每日复盘话题 + 默认游戏/番/书/摄影词） |
| 工具 | `weibo_browse`：角色在对话里说「看看微博」时调用 |
| 定时分享 | 到点把候选素材塞进目标会话，让她用自己口吻分享；优先从关注里挑 |
| 导入兜底 | 从任意 `cookies.json` 导入，先校验 `m.weibo.cn/api/config` 的 `data.login` |

---

## 2. 文件

```
plugins/dsh-surf/
├─ lib/
│  ├─ weibo.mjs    # 扫码登录、cookie jar、抓取、归一化、排序、分享提示词
│  ├─ index.js     # 路由：/api/weibo/login/*、/api/weibo/import、/api/weibo/test、/api/weibo/share
│  ├─ store.mjs    # weibo 配置 + 已读记录 + 缓存（0600）
│  ├─ client.js    # 设置页「冲浪（QQ/微博）」里的微博卡片
│  └─ page.mjs     # 独立页 /dsh-surf/ 的微博页签
└─ README.md
```

路由：

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/dsh-surf/api/weibo/login/start` | 生成二维码，返回 `attemptId + imageDataUrl` |
| GET | `/dsh-surf/api/weibo/login/status?attemptId=` | 轮询：wait / scanned / confirmed / expired |
| POST | `/dsh-surf/api/weibo/login/cancel` | 取消这次扫码 |
| POST | `/dsh-surf/api/weibo/import` | `{path}` 导入 cookies.json |
| POST | `/dsh-surf/api/weibo/config` | 保存 uid / 条数 / 关注比例 / 定时间隔 / 兴趣词 |
| POST | `/dsh-surf/api/weibo/test` | 试读一次 |
| POST | `/dsh-surf/api/weibo/share` | 立刻塞一条分享提示给目标会话 |

---

## 3. 扫码登录流程

```
POST passport.weibo.com/sso/v2/qrcode/image?entry=weibo&size=180
  → { retcode: 20000000, data: { qrid, image } }
  → 服务端下载 image，转 data:image/png;base64 给前端

轮询 POST /sso/v2/qrcode/check
  50114001 未使用（等待扫码）
  50114002 已扫描（手机待确认）
  20000000 成功 → data.url
  50114003/50114004/50114015 过期

成功：
  GET data.url（官方跳转）
  → 跟到 weibo.com，收 Set-Cookie
  → m.weibo.cn/api/config 校验 data.login
  → 保存 cookies + uid + 昵称
```

要点：

- 二维码图片由**服务端**下载后转 data URL，前端不直连 `v2.qr.weibo.cn`，避免防盗链/CORS。
- 同名 cookie 优先 `weibo.com` 域，避免登录域和微博域的 `SUB` 互相覆盖。
- cookies 只存 `$DSH_HOME/integrations/dsh-surf/config.json`（0600），HTTP 只回掩码。
- 二维码 5 分钟过期；页面上重新点「扫码登录」即可。

---

## 4. 抓取与排序

```js
关注条数 = round(N × followingShare)   // 默认 N × 0.75
推荐条数 = N − 关注条数
```

- 两边分别抓、分别排序，再按 **3 关注 : 1 推荐** 交错输出。
- 一边失败时用另一边补足数量，但不会把比例反过来。
- 已读 7 天的微博会降权（`weiboSeen`），避免每天推同一条。

排序分：

```
score = 兴趣命中数 × 6
      + log10(1 + 赞 + 转×2 + 评×1.5) × 3
      + 新鲜度（<1h 3 / <6h 2 / <24h 1）
      − 已读惩罚
```

兴趣词来源：

1. 设置页「兴趣词」；
2. `$DSH_HOME/daily/config.json` 里成长档案 `topics`（权重 ≥55）；
3. 默认词表（游戏/番/书/摄影/地偶/舞台等）。

---

## 5. 工具与分享

### `weibo_browse`

```
参数：{ kind: 'following' | 'recommend' | 'mixed', count?: number }
返回：带作者、数据、链接、为什么挑它的文本列表
```

工具挂载条件：Agent 的预设 id 是 `example`（可按需改 `presetOf(agent) === targetPreset()`）。
`parameters` 必须是完整 JSON Schema：

```js
parameters: {
  type: 'object',
  properties: { kind: { type: 'string', enum: [...] }, count: { type: 'number' } },
  additionalProperties: false,
}
```

### 定时分享

开启后每 `intervalMin` 分钟检查一次：优先从关注里挑一条没分享过的，构造提示词：

```
（微博分享提示：你刚刷了会儿微博，看到下面这些。挑一条你觉得他会感兴趣的，
用你自己的口吻跟他说说，不要像新闻播报……）
```

通过 `agent.followup({ source: { kind: 'weibo-share' } })` 注入；桥会把 source.kind ≠ user 的消息当主动消息推送到 IM。

---

## 6. 导入兜底

如果扫码流程被微博改版打断，可以用任意采集项目的 `cookies.json`：

```
POST /dsh-surf/api/weibo/import
{ "path": "E:/path/to/cookies.json" }
```

导入前会调 `m.weibo.cn/api/config` 校验 `data.login === true`，不是登录态直接拒绝。
文件格式：`{ "SUB": "...", "SUBP": "...", ... }`。

---

## 7. 排错

| 现象 | 原因 / 处理 |
|---|---|
| 二维码不显示 | `qrcode/image` 是否返回 `20000000`；`size error` 是缺 `entry/size` 参数 |
| 扫码后仍 `ok:-100` | cookies 不是 weibo.com 登录态；改用 `import` 导入有效 cookies |
| `缺少必要参数` | 调 `/ajax/profile/info` 没带 `uid`；先走 `m.weibo.cn/api/config` 拿 uid |
| 接口返回空 | 检查 `x-csrf-token`（来自 `X-CSRF-TOKEN` cookie）；检查是否被风控 |
| 工具报 `INVALID_REQUEST` | `parameters` 不是完整 JSON Schema |
| 推荐太多 | 调低设置里的「关注比例」到 0.85 |

---

## 8. 边界

- 只读公开时间线；不碰私信、不碰仅粉丝可见。
- 请求有 20 秒超时；默认低频，避免风控。
- cookies 等同账号密码，只存本机、不提交仓库、不出现在 HTTP 响应里。
