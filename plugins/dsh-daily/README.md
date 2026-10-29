# dsh-daily

按天复盘目标会话：读最近消息，找出说话时的**语法 / 语义 / 节奏 / 口头禅**问题，同时总结**对方（用户）的语言习惯**，产出可以直接执行的短规则，并把规则作为语言校准注入目标会话。

> 只复盘「目标预设」的会话（默认 `example`，可在 `config.targetPreset` 改；也可以在页面上手动勾会话）。默认每天 03:30 跑一次，也可以随时手动跑。

## 装

```bash
# ⚠ 必须打成 tgz 再装：link 安装时 DSH 的 dsh.client 扫描不会把「设置页」注册进来
cd E:/DSH/plugins/dsh-daily
npm pack --pack-destination .
plugin_manager install_bundle  target = file:E:/DSH/plugins/dsh-daily/dsh-daily-<版本>.tgz
```

装完重启一次 DSH（bundle 代码在启动时 import）。页面：

```
http://127.0.0.1:19387/dsh-daily/
```

> 以后改代码要重新 `npm pack` + 重装 tgz；直接改 `E:/DSH/plugins/dsh-daily` 不会影响已安装的副本（装的是包拷贝，不是链接）。

## 它每天做什么

0. **人格生长**：除了语言习惯，还会根据**对方（用户）的回复和情绪**调整话题偏向——
   他回得长、主动追问、笑、接梗 → 话题加分；他回得短、换话题、情绪变冷 → 减分。
   话题权重 0–100（50 中性），每天向 50 回落 1，单日最多 ±12；另有「他吃哪一套」和「少碰」两张清单。
   结果会和语言规则一起，以 `【成长】` 的形式注入目标会话。
1. 取目标会话最近 N 条消息（`sessionController.follow` 的开场快照，冷会话也能读）。
2. 把对话 + 当前规则交给默认模型，要求只输出 JSON：
   - `issues`：语法 / 语义 / 节奏 / 口头禅问题，每条带改法和原句证据；
   - `userHabits`：对方的语言习惯，以及角色该怎么接；
   - `newRules`：≤40 字、可执行的规则；
   - `removeRules`：明显过时/错误的旧规则。
3. 写 `~/.dsh/daily/digests/YYYY-MM-DD.md`，并把新规则合并进 `config.json`（近似去重、最多保留 16 条）。
4. 如果开了「注入」，规则会以 `systemPrompt.context` 的形式进目标会话：
   `【语言校准】…`（最多 3 条、≤150 字），不破坏前缀缓存。

## 为什么是 context 而不是改预设

预设的 prefix 是静态文本，自动改写风险高；`systemPrompt.context` 是每轮都可变的附加段，学到的规则放这里，既能生效又不会把人物卡写坏。规则不满意可以在页面上单条删或清空。

## 接口

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/dsh-daily/api/state` | 配置、规则、复盘列表、会话、上次结果 |
| POST | `/dsh-daily/api/config` | `{enabled,hour,minute,maxMessages,injectContext,sessionIds,targetPreset}` |
| POST | `/dsh-daily/api/run` | 立即跑一次 |
| POST | `/dsh-daily/api/rules/delete` | `{text}` 删一条规则 |
| POST | `/dsh-daily/api/rules/clear` | 清空规则 |
| GET | `/dsh-daily/api/digest?date=YYYY-MM-DD` | 看某天的复盘 markdown |

## 数据

```
$DSH_HOME/daily/
  config.json            # 设置 + 规则 + 成长档案 + 上次结果
  digests/2026-10-26.md  # 每天的复盘
```

## 限制

- 复盘只看「最近 N 条」，不做精确的按日时间切分；对话量大时把 `maxMessages` 调大。
- 每次复盘 = 一次模型调用；规则合并是启发式的（近似去重 + 命中次数排序），不保证语义最优。
- 只读会话，不改历史；删规则/清空只影响后续注入。
