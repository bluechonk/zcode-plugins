---
name: plan-gate
description: 解释工具调用被 plan-gate 拦截的原因与应对。当工具返回「本轮尚未规划」这类拒绝、或需要了解本仓库的规划门禁与进度落盘位置时使用。
---

# plan-gate

工具执行前的规划门禁：本轮（自最近一次用户提问起）没有 TodoWrite 记录时，拦截会改状态的工具，要求先规划再动手。

## 被拦截时怎么办

1. 立刻调用 `TodoWrite`，写出任务拆解：步骤、顺序、验收标准。
2. 然后重试刚才被拒的工具。拒绝不会消耗任何状态，重试即可。

不要为了绕过门禁去改写工具入参或换一个等效工具。

## 不受限制的

`Read`、`Grep`、`Glob`、`Bash`、`WebSearch`、`WebFetch`、`TodoWrite`、`TodoRead`、`AskUserQuestion`、`Skill`、`TaskStop`、`SendMessage` 等只读、研究、元操作类工具任何时候都能用。**规划前完全可以先看现状**——读文件、跑 `git status`、搜代码都行，只有「改代码 / 派活」这类动作被挡住。

## 进度落盘

配置为 enforce 模式时，每次 `TodoWrite` 都会把清单镜像到：

- `~/.zcode/progress/<session_id>.md`
- `~/.zcode/progress/latest.md`

清单一律用 `TodoWrite` 维护，不要直接改这两个文件——它们只是镜像，下次 `TodoWrite` 会覆盖。

## 逃生开关

需要临时整体绕过门禁时，在启动 ZCode 的环境里设 `ZCODE_PLAN_GATE=off`。
