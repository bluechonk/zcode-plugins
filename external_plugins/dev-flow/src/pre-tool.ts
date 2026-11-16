/**
 * PreToolUse：探索式会话里，写入动作若不在 dev 分支就提示一次。
 *
 * 触发前提有两个，缺一不可：
 *   1. 本会话已被 UserPromptSubmit 标记为探索式（用户明确表过态）
 *   2. 当前分支不是 dev
 *
 * 双闸是为了压误报：普通开发（修 bug、写特性）不该被这句提示打扰，
 * 而探索式会话里「随手在主干/旧分支上改」才是这个插件要拦的行为。
 *
 * 同一会话只提示一次——提示是纠偏，不是每写一个文件就复读一遍。
 */

import { disabled, emit, isSubagent, readHookInput, readState, writeState, cwdOf } from "./lib/hook";
import { branchState } from "./lib/branch";

interface State {
  exploratory?: boolean;
  warned?: boolean;
}

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input || input.hook_event_name !== "PreToolUse") return;
  if (isSubagent(input)) return;

  const tool = input.tool_name ?? "";
  if (tool !== "Write" && tool !== "Edit" && tool !== "MultiEdit") return;

  const sessionId = input.session_id ?? "";
  if (!sessionId) return;

  const state = readState<State>(sessionId, {});
  if (!state.exploratory || state.warned) return;

  const { branch, hasDev } = branchState(cwdOf(input));
  if (!branch || branch === "dev") return;

  writeState(sessionId, { ...state, warned: true });
  emit("PreToolUse", {
    additionalContext:
      `[dev-flow] 本会话是探索式流程，但这次写入落在 ${branch} 分支上。\n` +
      (hasDev
        ? "本地已有 dev 分支——先 git switch dev 再继续，避免草稿落错地方。"
        : "本地还没有 dev 分支——先 git switch -c dev 再继续。") +
      "\n已在 dev 上则忽略本提示。",
  });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
