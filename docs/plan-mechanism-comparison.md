# 计划机制三方对照：Codex / Claude Code / ZCode

本机实测（2026-11-09），证据取自各自安装包与真实会话转录，不是文档推断。

| 来源 | 路径 |
| --- | --- |
| Codex 系统提示 | `~/.codex/sessions/**/rollout-*.jsonl` 的 `session_meta.payload.base_instructions.text` |
| Codex CLI | `C:\Program Files\nodejs\node_modules\@openai\codex`（0.163.0） |
| Claude Code 提示 | `C:\Program Files\nodejs\node_modules\@anthropic-ai\claude-code\bin\claude.exe` |
| ZCode CLI | `C:\Users\bluechonk\AppData\Local\Programs\ZCode\resources\glm\zcode.cjs` |
| ZCode 界面 | `C:\Users\bluechonk\AppData\Local\Programs\ZCode\resources\app.asar` |

## 一句话结论

三家都不用 `/plan` 才能规划，差别在**计划是不是一个独立状态**：

- **Codex**：没有 plan 状态，`update_plan` 只是一个普通工具，随时可调、随时可改。
- **Claude Code**：有 plan 状态，模型能**自己调 `EnterPlanMode` 进入**，且计划写进文件后随时可改。
- **ZCode**：有 plan 状态，模型也能自己进，但**与 `/goal` 互斥**；计划一旦提交就冻结成一次性快照，之后没有任何机制回写。

「ZCode 的计划最差、任务做完了计划还挂着」不是错觉，是设计结果。

## 一、进入方式

| | 触发者 | 工具 | 需要审批 |
| --- | --- | --- | --- |
| Codex | 模型自主 | `update_plan`（`pending` / `in_progress` / `completed`） | 否 |
| Claude Code | 模型自主 | `EnterPlanMode` | 否（`requiresUserInteraction: false`） |
| ZCode | 模型自主（有条件） | `EnterPlanMode` | 否（`needsApproval: false`） |

Codex 提示词原文（`base_instructions`）：

> You have access to an `update_plan` tool which tracks steps and progress and renders it to the user.
>
> Use a plan when: the task is non-trivial and will require multiple actions over a long time horizon … When the user asked you to do more than one thing in a single prompt.

Claude Code 与 ZCode 的 `EnterPlanMode` 描述**是同一份文本**：

> **Prefer using EnterPlanMode** for implementation tasks unless they're simple. Use it when ANY of these conditions apply:
> 1. New Feature Implementation … 7. User Preferences Matter

ZCode 的 `EnterPlanMode` 实现：

```js
async enterPlanMode(t) {
  let n = JP(e);                                   // 当前执行状态
  return { ...await V9(e, { planEnabled: !0 }, { ...t, source: "tool" }),
           previousMode: n.mode, previousPlanEnabled: n.planEnabled };
}
```

`V9`（`applyRuntimeExecutionState`）里有一处硬拦截：

```js
if (i.planEnabled && !o.planEnabled && (await e.readSessionTargetForContext(...))?.status === "active")
  throw new Error("Plan and Goal cannot be active at the same time.");
```

**所以 ZCode 的进入门槛不是「用户必须手动切」，而是「`/goal` 处于 active 时直接抛错」。** 提示词、工具、审批三样都和 Claude 一样，只多这一条互斥约束。

这是最容易踩的坑：开着 `/goal` 做长任务时，模型调 `EnterPlanMode` 会失败，而失败信息只有一句「Plan and Goal cannot be active at the same time」，模型通常不会转述给用户，表现为「它就是不进计划模式」。

## 二、计划提交之后

这是最关键的差异，也是「计划不更新」的根因。

### Codex：计划就是状态本身

```
update_plan  →  覆盖式写入  →  界面渲染
```

提示词明确要求持续更新：

> Before running a command, consider whether or not you have completed the previous step, and make sure to mark it as completed before moving on to the next step.
>
> If all steps are complete, ensure you call `update_plan` to mark all steps as `completed`.

没有「提交」这个动作，也就没有「提交后冻结」。

### Claude Code：计划是文件，可以随时改

ZCode 照抄了 Claude 的五阶段（Phase 1–5），但漏掉了 Claude 在 Phase 4 之前的关键一句：

> A plan file already exists at `<path>`. You can read it and **make incremental edits** using the Edit tool.
>
> You should build your plan **incrementally** by writing to or editing this file. NOTE that this is the only file you are allowed to edit.

Claude 的计划文件在 plan 模式期间**始终可写**，Phase 4 只是「把文件内容整理成最终稿」，不是「一次性提交」。

### ZCode：计划是快照

ZCode 的 `ExitPlanMode` 处理函数（`EOo`）：

```js
async function EOo(e){
  if(!e.plan.trim()) throw ...;
  let t = Swt(e);                       // .zcode/plans/plan-<sessionId>.md
  await e.fileSystemPort.writeTextFile({ atomic:!0, content:e.plan, path:t, ... });
  return { path: t };
}
```

`Swt` 的路径是 `plan-<sessionId>.md` —— **每个会话一个固定文件，写一次就再没别的写入点**。

计划正文从哪里来？`ExitPlanMode` 的入参 `plan` 字段（`WTs`，上限 20000 字符）。也就是说：**计划是模型在提交那一刻序列化出来的一段字符串，此后与执行状态再无关联。**

计划文件只在两种情况下被读回（`AOo`）：

```js
async function AOo(e){
  ... n = await readTextFile(Swt(e)) ...
  if(n.trim()) return jp("plan_file_reference", lOa({ planContent:n, planFilePath:t }));
}
```

调用点只有一个：`compact`（上下文压缩）之后。注入文案：

> A plan file exists from plan mode at: `<path>`
> Plan contents: …
> **If this plan is relevant to the current work and not already complete, continue working on it.**

注意最后一句——它只能靠模型自己判断「是不是已经做完」，**系统不提供任何完成度信息**。

## 三、计划与待办的耦合

ZCode 有两套独立的状态：`plan`（计划文件）和 `todo`（待办表）。二者**互不引用**：

- `ExitPlanMode` 只写 `plan`，不写 `todo`
- `TodoWrite` 只写 `todo`，不碰 `plan`
- 侧边栏「计划面板」读 `ExitPlanMode` 的入参快照，不读 `todo` 表

所以「任务做完了，计划还挂着」不是 bug，是**没有代码把两者连起来**。

Codex 没有这个问题，因为它只有一套状态。

Claude Code 也没有，因为它的计划文件在 plan 模式内可改，退出后就不再显示为「进行中的计划」。

## 四、提醒机制的阈值

三家都有「该更新待办了」的注入，阈值一致：

| | 距上次写入 | 距上次提醒 |
| --- | --- | --- |
| Codex | 无独立提醒（靠提示词常驻要求） | — |
| Claude Code | 10 轮 | 10 轮 |
| ZCode | 10 轮 | 10 轮 |

Claude 的 `kIe = { TURNS_SINCE_WRITE: 10, TURNS_BETWEEN_REMINDERS: 10 }`；ZCode 的 `X3o = { TURNS_SINCE_WRITE: 10, TURNS_BETWEEN_REMINDERS: 10 }`。文案也几乎逐字相同：

> The TodoWrite tool hasn't been used recently. If you're working on tasks that would benefit from tracking progress, consider using the TodoWrite tool to collect progress … This is just a gentle reminder - ignore if not applicable.

**这一层 ZCode 和 Claude 是等价的，不是差异点。**

真正的差异在工具描述的长度：

| | TodoWrite 描述字数 |
| --- | --- |
| Claude Code | 约 3000 字符（含 6 个完整示例 + When to Use / When NOT to Use） |
| ZCode | 约 374 字符 |

ZCode 把 Claude 的 `TodoWrite` 描述从 3000 字符砍到 374，删掉了全部示例和触发条件。工具还在，但「什么时候该用」的引导没了。

## 五、plan 模式的 5 阶段提示词

ZCode 的 `nUa()` 与 Claude 的 `dmo()` 是同一份模板，ZCode 只做了两处删减：

| 阶段 | Claude | ZCode |
| --- | --- | --- |
| Phase 1 | 可并行派最多 N 个 Explore 子代理 | 同（上限 3） |
| Phase 2 | 可派 Plan 子代理做设计 | **删掉了子代理，只留文字要求** |
| Phase 3 | Review，用 AskUserQuestion 澄清 | 同 |
| Phase 4 | 「把完整计划整理进 `plan` 参数」 | 同 |
| Phase 5 | 调 `ExitPlanMode` | 同 |

Claude 的 Phase 2 原文：

> Launch Plan agent(s) to design the implementation based on the user's intent and your exploration results from Phase 1. **Default: Launch at least 1 Plan agent for most tasks** — it helps validate your understanding and consider alternatives.

ZCode 的 Phase 2 只剩：

> Provide comprehensive background context from Phase 1 exploration … Describe requirements and constraints. Produce a detailed implementation plan.

**设计阶段从「独立子代理专门做设计」降级成「模型自己在脑子里过一遍」**。这是 ZCode 计划质量不如 Claude 的结构性原因。

## 六、`shouldDefer` 不是原因

ZCode 的 `EnterPlanMode` / `ExitPlanMode` / `TodoWrite` 都带 `metadata.shouldDefer: true`，一开始看起来像「工具被延迟加载，模型看不见」。

核实后排除：`isDeferredTool` 只在 `toolSearchMode !== "off"` 时生效，而配置默认 `toolSearchMode: "off"`（`Uon` schema 里 `toolSearchMode: lge.default("off")`），且本机 `~/.zcode/cli/config.json` 没有 `toolSearch` 字段。默认配置下 `shouldDefer` 是死代码。

## 七、可验证的推论

基于以上源码，以下现象都可预期：

1. **开着 `/goal` 时，plan 模式进不去。** `V9` 在 `planEnabled` 从 false 翻到 true 且 `session_target.status === "active"` 时直接抛错。这是「ZCode 不容易进入计划模式」的最强解释。
2. **plan 模式一旦退出，计划文件就是只读历史。** 唯一的写入点是 `ExitPlanMode` 的 `EOo`。
3. **任务做完后计划面板仍显示旧计划。** 面板数据源是 `ExitPlanMode` 的入参快照，与 `todo` 表无关联。
4. **上下文压缩会把旧计划重新注入。** `AOo` 在 compact 后被调用，文案是「如果这个计划还相关且没完成，继续做」——但系统不告诉模型它到底完成没有。
5. **多个会话在同一 workspace 会各有一份 `plan-<sessionId>.md`，互不清理。** `Swt` 按 sessionId 命名，没有任何 GC。
6. **`mode === "plan"` 与 `planEnabled === true` 不等价。** `Fw`（`resolveExecutionState`）里 `Oan` 枚举只有 `build` / `edit` / `yolo` / `guarded` / `auto`，**不含 `plan`**，所以 `mode` 会退回 `build`，而 `planEnabled` 单独由 `e.mode === "plan"` 或 `e.planEnabled` 决定。判断「是否在计划模式」必须看 `planEnabled`，不能看 `mode`。

## 八、对 plan-with-files 的意义

本插件填补的正是第七节第 2、3、4 条的缺口：

| ZCode 缺的 | 插件补的 |
| --- | --- |
| 计划提交后不可更新 | `task_plan.md` 由插件从 `todo` 表派生，每次 `TodoWrite` 后重建 |
| 计划与待办无关联 | 阶段状态从待办推断，两者永远一致 |
| 压缩后重新注入旧计划且无完成度 | `SessionStart` / `Stop` 注入三方（目标 / 计划 / 待办）一致性摘要 |
| 计划文件不清理 | 待办为空时不生成，`findings.md` 只在缺失时建 |

设计上的取舍与 ZCode 相反：**ZCode 把计划当快照，插件把计划当派生视图**。派生视图永远不会过期，因为它不存储，只渲染当前状态。

## 附：复现命令

抽取脚本在 `.tmp/`：

```sh
node .tmp/probe-plan-prompts.mjs <codex-rollout.jsonl>   # Codex 系统提示
node .tmp/probe-claude-anchors.mjs                        # Claude 计划提示词
node .tmp/probe-zcode-cli-plan.mjs                        # ZCode 五阶段与提醒
```

`.tmp/plan-prompts/` 下是抽出的原文。
