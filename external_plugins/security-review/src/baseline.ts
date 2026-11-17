/**
 * UserPromptSubmit：记下本轮起点，并检查审查配置是否可用。
 *
 * 一个用户消息算一轮。这里抓一份工作树快照作为基线，Stop 时据此只审本轮改动；
 * 同时把 Stop 的阻塞计数清零，避免上一轮的额度泄漏到这一轮。
 *
 * 配置检查是补可观测性：模型配置读不到时 Stop 会静默跳过审查，
 * 而「静默」正是这个插件失效十几天没人发现的原因。这里每会话只报一次。
 */

import { disabled, emit, readHookInput, readState, writeState } from "./lib/hook";
import { captureBaseline, isRepo } from "./lib/git";
import { readPrefs } from "./lib/prefs";
import { resolveSessionConfig } from "./lib/review";

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

  // 审查关着就不必再查配置：查了也没用，只会每会话多一条噪音
  if (!readPrefs().llmReview) return;

  const state = readState<{ configWarned?: boolean }>(sessionId, "config", {});
  if (state.configWarned) return;
  if (resolveSessionConfig(sessionId)) return;

  writeState(sessionId, "config", { configWarned: true });
  emit("UserPromptSubmit", {
    additionalContext:
      "[security-review] 读不到本会话的模型配置，本轮的安全审查已跳过。\n" +
      "需要会话库里有 providerId + modelId，且 ~/.zcode/v2/provider_config.json 里\n" +
      "配好该 provider 的 baseUrl 与 api-key。审查不发请求比发错请求好，但要知道它没跑。",
  });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
