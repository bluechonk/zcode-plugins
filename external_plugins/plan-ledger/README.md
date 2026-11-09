# plan-ledger

两件事：**进度台账**、**三方一致性核对**。

ZCode 自带三层机制，但彼此互不知情：

| 层 | 谁管 | 数据在哪 |
| --- | --- | --- |
| 目标：做完了吗 | `/goal` | `session_target` 表（`status` = active / paused / complete） |
| 计划：分几步 | plan 模式 + `ExitPlanMode` | `.zcode/plans/plan-<sessionId>.md` |
| 执行：当前到哪 | `TodoWrite` / `TodoRead` | `todo` 表 |

本插件不重做任何一层，只补它们之间的空隙。

## 四个 hook

| 事件 | 做什么 |
| --- | --- |
| `PreToolUse` | 仅 `ExitPlanMode` 提交计划时记下阶段标题；标题太通用时提示 |
| `PostToolUse` | `TodoWrite` / `TodoRead` 之后重建台账 |
| `SessionStart` | 注入三方状态摘要，带节流 |
| `Stop` | 三方一致性核对，**只提醒不阻塞** |

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
| `PLAN_LEDGER_DISABLE` | — | 设 `1` 整体关闭 |
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
