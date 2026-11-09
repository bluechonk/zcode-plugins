# plan-gate

把「先规划再动手」变成硬约束：本轮没有 `TodoWrite` 记录时，拦截会改状态的工具调用。

ZCode 内置的 TodoWrite 提醒只是劝，模型可以忽略；本插件在工具执行前检查，没有规划就直接拒绝。

## 当前模式：enforce

`hooks/plan-gate.mjs` 顶部的 `MODE` 为 `enforce`：按规则拦截。

判定结果仍会追加到 `~/.zcode/plan-gate.log`（含 `deny` / `nudge` / `skip:*`），便于事后核对门禁为什么放行或拦截某次调用。

`observe` 模式（只记日志、从不拦截）保留在代码里，排障时可临时切回。

### 为什么先跑过 observe

官方 `zai-org/zcode-plugins` 的 AGENTS.md 称 hook 仅在官方市场或本地目录安装时执行，而 ZCode 的 `diagnosing-hooks` 文档称该说法已过期。两种说法矛盾，直接上 enforce 存在门禁静默失效的风险。

实测结论：**第三方市场的插件 hook 确实执行**。观察日志与 ZCode 日志两侧都留下记录：

```
# ~/.zcode/plan-gate.log
2026-11-09T00:42:27.001Z observe {"skip":"allowlisted-or-unknown","tool":"Bash","sessionId":"sess_863118a5-…"}

# ~/.zcode/cli/log/zcode-2026-11-09.jsonl
00:42:27.012Z  hook.run.allowed  plugin:plugin.plan-gate@bluechonk-plugins.PreToolUse  Bash
```

注意 **hook 在会话创建时注册**：装完插件必须开新会话，当前已打开的会话不会捡到它。

## 判定规则

| 情形 | 动作 |
| --- | --- |
| 子代理（`agent_type` ≠ `zcode-agent`） | 放行 |
| 工具在只读 / 研究 / 元操作白名单内 | 放行 |
| 本轮已调用过 `TodoWrite` | 放行 |
| 本轮未规划，工具会改状态 | 拦截，并要求先 `TodoWrite` |
| 距上次 `TodoWrite` 超过 25 次工具调用 | 注入一条进度提醒 |
| 数据库不可读等任何异常 | 放行（fail-open，门禁自身故障不得卡死会话） |

白名单：`Read` `Grep` `Glob` `Bash` `WebSearch` `WebFetch` `TodoWrite` `TodoRead` `AskUserQuestion` `Skill` `ToolSearch` `TaskOutput` `TaskStop` `SendMessage` `EnterPlanMode` `ExitPlanMode` `DeferredToolCall` `ListModels`。

## 进度落盘

enforce 模式下每次 `TodoWrite` 会镜像清单到 `~/.zcode/progress/<session_id>.md` 与 `latest.md`。

## 逃生开关

启动 ZCode 的环境里设 `ZCODE_PLAN_GATE=off` 可整体绕过。

## 依赖

- Node >= 22.5（内置 `node:sqlite`）。
- 只读打开 `~/.zcode/cli/db/db.sqlite` 读取会话的规划状态，不写入。
