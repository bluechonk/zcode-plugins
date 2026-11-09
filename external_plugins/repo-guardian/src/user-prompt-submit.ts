/**
 * UserPromptSubmit：CI 缺失的周期性重申。
 *
 * SessionStart 已经提示过一次，但那是会话启动时；长会话里模型可能早已忘了。
 * 仿 planning-with-files 的节流：距上次提示超过 N 轮才重申一次。
 */

import { disabled, emit, isSubagent, readHookInput, readState, writeState } from "./lib/hook";
import { cwdOf } from "./lib/hook";
import { findRepoRoot, hasCI } from "./lib/detect";

/** 距上次提示超过这么多轮才重申 */
const EVERY_N_TURNS = 10;

interface State {
  lastPromptedTurn: number;
}

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input || input.hook_event_name !== "UserPromptSubmit") return;
  if (isSubagent(input)) return;

  const sessionId = input.session_id ?? "";
  if (!sessionId) return;

  const root = findRepoRoot(cwdOf(input));
  if (!root || hasCI(root)) return; // 有 CI 或不在 git 仓库：没话说

  const state = readState<State>(sessionId, { lastPromptedTurn: -EVERY_N_TURNS });
  const turn = state.lastPromptedTurn + 1;
  writeState(sessionId, { lastPromptedTurn: turn });

  if (turn % EVERY_N_TURNS !== 0 && turn !== 1) return;

  emit("UserPromptSubmit", {
    additionalContext:
      "[repo-guardian] 提醒：本仓库仍没有 CI（.github/workflows/）。如果这是一个需要持续维护的项目，建议补一个最小 workflow。",
  });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
