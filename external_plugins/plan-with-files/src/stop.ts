/**
 * Stop：三方一致性核对。
 *
 * 刻意**不用 block**，只用 additionalContext：
 *   1. 多个 Stop hook 的 stopShouldContinue 是「后者覆盖前者」，返回 continue:false
 *      会静默废掉 security-review 的阻塞
 *   2. ZCode 侧续接总次数上限 3，且用户一发新消息就作废，抢这个额度不划算
 * 所以这里只提醒，不改变收尾行为。
 */

import { disabled, emit, isSubagent, readHookInput } from "./lib/hook";
import { checkConsistency } from "./lib/consistency";
import { readGoal, readPlan, readTodos } from "./lib/zcode-db";

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input) return;

  const event = input.hook_event_name;
  if (event !== "Stop" && event !== "SubagentStop") return;
  if (isSubagent(input)) return;

  const sessionId = input.session_id ?? "";
  const cwd = input.cwd ?? process.cwd();
  if (!sessionId) return;

  const todos = readTodos(sessionId);
  const goal = readGoal(sessionId);
  const plan = readPlan(cwd, sessionId);

  const issues = checkConsistency({
    goal,
    todos,
    planPath: plan?.path ?? null,
    phases: plan?.phases ?? [],
  });
  if (issues.length === 0) return;

  emit("Stop", {
    additionalContext: ["[plan-with-files] 计划 / 目标 / 待办之间存在不一致：", "", ...issues].join("\n"),
  });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
