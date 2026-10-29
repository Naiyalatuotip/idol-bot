# 示例 Agent 预设

这是最小可用的陪伴型 Agent 预设模板。

## 用

1. 复制本目录到 `E:/DSH/plugins/dsh-preset-example/`
2. 改 `package.json` 的 `name`、`cordis.patch.yml` 的 `config.id` / `name` / `persona.prefix` / `customSkillDirs`
3. 安装并重启：

```bash
plugin_manager install_bundle target=link:E:/DSH/plugins/dsh-preset-example
```

4. 在 DSH 新建会话时选「示例角色」。

## 文件

| 文件 | 作用 |
|---|---|
| `cordis.patch.yml` | 预设声明：persona / 工具 / 技能 / 压缩 |
| `persona/system-prefix.txt` | 人格正文（与 patch 里的 prefix 保持一致） |
| `skills/example-skill/SKILL.md` | 技能模板 |
| `lib/index.js` | 空入口 |

## 规则

- 预设改动只影响**新创建**的 Agent；活着的 Agent 要重启/新建才换组合。
- `persona.complete: true` 会**替换**默认系统提示；不想丢掉默认工具说明就设 `false`。
- `customSkillDirs` 用绝对路径。
- 不要把真实人物语料、聊天记录、cookies 放进预设包。
