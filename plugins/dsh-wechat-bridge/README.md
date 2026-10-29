# dsh-wechat-bridge

把 DSH 里**指定的对话**接到微信私聊——扫码接入一个腾讯 iLink 微信机器人，然后把某个 DSH 会话绑定到某个微信对话，之后双向转发文字。

> 和已装的 `@xmanrui/dsh-im` 是一套协议（腾讯 iLink 官方机器人通道），区别在于本插件只做一件事：
> **绑定你已经存在的 DSH 对话**，不新建会话、不接管工作区、不做群聊/文件/审批。

> **改完代码必须重启 DSH。** 插件是 `link:` 安装，bundle 的启用/禁用只会重新应用 patch，
> **不会重新 import 模块**（ESM 缓存），实测禁用→启用后仍是旧代码。

## 装

```bash
plugin_manager install_bundle  target = link:E:/DSH/plugins/dsh-wechat-bridge
```

装完重启一次 DSH（或等 loader 热应用），然后打开：

```
http://127.0.0.1:19387/dsh-wechat-bridge/
```

## 用

1. 点「扫码接入微信」→ 用微信扫码并在手机上确认。成功后账号出现在「微信账号」。
2. 用你的微信给这个机器人发一句话。它会出现在「微信对话」里（未绑定时最多收到一条提示）。
3. 在那一行选一个 DSH 会话 → 点「绑定」。
4. 之后：微信发文字 → 进入该 DSH 会话成为用户消息；该会话这一轮的最后回答 → 发回这个微信对话。

默认「把 DSH 网页里发出的回答也同步回微信」是开的；关掉后只回微信自己问的那些。

## 接口

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/dsh-wechat-bridge/api/login/start` | 申请二维码，返回 `{ attemptId, imageUrl, expiresAt }` |
| GET | `/dsh-wechat-bridge/api/login/status?attemptId=` | `wait / scaned / confirmed / connected / expired / failed` |
| POST | `/dsh-wechat-bridge/api/login/cancel` | 取消这次扫码 |
| GET | `/dsh-wechat-bridge/api/state` | 账号、微信对话、DSH 会话、绑定、设置 |
| POST | `/dsh-wechat-bridge/api/bind` | `{ accountId, chatId, sessionId }` |
| POST | `/dsh-wechat-bridge/api/unbind` | `{ chatId }` |
| POST | `/dsh-wechat-bridge/api/account/remove` | `{ accountId }` |
| POST | `/dsh-wechat-bridge/api/settings` | `{ mirrorFromWeb: boolean }` |
| POST | `/dsh-wechat-bridge/api/debug/inject` | 仅回环地址；`{ sessionId, text }`，验证注入链路 |

所有接口注册在 Host 的 web 服务上，令牌不会出现在任何响应里。

## 诊断

`GET /api/state` 里现在带两样东西，出问题时先看它们：

- `bindings[].following`：这个会话的 `sessionController.follow` 是否挂着。
- `bindings[].followError` + `logs`：最近 60 条事件（inbound / prompt / follow 打开 / assistant / turn/end / deliver / 发送失败原因）。
- `logs` 里的 `发起方=…`：`user` 是网页/微信发起的对话，`speak-up` / 定时任务是**她自己的主动行为**——后者即使在 `mirrorFromWeb=false` 时也会推送到微信。
- v0.1.5 起：收到微信消息先做**阅读延迟**（0.6–3.5 秒，按字数），回复前发**断续输入状态**（`getconfig` 取 typing_ticket，亮 2.4–3.1 秒、灭 0.9–1.4 秒、再亮）；两个开关在页面上。

v0.1.2 起插件在 `inject` 里要求 `sessionController`，服务没就绪时会每 1.5 秒重试；`follow` 流正常结束（比如会话被关闭）会自动重连。v0.1.1 的坑是：插件 apply 时服务还没发布，`start()` 里静默跳过 follow，表现为「微信能发进来、DSH 也回了，但回不到微信」。

## 数据

```
$DSH_HOME/integrations/dsh-wechat-bridge/config.json
```

账号令牌、微信对话、绑定关系、每个账号的长轮询游标都在这个文件里（POSIX 下权限 0600）。删除账号会同时清掉它的绑定。

## 实现要点

- **入站**：`ilink/bot/getupdates` 长轮询 → 取 `item_list` 里的文字 → `sessionController.prompt({ mode:'queue' })`。`prompt` 会自动唤醒冷会话，所以不需要先手动打开那个对话。
- **出站**：`sessionController.follow` 跟会话日志；把一轮里所有 `assistant/message` 的文字攒着，`turn/end` 时一次性发回微信（避免工具步骤刷屏）。初始快照里的历史不会重发。
- **只信绑定过的对话**：未绑定的微信对话不会进入任何 DSH 会话，最多每 10 分钟收到一条提示。
- **令牌校验**：`getupdates` 返回 `-14` 时把账号标记为「令牌已失效，请重新扫码」，停止该账号的循环。

## 限制（第一版）

- **只做文字**：图片、文件、语音、表情包不转发；收到非文字会提示一次。
- **只做私聊**：群聊不处理；一个微信对话只能绑一个 DSH 会话，一个 DSH 会话可以绑多个微信对话。
- **没有客户端设置页**：管理界面是 Host 直出的独立页面（`/dsh-wechat-bridge/`），不占设置页的槽位。
- **没有"正在输入"**：协议支持 `sendtyping`，但需要先 `getconfig` 拿 ticket；第一版没接。
- **依赖腾讯 iLink 的接口稳定性**：这是官方机器人通道，但协议没有公开文档，字段变化时需要在 `lib/weixin-api.mjs` 里跟着调。
- **用微信个人号接机器人**：请自己评估账号风险；本插件只处理你主动绑定的对话，不群发、不主动找人。

## 目录

```
dsh-wechat-bridge/
├── package.json            # dsh.bundle.patch → cordis.patch.yml
├── cordis.patch.yml        # 插入一行 dsh-wechat-bridge
├── lib/
│   ├── index.js            # 插件入口：路由 + 组装
│   ├── weixin-api.mjs      # iLink 协议最小客户端
│   ├── bridge.mjs          # 会话桥：入站注入 / 出站跟随
│   ├── store.mjs           # 本地 JSON 存储
│   └── page.mjs            # 管理页
├── README.md
└── THIRD_PARTY_NOTICES.md
```

## 卸载

```bash
plugin_manager remove_bundle  target = dsh-wechat-bridge
```

数据目录不会自动删；不想留就把 `~/.dsh/integrations/dsh-wechat-bridge/` 一起删掉。
