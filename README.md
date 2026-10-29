# DSH 陪伴型 Agent 框架

在 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）0.2.x 上，把**角色人格 + 记忆 + 心情 + 主动搭话 + IM 接入 + 每日学习**拼成一个可定制的 agent。

本仓库只放**框架代码和模板**，不含任何真实人物语料、聊天记录或账号 cookies。

## 组件

| 层 | 组件 | 说明 |
|---|---|---|
| 人格 | `presets/example-persona` | Agent 预设模板：persona prefix + 工具 + 技能 + 压缩 |
| 微信 | `plugins/dsh-wechat-bridge` | iLink 扫码接入；绑定会话；分气泡、阅读延迟、断续输入 |
| QQ + 微博 | `plugins/dsh-surf` | OneBot v11 QQ 接入；微博扫码登录、关注/推荐阅读、`weibo_browse`、定时分享 |
| 学习 | `plugins/dsh-aoi-daily` | 每天复盘对话，产出语言校准 + 人格生长，注入会话 |

## 快速开始

```bash
# 1. 每个插件打成 tgz（带设置页的插件必须用 tgz，不能 link）
cd plugins/dsh-surf && npm pack --pack-destination .
# 2. 在 DSH 里安装（桌面端用 App 内插件管理器 / plugin_manager）
plugin_manager install_bundle target=file:E:/DSH/plugins/dsh-surf/dsh-surf-0.3.2.tgz
# 3. 重启 DSH
```

预设：把 `presets/example-persona` 复制到 `E:/DSH/plugins/`，改成你的 id/名字/人格，再按包安装。

## 文档

- [框架说明（架构 / 预设 / 技能 / 规则 / 兼容 / 排错）](docs/AGENT-FRAMEWORK.md)
- [微博阅读（扫码登录 / 关注+推荐 / 排序 / 分享 / 排错）](docs/WEIBO.md)

## 规则速记

- 预设是 `cordis.patch.yml` 里的一行声明，不是目录；改完只影响新 Agent。
- 带 `dsh.client` 的插件必须 **tgz 安装**，`link:` 不会注册设置页。
- 工具 `parameters` 必须是完整 JSON Schema（`type: 'object'`）。
- `sessionController.prompt(request, signal)` 的 signal 必填。
- 出站：`fromIM || source.kind !== 'user' || mirrorFromWeb`。
- 令牌/cookies 存 0600，不进任何 HTTP 响应。

## 许可

MIT。第三方致谢见 [docs/AGENT-FRAMEWORK.md](docs/AGENT-FRAMEWORK.md) 第 11 节与各插件 `THIRD_PARTY_NOTICES.md`。
