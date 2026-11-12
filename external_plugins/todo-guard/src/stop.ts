/**
 * Stop：待办纪律的两项收尾核对。
 *
 *   1. 目标（/goal）与待办之间的矛盾——原生不做这件事，两层状态互不知情
 *   2. 本轮干了不少活却从没拆过待办——只在会话从未有过待办时提示一次
 *
 * 刻意**不用 block**，只用 additionalContext：
 *   1. 多个 Stop hook 的 stopShouldContinue 是「后者覆盖前者」，返回 continue:false
 *      会静默废掉 security-review 的阻塞
 *   2. ZCode 侧续接总次数上限 3，且用户一发新消息就作废，抢这个额度不划算
 * 所以这里只提醒，不改变收尾行为。
 */

import { disabled, emit, isSubagent, readHookInput, readState, writeState } from "./lib/hook";
import { checkConsistency } from "./lib/consistency";
import { looksUndecomposed } from "./lib/todo-discipline";
import { readGoal, readTodos, toolCallsThisTurn } from "./lib/zcode-db";

/** 本轮工具调用达到这个数才算「干了不少活」 */
const MIN_TOOL_CALLS = 6;

interface State {
  nudgedUndecomposed?: boolean;
}

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input) return;

  const event = input.hook_event_name;
  if (event !== "Stop" && event !== "SubagentStop") return;
  if (isSubagent(input)) return;

  const sessionId = input.session_id ?? "";
  if (!sessionId) return;

  const todos = readTodos(sessionId);
  const goal = readGoal(sessionId);
  const issues = checkConsistency({ goal, todos });

  const state = readState<State>(sessionId, "discipline", {});
  const calls = toolCallsThisTurn(sessionId);
  const undecomposed =
    !state.nudgedUndecomposed &&
    calls !== null &&
    looksUndecomposed({
      allTodos: todos,
      turnToolCalls: calls,
      minToolCalls: MIN_TOOL_CALLS,
      todoWriteSeen: calls.includes("TodoWrite"),
    });

  if (issues.length === 0 && !undecomposed) return;

  const lines: string[] = [];
  if (issues.length > 0) {
    lines.push("[todo-guard] 目标 / 待办之间存在不一致：", "", ...issues);
  }
  if (undecomposed) {
    if (lines.length > 0) lines.push("");
    lines.push(
      `[todo-guard] 本轮调了 ${calls?.length ?? 0} 次工具，但会话至今没有待办。` +
        "多步任务建议先用 TodoWrite 拆解：一次只留一个 in_progress，完成后立刻标 completed。"
    );
    writeState(sessionId, "discipline", { ...state, nudgedUndecomposed: true });
  }

  emit("Stop", { additionalContext: lines.join("\n") });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
