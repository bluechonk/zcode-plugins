/**
 * PreToolUse：捕获 ExitPlanMode 提交的计划。
 *
 * 只做这一件事：plan 模式批准时，把计划正文里的阶段标题记进会话状态，
 * 供台账的「计划阶段」一栏使用。
 *
 * 刻意**不做规划门禁**。这里曾有一层「本轮没 TodoWrite 就拦下改状态的工具」，
 * 已删除，原因三条：
 *
 *   1. 判据错。那层用工具名白名单，只认识写死的十几个名字；ZCode 自己的 plan
 *      模式走权限层 checkPlanMode()，判据是工具元数据（readOnly / destructive /
 *      needsApproval），新工具自动正确。实测白名单漏掉 25 个工具，
 *      ReadSessionContext、CronList 与全部 MCP 只读查询都属于纯读，被误拦。
 *   2. 时机反。模型要先读代码才知道这任务该不该规划，而只读工具被拦，
 *      等于在摸清需求之前就逼它交计划。
 *   3. 职责重叠。ZCode 原生已有两层引导：EnterPlanMode 的 7 条触发条件
 *      （需用户审批），以及 TodoWrite 提醒（10 轮未写且距上次提醒 10 轮，
 *      措辞明确允许忽略）。插件再拦一次，只是更差的一遍。
 *
 * 规划引导交回原生；本插件专注做原生没有的台账。
 */

import { disabled, emit, isSubagent, readHookInput, readState, writeState } from "./lib/hook";
import { extractPhases, isPlanModeActive } from "./lib/zcode-db";

/**
 * 计划标题是否只有「Context」这类通用词。
 *
 * ZCode 的侧边栏「计划」面板显示每份计划的第一个标题。plan 模式规范要求正文
 * 以 `## Context` 开头，于是每次提交的计划在侧边栏都叫「Context」——多次规划后
 * 完全分不清哪份是哪份。这里检测裸标题并提示带上主题。
 */
const GENERIC_TITLE = /^#{1,3}\s+(context|背景|概述|概要|说明)\s*$/iu;

function genericTitleOf(plan: string): string | null {
  for (const line of plan.split("\n")) {
    const m = /^(#{1,3})\s+(.+?)\s*$/u.exec(line);
    if (!m) continue;
    return GENERIC_TITLE.test(line) ? (m[2] as string) : null;
  }
  return null;
}

/**
 * 是否拦下 EnterPlanMode。
 *
 * 默认拦：ZCode 的 plan 模式产出的是「流程引导文档」，不是可执行状态，而且每次
 * 都要用户审批 ExitPlanMode。本插件用 TodoWrite 当状态机，不需要这一层。
 * 设 PLAN_WITH_FILES_ALLOW_PLAN_MODE=1 可放行，保留给确实想用原生 plan 的场景。
 */
function blocksPlanMode(): boolean {
  return process.env["PLAN_WITH_FILES_ALLOW_PLAN_MODE"] !== "1";
}

const DENY_PLAN_MODE =
  "[plan-with-files] 不用 ZCode 内置 plan 模式：它产出的是流程文档而非可执行状态，且每次都要审批。" +
  "请直接用 TodoWrite 拆解任务——每项写清「做什么 + 怎么算完成」，按依赖排序，" +
  "一次只留一个 in_progress。待办会自动汇总到 .zcode/plans/progress-<sessionId>.md。" +
  "确需原生 plan 模式时，设 PLAN_WITH_FILES_ALLOW_PLAN_MODE=1。";

/**
 * 原生 plan 模式已开启时的冲突提示。
 *
 * 为什么放在 PreToolUse 而不是 UserPromptSubmit：实测用户按 /plan 后，斜杠命令
 * 不触发 UserPromptSubmit，冲突提示根本没机会注入，会话就被原生 plan 锁住了。
 * 而 plan 模式下模型做任何操作都要过 PreToolUse，那里能稳定拿到 mode。
 *
 * 每个会话只提示一次：反复刷同样的警告只会吃上下文。
 */
const CONFLICT_NOTICE = [
  "[plan-with-files] 检测到原生 plan 模式已开启，与本插件冲突：",
  "",
  "- 原生 plan 会注入 5 Phase 提示词，与本插件的规划模板同时生效",
  "- 它的计划写进 .zcode/plans/ 且永久累积，没有清理机制",
  "- 提交计划要审批，打断流程",
  "",
  "建议切到 build 模式，用 TodoWrite 拆解任务。本插件的台账会接管进度追踪。",
].join("\n");

interface ConflictState {
  noticed: boolean;
}

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input || input.hook_event_name !== "PreToolUse") return;
  if (isSubagent(input)) return;

  const sessionId = input.session_id ?? "";
  if (!sessionId) return;

  // 原生 plan 已开启：先提醒一次，再继续原有逻辑（不阻断当前操作）
  //
  // 判据是库里的 planEnabled，不是入参的 permission_mode：ZCode 的 mode 枚举
  // 不含 plan，plan 模式下 mode 会退回 build，看 mode 永远命中不了。
  if (blocksPlanMode() && isPlanModeActive(sessionId)) {
    const state = readState<ConflictState>(sessionId, "conflict", { noticed: false });
    if (!state.noticed) {
      writeState(sessionId, "conflict", { noticed: true });
      emit("PreToolUse", { additionalContext: CONFLICT_NOTICE });
      return;
    }
  }

  // 拦原生 plan 模式：让模型改用 TodoWrite 状态机
  if (input.tool_name === "EnterPlanMode") {
    if (!blocksPlanMode()) return;
    emit("PreToolUse", {
      permissionDecision: "deny",
      permissionDecisionReason: DENY_PLAN_MODE,
    });
    return;
  }

  if (input.tool_name !== "ExitPlanMode") return;

  // ExitPlanMode 的 plan 参数就是批准后的完整计划。
  // 阶段提取复用 lib 里的同一份实现——曾在这里复制过一份，加了过滤后忘了同步，
  // 导致捕获到的阶段把 Context / 验证 这类非实施小节也算进去。
  const plan = input.tool_input?.["plan"];
  if (typeof plan !== "string" || !plan.trim()) return;

  writeState(sessionId, "plan", {
    capturedAt: new Date().toISOString(),
    phases: extractPhases(plan),
    bytes: plan.length,
  });

  // 侧边栏用第一个标题当计划名；裸 Context 会让多次规划全显示成「Context」
  const generic = genericTitleOf(plan);
  if (generic) {
    emit("PreToolUse", {
      additionalContext:
        `[plan-with-files] 计划标题「${generic}」太通用：ZCode 侧边栏用第一个标题作为计划名，` +
        `多次规划后会全部显示成「${generic}」，看不出每份计划要做什么。\n` +
        `建议改成带主题的写法，例如「## Context：repo-guardian 插件」。`,
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
