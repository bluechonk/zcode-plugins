/**
 * UserPromptSubmit：仓库卫生与 CI 缺失的周期性重申。
 *
 * SessionStart 已经提示过一次，但那是会话启动时；长会话里模型可能早已忘了，
 * 更可能的是——它压根没把这些提示和「现在要提交」这件事联系起来。
 * 仿 planning-with-files 的节流：距上次提示超过 N 轮才重申一次。
 */

import { disabled, emit, isSubagent, readHookInput, readState, writeState } from "./lib/hook";
import { cwdOf } from "./lib/hook";
import { findRepoRoot, hasCI } from "./lib/detect";
import { hygieneFindingLines, hygieneReport } from "./lib/hygiene";

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
  if (!root) return; // 不在 git 仓库：没话说

  // 先过节流再跑检测：审计要跑三次 git ls-files，每轮都跑会在大仓库里拖慢输入
  //
  // 起点取 0 而不是 -EVERY_N_TURNS：后者让 turn 从 -9 开始，`turn !== 1` 那道
  // 「首轮就说一次」的门槛永远过不了，重申实际要等到第 10 轮才第一次出现。
  const state = readState<State>(sessionId, { lastPromptedTurn: 0 });
  const turn = state.lastPromptedTurn + 1;
  writeState(sessionId, { lastPromptedTurn: turn });
  if (turn !== 1 && turn % EVERY_N_TURNS !== 0) return;

  const reminders: string[] = [];
  if (!hasCI(root)) {
    reminders.push("本仓库仍没有 CI（.github/workflows/）。");
  }
  const findings = hygieneFindingLines(hygieneReport(root)).filter((l) => l.trim());
  if (findings.length > 0) {
    reminders.push("仓库卫生仍有未处理项：", ...findings.map((l) => `  ${l}`));
  }
  if (reminders.length === 0) return;

  emit("UserPromptSubmit", {
    additionalContext: `[repo-guardian] 提醒：\n${reminders.map((l) => `- ${l}`).join("\n")}`,
  });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
