/**
 * UserPromptSubmit：记下本轮起点。
 *
 * 一个用户消息算一轮。这里抓一份工作树快照作为基线，Stop 时据此只审本轮改动；
 * 同时把 Stop 的阻塞计数清零，避免上一轮的额度泄漏到这一轮。
 *
 * 配置可用性不在这里查：这一刻会话库还没有本轮的 assistant_response，
 * user_prompt 也未必落库，查必然读空——实测每个会话首轮都误报一次
 * 「读不到模型配置」。配置检查移到 Stop，那时数据一定齐。
 */

import { disabled, readHookInput, writeState } from "./lib/hook";
import { captureBaseline, isRepo } from "./lib/git";

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input || input.hook_event_name !== "UserPromptSubmit") return;

  const cwd = input.cwd ?? process.cwd();
  if (!isRepo(cwd)) return;

  const sha = captureBaseline(cwd);
  if (!sha) return;

  const sessionId = input.session_id ?? "default";
  writeState(sessionId, "baseline", { sha, cwd, at: new Date().toISOString() });
  writeState(sessionId, "stop", { blocks: 0 });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
