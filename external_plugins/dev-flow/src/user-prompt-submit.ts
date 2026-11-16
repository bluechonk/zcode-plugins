/**
 * UserPromptSubmit：识别探索式意图，并把会话标记下来。
 *
 * 标记是后续 PreToolUse 提示的依据：只有用户明确表露出「整理/拆分支/随便改改」
 * 这类意图，才会在随后的写入动作上坚持 dev 分支。没有标记就沉默——
 * 否则任何一次普通改动都会被拦一句「请在 dev 分支」，那是纯噪音。
 *
 * 每会话最多提示一次（提示是开场白的性质，不是每轮监督）。
 */

import { disabled, emit, isSubagent, readHookInput, readState, writeState, cwdOf } from "./lib/hook";
import { looksExploratory } from "./lib/exploratory";
import { branchState } from "./lib/branch";

interface State {
  exploratory?: boolean;
  prompted?: boolean;
}

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input || input.hook_event_name !== "UserPromptSubmit") return;
  if (isSubagent(input)) return;

  const sessionId = input.session_id ?? "";
  if (!sessionId) return;

  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  if (!looksExploratory(prompt)) return;

  const { branch, hasDev, trunk } = branchState(cwdOf(input));
  const state = readState<State>(sessionId, {});

  // 已经在 dev：标记即可，不用再提示
  if (branch === "dev") {
    if (!state.exploratory) writeState(sessionId, { ...state, exploratory: true });
    return;
  }

  if (state.prompted) return;

  const lines: string[] = ["[dev-flow] 这是探索式/收口场景，草稿改动应落 dev 分支。"];
  if (!branch) {
    lines.push("读不到当前分支（不在 git 仓库或处于 detached HEAD）：先确认仓库状态再动手。");
  } else if (hasDev) {
    lines.push(`本地已有 dev 分支：切过去再改（git switch dev），不要新建重复分支。`);
  } else {
    lines.push(`本地还没有 dev 分支：从当前稳定点建一个（git switch -c dev），再开始草稿改动。`);
  }
  if (trunk) {
    lines.push(`注意：当前在 ${branch}（主干），直接落草稿会污染主干历史。`);
  }
  lines.push("积累到一批后开整理会，按主题拆成干净的分支再逐个 PR。");

  writeState(sessionId, { ...state, exploratory: true, prompted: true });
  emit("UserPromptSubmit", { additionalContext: lines.join("\n") });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
