/**
 * 目标（/goal）与待办（todo 表）的一致性核对。
 *
 * 两层状态互不知情：目标由 /goal 管、待办由 TodoWrite 管，谁也不知道对方进行到哪。
 * 这里只报能确证的矛盾，不做推断——每条都必须是「两边状态客观上冲突」，
 * 而不是「可能有问题」。误报会持续消耗注意力，比漏报更伤。
 */

import type { GoalInfo, TodoItem } from "./zcode-db";

export interface ConsistencyInput {
  goal: GoalInfo | null;
  todos: TodoItem[];
}

/** 待办停摆多久算异常。阈值取 2 小时——一轮对话通常几分钟，25 轮量级约 2 小时 */
const STALE_TODO_MS = 2 * 60 * 60 * 1000;

export function checkConsistency(input: ConsistencyInput): string[] {
  const out: string[] = [];
  const { goal, todos } = input;
  if (!goal) return out;

  const done = todos.filter((t) => t.status === "completed").length;
  const open = todos.length - done;
  const hasTodo = todos.length > 0;

  // 目标还没结，但待办全清空了 —— 要么漏了收尾，要么该 /goal clear
  if (goal.status === "active" && hasTodo && open === 0) {
    out.push(
      `目标仍 active，但 ${todos.length} 项待办已全部完成：确认是收尾该执行 \`/goal clear\`，还是漏了收尾步骤。`
    );
  }

  // 目标已判完成，待办还有没做的
  if (goal.status === "complete" && open > 0) {
    out.push(`目标已标记 complete，但仍有 ${open} 项待办未完成：核对是待办过期，还是目标判早了。`);
  }

  // 有目标但没有待办 —— 执行层完全空着
  if (goal.status === "active" && !hasTodo) {
    out.push("目标 active 但没有任何待办：建议用 TodoWrite 把目标拆成可勾选的步骤。");
  }

  // 目标 active 但待办长时间没动：目标在推进而执行层停摆
  if (goal.status === "active" && hasTodo) {
    const newest = Math.max(...todos.map((t) => t.timeUpdated));
    if (newest > 0 && Date.now() - newest > STALE_TODO_MS) {
      const hours = Math.round((Date.now() - newest) / 3_600_000);
      out.push(
        `目标仍 active，但待办已 ${hours} 小时未更新：确认是漏了更新，还是任务已实际完成该执行 \`/goal clear\`。`
      );
    }
  }

  return out;
}
