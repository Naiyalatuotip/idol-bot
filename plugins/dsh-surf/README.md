# dsh-surf

参考 [Mieksido/surfcore](https://github.com/Mieksido/surfcore) 的 QQ / B 站接入思路，做给本机 DSH 的两件事：

1. **QQ 接入**：OneBot v11 正向 WebSocket（NapCat / SnowLuma / Lagrange 都行）。
   QQ 消息 → `sessionController.prompt` → DSH 回合 → `follow` → 分气泡回 QQ。
2. **微博阅读**：用账号 cookies 只读「关注」和「推荐」时间线，按他的兴趣排序；
   提供 `weibo_browse` 工具，也可以定时把候选素材塞给目标会话 让角色主动分享。

## 装

按 `plugin-ops` 的「客户端半边标准流」：必须打成 tgz 按普通包安装（link 不会注册设置页）。

```bash
cd E:/DSH/plugins/dsh-surf
npm pack --pack-destination .
plugin_manager install_bundle target=file:E:/DSH/plugins/dsh-surf/dsh-surf-0.1.0.tgz
```

装完重启一次 DSH。设置侧栏会出现「冲浪（QQ/微博）」，独立页：`http://127.0.0.1:19387/dsh-surf/`。

## QQ

1. 本机跑一个 OneBot v11 实现（NapCat / SnowLuma / Lagrange），开正向 WebSocket，默认 `ws://127.0.0.1:3001`。
2. 设置页填 WS 地址和 access token（没有就留空）。
3. 在独立页把收到的 QQ 对话绑定到 DSH 会话。
4. 只转发绑定的对话；未绑定 10 分钟提示一次。

## 微博

1. 设置页点「扫码登录」，用微博 App 扫码，手机上确认（走 `passport.weibo.com/sso/v2/qrcode` 官方流程）。
2. 登录成功后 cookies 自动保存，不用手动复制；每次读多少条、定时间隔（0=关）照常设置。
3. 如果扫码后仍提示未登录，点「从 weibo_comment_hunter 导入」——它会读你填的 `cookies.json` 路径（例如另一个微博采集项目用浏览器登录出来的有效 cookies），导入前会用 `m.weibo.cn/api/config` 校验 `data.login`。
3. 「试读一次」验证；「现在分享一条」会往活着的 目标会话塞一条分享提示。
4. 角色在对话里说「看看微博」时会调用 `weibo_browse`。

排序：互动量 + 新鲜度 + 兴趣词命中（兴趣词来自设置 + 每日复盘的话题权重 + 默认游戏/番/书/摄影词）。

默认配比：**关注 3/4、推荐 1/4**（设置里的「关注比例」可调 0.5–1）；阅读顺序按 3 关注 : 1 推荐 交错，分享也优先从关注里挑。

## 数据

`~/.dsh/integrations/dsh-surf/config.json`（0600），cookies 不出现在任何 HTTP 响应里。
