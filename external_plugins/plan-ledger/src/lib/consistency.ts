/**
 * 三方一致性核对：目标（/goal）、计划（plan 文件）、执行（待办）互不知情，
 * 这里找出它们之间的矛盾，供 Stop 时提示。
 *
 * 只报能确证的矛盾，不做推断：每条都必须是「两边状态客观上冲突」，
 * 而不是「可能有问题」。误报会持续消耗注意力，比漏报更伤。
 */

import type { GoalInfo, TodoItem } from "./zcode-db";

export interface ConsistencyInput {
  goal: GoalInfo | null;
  todos: TodoItem[];
  planPath: string | null;
  phases: string[];
}

export function checkConsistency(input: ConsistencyInput): string[] {
  const out: string[] = [];
  const { goal, todos, planPath, phases } = input;

  const done = todos.filter((t) => t.status === "completed").length;
  const open = todos.length - done;
  const hasTodo = todos.length > 0;

  // 目标还没结，但待办全清空了 —— 要么漏了，要么该 /goal clear
  if (goal?.status === "active" && hasTodo && open === 0) {
    out.push(
      `⚠️ 目标仍 active，但 ${todos.length} 项待办已全部完成：确认是收尾该执行 \`/goal clear\`，还是漏了收尾步骤。`
    );
  }

  // 目标已判完成，待办还有没做的
  if (goal?.status === "complete" && open > 0) {
    out.push(`⚠️ 目标已标记 complete，但仍有 ${open} 项待办未完成：核对是待办过期，还是目标判早了。`);
  }

  // 有目标但没有待办 —— 执行层完全空着
  if (goal?.status === "active" && !hasTodo) {
    out.push("⚠️ 目标 active 但没有任何待办：建议用 TodoWrite 把目标拆成可勾选的步骤。");
  }

  // 有计划文件但从未拆待办
  if (planPath && !hasTodo && phases.length > 0) {
    out.push(`⚠️ 有计划（${phases.length} 个阶段）但没有任何待办：计划未落到可执行粒度。`);
  }

  return out;
}
