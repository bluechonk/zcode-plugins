# plan-with-files

基于文件的规划，替代 ZCode 内置 plan 模式。产出三个规划文件（task_plan / progress / findings），做三方一致性核对，并拦下原生 plan。

ZCode 自带三层机制，但彼此互不知情：

| 层 | 谁管 | 数据在哪 |
| --- | --- | --- |
| 目标：做完了吗 | `/goal` | `session_target` 表（`status` = active / paused / complete） |
| 计划：分几步 | plan 模式 + `ExitPlanMode` | `.zcode/plans/plan-<sessionId>.md` |
| 执行：当前到哪 | `TodoWrite` / `TodoRead` | `todo` 表 |

本插件不重做任何一层，只补它们之间的空隙。

## 三个规划文件

落在**项目根**，与 planning-with-files 的形态对齐，但职责不同：

| 文件 | 谁维护 | 内容 |
| --- | --- | --- |
| `task_plan.md` | **插件派生** | 目标 / 下一步 / 阶段状态（阶段状态从待办推断） |
| `progress.md` | **插件派生** | 当前待办快照 + 活动线 |
| `findings.md` | **模型维护** | 需求 / 调研结果 / 技术决策 / 遇到的问题 |

**为什么不把三个都交给模型写**：planning-with-files 自己承认「计划被工具结果、协作者或 bug 静默改写」，于是需要 SHA-256 attestation、parallel-write guard 来补救。派生出来的文件不会有这个问题——它们永远与数据库一致，模型忘了更新也不会腐烂。

`findings.md` 是唯一例外：调研结果与决策理由**数据库里没有**，上下文压缩后就丢了，必须由模型记。插件只在文件不存在时写骨架，之后不覆盖；`Stop` 时如果它还是空骨架，提醒一次。

两个派生文件带「不要手改」的说明——手改会在下次 TodoWrite 时被覆盖。

## 五个 hook

| 事件 | 做什么 |
| --- | --- |
| `PreToolUse` | 拦 `EnterPlanMode`；`ExitPlanMode` 提交计划时记下阶段标题并检查标题 |
| `PostToolUse` | `TodoWrite` / `TodoRead` 之后重建台账 |
| `UserPromptSubmit` | 多步任务时注入规划模板（每会话最多 3 次） |
| `SessionStart` | 注入三方状态摘要，带节流 |
| `Stop` | 三方一致性核对，**只提醒不阻塞** |

### 为什么接管 plan 模式

ZCode 内置 plan 模式有两个问题：

**一、产出的是流程文档，不是可执行状态。** 它的 5 Phase（理解 / 设计 / 评审 / 定稿 / 提交）是「你要做什么」的流程引导，计划正文仍是自由 Markdown，没有状态标记，脚本读不出完成度。

**二、每次都要审批。** `ExitPlanMode` 的工具声明里 `requiresUserInteraction: true`，提交计划必然弹审批，无法跳过。

本插件改为拦下 `EnterPlanMode`，让模型直接用 `TodoWrite`：

```
todo 表 = 状态机
  status: pending / in_progress / completed
  position: 依赖顺序
```

`TodoWrite` 不需要审批，状态可被脚本读取，且已有 `progress-<sessionId>.md` 台账汇总进度。

确需原生 plan 模式时，设 `PLAN_WITH_FILES_ALLOW_PLAN_MODE=1` 放行。

### 规划模板

`UserPromptSubmit` 检测到多步任务（提问超过 80 字或含「实现 / 重构 / 迁移 / 排查」等词）且本轮还没有 `TodoWrite` 时，注入一份轻量模板，强调：

- 每项写清「做什么 + 怎么算完成」
- 按依赖顺序排 position
- 一次只留一个 `in_progress`
- 完成后立刻标 `completed`

每个会话最多注入 3 次，避免变成噪音。

### 计划标题要带主题

ZCode 侧边栏的「计划」面板用**每份计划的第一个标题**作为显示名，而 plan 模式规范要求正文以 `## Context` 开头。结果是多次规划后，侧边栏全部显示成「Context」，分不清哪份是哪份——而且计划列表会永久累积，没有清理机制。

本插件在捕获计划时检测裸标题（`Context` / `背景` / `概述` / `概要` / `说明`），命中即提示带上主题：

```md
## Context：repo-guardian 插件
```

这样侧边栏显示「Context：repo-guardian 插件」，能看出每份计划要做什么。

### 为什么不做规划门禁

本插件曾有一层「本轮没 `TodoWrite` 就拦下改状态的工具」，已删除。三条理由：

**一、判据错。** 那层用工具名白名单，只认识写死的十几个名字。ZCode 自己的 plan 模式走权限层 `checkPlanMode()`，判据是**工具元数据**（`readOnly` / `destructive` / `needsApproval`），新工具自动正确。实测白名单漏掉 25 个工具——`ReadSessionContext`、`CronList`、`GetWorkflowRun` 与全部 MCP 只读查询都是纯读，却全被拦。全库统计该门禁历史拦截 41 次，其中 7 次是纯只读操作。

**二、时机反。** 模型要先读代码才知道这任务该不该规划，而只读工具被拦，等于在摸清需求之前就逼它交计划。规划质量因此下降——它是被逼出来的，不是想清楚的结果。

**三、职责重叠。** ZCode 原生已有两层引导：

| 机制 | 形式 | 阈值 / 条件 |
| --- | --- | --- |
| `EnterPlanMode` | 提示词 + 用户审批 | 7 条触发条件（新增功能、多方案、改既有行为、架构决策、多文件、需求不清、偏好待定），并明确列出「改错别字」「加日志」「纯研究」三种不该用 |
| `TodoWrite` 提醒 | `additionalContext` 注入 | 10 轮未写 **且** 距上次提醒 10 轮，措辞写明「ignore if not applicable」 |

两者都是**可退出**的：前者靠用户审批，后者明确允许忽略。插件再拦一次，只是更差的一遍。

规划引导交回原生；本插件专注做原生没有的台账。

### 为什么 Stop 不用 block

两个硬约束（均经源码核实）：

1. 多个 Stop hook 的 `stopShouldContinue` 是**后者覆盖前者**。本插件若返回 `continue: false`，会静默废掉 `security-review` 的阻塞
2. ZCode 侧续接总次数上限 3，且用户一发新消息就作废

所以这里只注入 `additionalContext`，不改变收尾行为。

## 台账

落点与计划文件并列：`.zcode/plans/progress-<sessionId>.md`。

**绝不改写计划文件本身**——那是 ZCode 的内置产物。

台账是**派生物**：任何时候都能由「目标 + 计划 + 待办」三方状态重建。所以模型不需要维护它，也就不存在「模型忘了更新导致台账腐烂」的问题。

```md
# 计划进度

- 会话: sess_xxx
- 计划: .zcode/plans/plan-sess_xxx.md
- 目标: active · <objective 前 60 字> · 已用 235,844,934 tokens
- 更新: 2026-11-09 09:33

## 当前待办
- [x] Phase1 三项指定改动
- [>] 最终验证
统计：8 项 · 完成 7 · 进行中 1 · 未开始 0

## 计划阶段
1. 方案（存储无损 + UI 字节层拼接）
2. 1. gateway log-store.ts（核心）
...
> 阶段仅作导航；完成度以「当前待办」为准，目标层以 /goal 为准。

## 一致性
- 目标仍 active，但 8 项待办已全部完成：确认是收尾该执行 `/goal clear`，还是漏了收尾步骤。

## 活动线
| 时间 | 事件 | 变化 |
| --- | --- | --- |
| 09:33 | TodoWrite | 待办更新为 8 项 |
```

阶段提取会排除 `Context` / `验证` / `交付` / `测试` 这类非实施小节——ZCode 的 Phase 4 要求计划必须含它们，当成阶段会让导航失真。

## 一致性规则

只报能确证的矛盾，不做推断：

| 条件 | 提示 |
| --- | --- |
| 目标 active，待办全完成 | 该 `/goal clear` 还是漏了收尾 |
| 目标 complete，待办有未完成 | 待办过期还是目标判早了 |
| 目标 active，无任何待办 | 目标没拆成可勾选步骤 |
| 有计划文件，无任何待办 | 计划未落到可执行粒度 |

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PLAN_WITH_FILES_DISABLE` | — | 设 `1` 整体关闭 |
| `PLAN_WITH_FILES_ALLOW_PLAN_MODE` | — | 设 `1` 放行 `EnterPlanMode`，恢复 ZCode 原生 plan 模式 |
| `ZCODE_PLAN_GATE` | — | 设 `off` 整体关闭（插件改名前的兼容开关） |

## 数据来源

全部**只读**访问 `~/.zcode/cli/db/db.sqlite`：`todo`、`session_target`、`message`、`part`。

已核实：`todo.session_id` 与 `session_target.session_id` 都用会话原样 id，无格式转换。

## 依赖

Node >= 22（`node:sqlite`）。运行时零依赖。

## 构建

源码是 TypeScript，产物由构建生成并入库：

```sh
npm install
npm run build              # 写盘
npm run build -- --check   # 只比对，不一致则非零退出
```

`src/*.ts` 顶层文件各产出一个 `hooks/<同名>.mjs`；`src/lib/**` 是共享代码。**不要手改 `hooks/*.mjs`**。
