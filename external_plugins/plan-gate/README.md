# plan-gate

把「先规划再动手」变成硬约束：本轮没有 `TodoWrite` 记录时，拦截会改状态的工具调用。

ZCode 内置的 TodoWrite 提醒只是劝，模型可以忽略；本插件在工具执行前检查，没有规划就直接拒绝。

## 当前模式：observe（观察态）

`hooks/plan-gate.mjs` 顶部的 `MODE` 为 `observe`：**只写日志，从不拦截**。

这样做的原因是官方文档对「第三方市场的插件 hook 是否执行」有两种矛盾说法，需要先实测确认再切强制。观察态每次触发都会追加一行到：

```
~/.zcode/plan-gate.log
```

日志行含时间、模式、工具名、会话 id 与判定结果（`deny` / `nudge` / `skip:*`）。**看到日志就证明插件 hook 确实被执行了。**

确认后把 `MODE` 改成 `"enforce"` 并升版本，门禁即生效。

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
