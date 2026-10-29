# DSH 陪伴型 Agent 框架说明

> 一套在 **DeepSeek Harness（DSH）0.2.x** 上把「角色人格 + 记忆 + 心情 + 主动搭话 + IM 接入 + 每日学习」拼成一个可定制 agent 的做法。
> 本文档描述的是**框架和规则**，不是某个角色的私有设定。按它做，你可以换成自己的角色、自己的 IM、自己的学习策略。

- 适用：DSH Desktop / Web `0.2.x`（实测 `0.2.0-rc.2`，桌面端 19387 端口）
- 运行时：Node 22+（用到全局 `WebSocket`，实测 Node 26）
- 包管理：DSH 自带 pnpm；桌面端 profile 只能通过 App 内插件管理器或 `plugin_manager` 工具操作
- 许可：本仓库代码 MIT；第三方插件各自遵循原许可（见文末）

---

## 1. 总览

```
┌────────────────────────────────────────────────────────────┐
│                        DSH Host (0.2.x)                    │
│  session / agent / llm / tools / webServer / timer ...     │
└───────────────┬────────────────────────────────────────────┘
                │ Cordis Loader（profile bundles + patch）
┌───────────────▼────────────────────────────────────────────┐
│ Profile: desktop                                            │
│  ├─ 第三方：fish-memory / feiyu-mood / speak-up / im ...    │
│  ├─ 本仓库：dsh-wechat-bridge / dsh-surf / dsh-daily    │
│  └─ dsh-preset-example（Agent 预设声明）                        │
└───────────────┬────────────────────────────────────────────┘
                │ Agent Preset: persona + tools + skills
┌───────────────▼────────────────────────────────────────────┐
│ Agent（会话）                                                │
│  system prompt = 人格 prefix + 记忆 + 心情 + 每日校准/成长    │
│  tools = fs / skill / weibo_browse ...                      │
└───────────────┬────────────────────────────────────────────┘
                │ follow 事件流 / prompt / followup
┌───────────────▼────────────────────────────────────────────┐
│ IM 桥：微信 iLink / QQ OneBot v11                            │
│  入站 → sessionController.prompt；出站 → 分气泡推送          │
└────────────────────────────────────────────────────────────┘
```

**分层原则**：

1. **人格**放 Agent 预设（`persona` 插件），不写进桥接代码。
2. **记忆 / 心情 / 主动搭话**用第三方插件，通过 `systemPrompt.context` 注入，不硬编码进人格。
3. **IM 接入**是独立 bundle，只负责「消息 ↔ 会话」，不碰人格。
4. **每日学习**是独立 bundle，读写自己的状态，把「语言校准 / 成长」作为 context 注入。
5. 任何一层都能单独替换，不影响其他层。

---

## 2. 仓库结构

```
agent-framework/
├─ README.md
├─ LICENSE
├─ .gitignore
├─ docs/
│  └─ AGENT-FRAMEWORK.md        ← 本文
├─ plugins/
│  ├─ dsh-wechat-bridge/        ← 微信 iLink 桥（host + client + 页面）
│  ├─ dsh-surf/                 ← QQ OneBot 桥 + 微博阅读/分享
│  └─ dsh-daily/            ← 每日语言复盘 + 人格生长
└─ presets/
   └─ example-persona/          ← 最小可用的 Agent 预设模板
```

每个插件都是**独立 bundle**：`package.json` 声明 `dsh.bundle.patch`；带设置页的再加 `dsh.client` 和 `exports["./client"]`。

---

## 3. Agent 预设（Persona）

### 3.1 预设不是目录，是声明行

DSH 0.2.x 不再读 `~/.dsh/.agent-presets/`。预设由 profile 里一个 bundle 的 `cordis.patch.yml` **插入一行声明**：

```yaml
- insert:
    - id: preset-example
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: example
        name: 示例角色
        description: 一句话说明
        order: 5
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              complete: true
              prefix: |-
                ……完整的人格 prefix……
          - id: agent-instructions
            name: '@deepseek-ai/dsh-agent-instructions'
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'
          - id: tool-fs-search
            name: '@deepseek-ai/dsh-tool-fs-search'
          - id: skill-filesystem
            name: '@deepseek-ai/dsh-skill-filesystem'
            config:
              customSkillDirs:
                - E:/DSH/plugins/dsh-preset-example/skills
          - id: tool-skill
            name: '@deepseek-ai/dsh-tool-skill'
          - id: compaction
            name: group
            config:
              plugins:
                - id: compaction-basic
                  name: '@deepseek-ai/dsh-compaction-basic'
```

要点：

- `config.id` 是预设的稳定 id（会话/记忆/注入都认它）。
- `persona.complete: true` 表示**用 prefix 完全替换**默认系统提示；不加就是追加。
- `skill-filesystem.customSkillDirs` 指向你的技能目录；路径用绝对路径。
- 预设内的插件是**该 Agent 的私有组合**；profile 级插件（记忆/心情/桥）仍在全局层。

### 3.2 预设的生效时机

- 改 `cordis.patch.yml`（只改配置）→ 插件管理器禁用/启用 bundle 即热应用；**只影响新创建的 Agent**。
- 已经活着的 Agent 保留旧组合；要让它换新，**重启 DSH**（冷启动重建）或新建会话。
- 改插件代码（`lib/*.js`）→ ESM 不会热重载，**必须重启**。

### 3.3 人格 prefix 的写法

建议结构（顺序就是权重）：

1. **你是谁**：身份、年龄/时期、关系一句话。
2. **聊天对象**：是谁、怎么称呼、不能把他当普通用户。
3. **说话的感觉**：自然说话，不套格式；正常标点。
4. **用词习惯**：称呼、口头语、口癖、句式示例。
5. **性格底色**：怕什么、信什么、怎么表达难过。
6. **长文的口气**：一两篇真实长文当语气样本，而不是骨架。
7. **记忆与当下**：上下文里的心情/记忆当自然想起，不念出来。
8. **工具**：什么时候加载技能。
9. **出戏**：用户说「出戏/维护模式」时怎么退出角色。

反例（会让人格崩）：

- 大量格式规则（字数表、换行规定、开头配额）→ 模型变成填表机器。
- 把「对方的资料」写成人格的一部分 → 她会把对方的主队/段位说成自己的。
- 长文骨架 11 步 → 每篇长文都一个模子。

---

## 4. 技能树

### 4.1 技能目录

```
<plugin>/skills/
├─ voice/
│  ├─ SKILL.md                 # frontmatter: name + description + 正文
│  └─ references/
│     ├─ 01-语气细则.md
│     ├─ 02-原句库-场景分桶.md
│     ├─ 03-黑话与世界观.md
│     ├─ 04-长文与小作文.md
│     └─ 06-关于他.md
├─ persona-ops/
│  └─ SKILL.md                 # 维护流程：改设定、接语料、验收
└─ corpus/
   ├─ 原句库.jsonl
   ├─ 记忆导入-关系大事记.md
   └─ 原始语料/
```

### 4.2 SKILL.md 契约

```markdown
---
name: voice
description: 什么时候该加载它（模型靠这句话决定要不要读）
---

# 正文：素材、例子、判断标准
```

- `description` 写**触发条件**，不是内容摘要。
- 正文里可以引用 `references/` 的相对路径；模型用文件工具读。
- 不要把技能写成「规则清单」；写得像**给人看的参考手册**。

### 4.3 技能加载

- `skill-filesystem` 扫描 `customSkillDirs`，把技能目录写进系统提示的技能清单。
- 模型按 `description` 决定是否调用 `skill` 工具读取正文。
- 技能正文只在需要时进入上下文，不占日常 token。

---

## 5. 插件清单

### 5.1 本仓库原生插件

| 插件 | 作用 | 依赖的宿主服务 |
|---|---|---|
| `dsh-wechat-bridge` | 微信 iLink 扫码接入；绑定 DSH 会话；分气泡、阅读延迟、断续输入状态 | `webServer` `sessions` `agents` `sessionTitle` `sessionController` |
| `dsh-surf` | QQ OneBot v11 接入；微博扫码登录、关注/推荐阅读、按兴趣排序、`weibo_browse` 工具、定时分享 | `webServer` `sessions` `agents` `sessionTitle` `sessionController` `tools` `agentPresets` `timer` |
| `dsh-daily` | 每天读对话 → 语言校准 + 人格生长（话题权重/风格/回避）→ 注入 context；设置页 | `webServer` `sessions` `agents` `sessionTitle` `sessionController` `agentPresets` `llm` `timer` |

三个插件都遵循同一套约定：

- **配置**存 `$DSH_HOME/integrations/<plugin>/config.json` 或 `$DSH_HOME/<plugin>/config.json`，权限 0600。
- **令牌/cookies 只进不出**：HTTP 响应里只给掩码。
- **出站分气泡**：日常短回复按行拆 ≤5 条、间隔 450ms；长文不拆。
- **只转发绑定的对话**：未绑定 10 分钟提示一次。
- **客户端半边**：`dsh.client` + `settings.section` 注册设置页。

### 5.2 建议搭配的第三方插件

| 插件 | 作用 | 注意 |
|---|---|---|
| `dsh-fish-memory` | 长期记忆，按会话隔离、会淡忘 | 和任何「往系统提示塞记忆」的插件二选一 |
| `dsh-feiyu-mood` | 每轮判断心情，注入一句温度 | 注入频率可配，别每轮都念 |
| `dsh-speak-up` | 主动搭话：定时掷骰，命中才 followup | 安静时段/冷却/在场/每日上限 |
| `@xmanrui/dsh-im` | 通用 IM 接入（微信/飞书/QQ/Telegram…） | 和自建微信桥二选一，别同时抢同一个 bot |
| `dsh-raw-html-v2` | 正文裸 HTML 视觉卡 | 与人格无关，可选 |

**记忆/IM/主动搭话这三类不要同时装两套**——它们抢同一个注入位或同一个账号。

---

## 6. 运行时数据流

### 6.1 入站

```
微信 iLink / QQ OneBot
  → 桥的 handleInbound：抽文字、记 contextToken、找绑定
  → sessionController.prompt({requestId, sessionId, mode:'queue', content:[{type:'text',text}]}, signal)
      · signal 必须给（宿主第一行 signal.throwIfAborted()）
      · prompt 不可用时退回 agent.followup(message)
  → 标记 pendingFromWeChat / pendingFromQq
```

### 6.2 上下文组装

```
persona prefix（预设）
  + fish-memory 召回
  + feiyu-mood 心情一句
  + daily 【语言校准】/【成长】
  → 模型回合
```

注入约定：

- 心情/记忆/校准都走 `systemPrompt.context`（或各自的注入机制），**短、稳定、不破坏前缀缓存**。
- 每条 context 控制在 100–150 字；一次只给模型「现在需要知道的那一点」。

### 6.3 出站

```
sessionController.follow({address:{kind:'session', sessionId}}, signal)
  → snapshot（cursor）
  → event: user/message / assistant/message / turn/end
  → turn/end：按来源判断是否推送
      fromWeChat || ownInitiative(source.kind !== 'user') || mirrorFromWeb
  → 文本按行拆气泡（≤5，450ms 间隔）
  → sendText / send_private_msg / send_group_msg
```

### 6.4 主动搭话

```
speak-up 定时器 → 安静时段 / 冷却 / 在场 / 每日上限 / 命中线
  → 命中：agent.followup({source:{kind:'speak-up'}, ...})
  → 同一套模型回合 → 桥识别 ownInitiative → 推送到 IM
```

### 6.5 每日学习 / 人格生长

```
daily 定时（默认 03:30）
  → follow 快照读最近 N 条（冷会话也能读）
  → 默认模型分析：用词 / 语气 / 语义 / 对方反应
  → 写 digests/YYYY-MM-DD.md
  → 合并规则（≤16 条）+ 成长档案（话题权重 0–100，日衰减 1，单日 ±12）
  → 第二天作为 context 注入
```

---

## 7. 规则与兼容

### 7.1 宿主 / 版本

| 项 | 要求 |
|---|---|
| DSH | `0.2.x`（`0.2.0-rc.2` 实测） |
| Node | `>=22`（全局 `WebSocket`；`fetch`；`getSetCookie`） |
| profile | 桌面端 `desktop` 由 App 独占，只能用 `plugin_manager` / App 内管理器 |
| 微信 | iLink bot 协议 `2.4.6`，`https://ilinkai.weixin.qq.com/` |
| QQ | OneBot v11 正向 WebSocket（NapCat / SnowLuma / Lagrange），默认 `ws://127.0.0.1:3001` |
| 微博 | `passport.weibo.com/sso/v2/qrcode` 扫码；`weibo.com/ajax/feed/*` 读时间线 |

### 7.2 插件入口

```json
{
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": ["slots"], "external": ["react"] }
  }
}
```

### 7.3 设置页（客户端半边）

```js
window.__ModuleLoader__.load({
  id: 'my-plugin',
  factory: (require) => {
    const React = require('react')
    const inject = ['slots']
    function Section() { /* React 组件 */ }
    const apply = (ctx) => {
      const slots = ctx.get('slots')
      slots.inject('settings.section', () =>
        slots.register({ name: 'settings.section', id: 'my-plugin', order: 60, label: () => '我的插件' }, Section),
      )
    }
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
```

**硬规则：带客户端半边的插件必须用 tgz 安装，不能用 `link:`。**
`link:` 装的 bundle 宿主半边正常，但 `dsh.client` 扫描不会注册设置页；打成 `npm pack` 的 tgz 再 `install_bundle target=file:...tgz` 才会出现。改代码后要重新 pack + 重装。

### 7.4 工具 schema

`tools.register` 的 `parameters` 必须是**完整 JSON Schema**，不是属性表：

```js
parameters: {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['a', 'b'] },
    count: { type: 'number' },
  },
  additionalProperties: false,
}
```

写成 `{ kind: {...}, count: {...} }` 会在模型请求时报：
`Invalid schema for function 'xxx': schema must be a JSON Schema of 'type': 'object', got 'type': null`。

工具还需要 `output: { schema, render }`；`execute(args, exec)` 返回值经 `render` 变成 ContentBlock。

### 7.5 事件来源（source.kind）

| kind | 来源 | 出站策略 |
|---|---|---|
| `user` | 网页/IM 注入的普通用户消息 | 受 `mirrorFromWeb` 控制 |
| `speak-up` | 主动搭话 | 永远推送 |
| `wechat-bridge` / `qq-bridge` | 桥注入（followup 兜底） | 永远推送 |
| `weibo-share` | 微博定时分享 | 永远推送 |

判断逻辑：`fromWeChat || source.kind !== 'user' || mirrorFromWeb`。

### 7.6 安全

- 令牌/cookies 存 0600；HTTP 只回掩码。
- 桥只接受绑定过的对话；未绑定不转发。
- 微博只读公开时间线，不点赞/转发/评论；请求有超时与限速。
- 下载二维码/图片用服务端转 data URL，前端不直连第三方。
- 不要提交 `config.json`、`cookies.json`、`node_modules`、`*.tgz`。

### 7.7 兼容性检查清单

- [ ] `dsh --version` / App 版本是 0.2.x
- [ ] 插件 `inject` 的服务名在宿主存在（`sessionController` 等）
- [ ] 客户端半边用 tgz 安装
- [ ] 工具 `parameters.type === 'object'`
- [ ] `sessionController.prompt` 传了 AbortSignal
- [ ] bundle 代码改动后重启
- [ ] 改预设后新会话/重启才生效

---

## 8. 定制自己的 Agent（步骤）

1. **Fork 本仓库**，保留 `plugins/` 和 `docs/`。
2. **建预设**：复制 `presets/example-persona`，改 `config.id`、`name`、`persona.prefix`。
3. **写人格**：按 §3.3 的顺序写 prefix；先短，再补语料。
4. **建技能**：在 `skills/` 下建 `SKILL.md` + `references/`；把路径写进 `customSkillDirs`。
5. **接 IM**：装 `dsh-wechat-bridge` 或 `dsh-surf`，扫码/填 WS，绑定会话。
6. **开每日学习**：装 `dsh-daily`，设时间、目标会话、是否注入。
7. **验收**：新建会话聊 5 轮；看语气、长度、称呼、是否出戏；再跑一次每日复盘。
8. **发布**：`npm pack` 每个插件；在 README 写清安装命令、依赖、兼容版本。

---

## 9. 故障排查

| 现象 | 先查 |
|---|---|
| 设置侧栏没有插件页 | 是不是 `link:` 安装；改 tgz 重装 |
| 工具调用 `INVALID_REQUEST` | `parameters` 是不是完整 JSON Schema |
| 微信/QQ 收不到回复 | `/api/state` 的 `following` 是否 true；source.kind 判断 |
| 微信扫码 401 | iLink token 过期，重新扫码 |
| 微博 `ok:-100` | cookies 不是登录态；重新扫码或导入有效 cookies |
| 微博二维码不显示 | `passport.weibo.com/sso/v2/qrcode/image` 是否返回 20000000 |
| 预设改了不生效 | 活着的 Agent 保留旧组合；重启或新建会话 |
| 插件代码改了不生效 | ESM 缓存；重启 DSH |

---

## 10. 隐私与合规

- 语料、聊天记录、cookies 都是**本机私有数据**，不要提交到公开仓库。
- 公开仓库只放：框架代码、模板、文档；不放真实人物语料/用户资料。
- 微信/QQ 只转发**绑定过的**对话；不群发、不主动加人。
- 微博只读公开内容，遵守平台条款；高频请求会被风控，默认有延迟。
- 本项目用于个人陪伴与写作练习；不冒用真人身份对外发言。

---

## 11. 许可与致谢

- 本仓库代码：MIT。
- `dsh-wechat-bridge` 参考了 `@xmanrui/dsh-im` 的 iLink 协议实现（MIT），见 `THIRD_PARTY_NOTICES.md`。
- `dsh-surf` 的 QQ/微博接入思路参考了 [Mieksido/surfcore](https://github.com/Mieksido/surfcore)；未复制其代码。
- 微博扫码流程参考公开实现（`login.sina.com.cn` 遗留流程 → `passport.weibo.com/sso/v2` 现行流程）。
