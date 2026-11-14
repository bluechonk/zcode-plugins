# pua-bridge

把 PUA 的 Claude Code 命令钩子接进 ZCode。10 个脚本全部接入，状态改落 ZCode 目录。

## 为什么需要它

PUA 的钩子是按 Claude Code 的命令钩子契约写的（`type: "command"` + `sh *.sh`），而 ZCode 只认 `process` 钩子，直接把脚本配进 `hooks.json` 要么不被识别、要么调用失败。

本插件用 ZCode 原生的 `process` 钩子包一层：stdin 原样转发、stdout 原样透出，输出契约（`hookSpecificOutput`）保持不变。脚本 vendor 在 `hooks/pua/`，自包含、不依赖 `CLAUDE_PLUGIN_ROOT`。

## 事件映射

一个事件可对应多个脚本，按顺序执行。

| ZCode 事件 | 脚本 | 做什么 |
| --- | --- | --- |
| `SessionStart` | `session-restore.sh` | 注入风味与协议；`/clear` 时清理旧检查点，否则恢复同作用域的检查点 |
| `UserPromptSubmit` | `frustration-trigger.sh` | 识别用户不满，切换风味 |
| `PreToolUse` | `integrity-guard.sh` | 改测试 / CI / 状态文件前的边界提醒 |
| `PostToolUse` | `failure-detector.sh` | 累计工具失败观察 |
| `PostToolUseFailure` | `failure-detector.sh` | 同上，失败专用事件 |
| `Stop` | `pua-loop-hook.sh` | loop 状态机（自报 promise + 独立验证） |
| `Stop` | `stop-feedback.sh` | 收尾反馈 |
| `SubagentStop` | `subagent-teardown.sh` | 子代理会计（append-only） |
| `PreCompact` | `checkpoint-save.sh` | 压缩前存数值检查点 |

未列出的事件直接放行（`exit 0`，不注入任何内容）。

## 状态落在哪

| 内容 | 位置 |
| --- | --- |
| 配置（`always_on` 等） | `~/.pua/config.json` |
| 运行时状态（失败观察、检查点） | `~/.pua/runtime-state/` |
| loop 状态机与历史 | `~/.pua/loop/` |
| 子代理会计 | `~/.pua/teardown.jsonl` |

**这是本次改造的重点。** 原脚本把 loop 状态与子代理会计写死在 `~/.claude/pua/`，在 ZCode 下这些文件不会被任何东西读到 —— 功能静默失效，且数据写进了另一个产品的目录。现在按宿主分流：

```
PUA_STATE_DIR 显式覆盖 → 用它
ZCode 环境（有 ZCODE_PLUGIN_DATA 或 ZCODE_SESSION_ID）→ ~/.pua
否则（Claude Code）→ ~/.claude/pua
```

`setup-pua-loop.sh`（`/pua-loop` 的启动脚本）与 `pua-loop-hook.sh`（Stop 钩子）**必须用同一套路径规则**，否则设了状态、钩子却读不到——两边都按上面的顺序解析。

## `/pua-loop` 的完整链路

| 环节 | 脚本 | 作用 |
| --- | --- | --- |
| 启动 | `hooks/pua/setup-pua-loop.sh` | 建 `loop-<cwd-hash>.md`，写入迭代参数与验证命令 |
| 每轮收尾 | `hooks/pua/pua-loop-hook.sh` | 读状态文件，检测 `<promise>` / `<loop-abort>`，跑 verify，决定继续或结束 |

启动脚本 vendor 自上游 `scripts/setup-pua-loop.sh`。上游把它放在 `scripts/` 下靠 `/pua-loop` 命令调用，本插件一并收进 `hooks/pua/`，便于离线与自包含。

## 与 Claude Code 的差异

| 项 | Claude Code | ZCode |
| --- | --- | --- |
| 转录文件 | 完整会话历史 | **只有一条**（Stop 时是最后一条助手消息，UserPromptSubmit 时是用户提问） |
| `last_assistant_message` | 无 | Stop 事件额外提供 |

`pua-loop-hook.sh` 用 `jq -rs 'map(.message.content[]? \| ...) \| last'` 取最后一条助手文本，这个写法对「只有一条」的转录同样成立，所以能直接跑。

## 已知限制

**`sanitize-session.sh` 是手动工具，不是钩子。** 它默认按宿主找转录文件（ZCode 的 `~/.zcode/cli/rollout` 与 `agents`、Claude Code 的 `~/.claude/projects`），但 ZCode 的转录格式与 Claude Code 不同，脱敏后的产物不能直接喂给 Claude Code 的会话恢复。

**依赖外部命令。** `bash` / `jq` / `python3` 缺任何一个，对应脚本会静默跳过（全部按 `exit 0` 处理，不阻塞主流程）。

## 安装

```sh
/plugin install pua-bridge@bluechonk-plugins
```

或本机验证：

```sh
npm run sync:local
```

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `PUA_STATE_DIR` | 覆盖状态根目录（可信的宿主进程变量，不从 hook 入参取） |
| `PUA_CONFIG` | 覆盖配置文件路径，默认 `~/.pua/config.json` |
| `PYTHON` | 指定 python 解释器，默认依次试 `python3` / `python` |

## 上游

脚本 vendor 自 `pua-skills` 插件，仅做 ZCode 兼容改造（路径分流、事件桥接），业务逻辑未改动。`pua-loop-hook.sh` 源自 Anthropic 的 ralph-wiggum（MIT）。
