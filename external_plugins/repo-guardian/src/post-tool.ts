/**
 * PostToolUse：写入后按注释规范扫一遍本次新增的文本。
 *
 * 为什么放在写完之后而不是拦下写入：注释是风格问题，deny 会逼模型为了过检把内容改坏；
 * 写完后提示，它立刻能用 Edit 修。这与 security-review 的分工一致。
 *
 * 同一会话内同一条规则命中的同一个文件只提示一次：修好了还会再写这个文件，
 * 反复刷同样的提示只会吃掉上下文。沿用 security-review 的去重方式。
 */

import { disabled, emit, isSubagent, readHookInput, readState, writeState } from "./lib/hook";
import { addedText, checkComments, filePathOf } from "./lib/comments";

interface State {
  /** 已提示过的「规则 + 文件」组合 */
  seen?: string[];
}

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input || input.hook_event_name !== "PostToolUse") return;
  if (isSubagent(input)) return;

  const tool = input.tool_name ?? "";
  if (tool !== "Write" && tool !== "Edit" && tool !== "MultiEdit") return;

  const sessionId = input.session_id ?? "";
  if (!sessionId) return;

  const toolInput = input.tool_input ?? {};
  const path = filePathOf(toolInput);
  const text = addedText(tool, toolInput);
  if (!path || !text) return;

  const hits = checkComments(text, path);
  if (hits.length === 0) return;

  const state = readState<State>(sessionId, { seen: [] });
  const seen = new Set(state.seen ?? []);
  const fresh = hits.filter((h) => !seen.has(`${h.rule}\t${path}`));
  if (fresh.length === 0) return;

  for (const h of fresh) seen.add(`${h.rule}\t${path}`);
  writeState(sessionId, { seen: [...seen] });

  // 同一个文件可能同时命中多条，按行号排一遍，行号是模型定位的抓手
  const lines = fresh
    .sort((a, b) => a.line - b.line)
    .map((h) => `- 第 ${h.line} 行：${h.message}`);

  emit("PostToolUse", {
    additionalContext:
      `[repo-guardian] 本次写入有 ${fresh.length} 处注释不符合规范（${path}）：\n` +
      `${lines.join("\n")}\n` +
      "这是风格提示，不阻塞。判断规则不适用就直接说明理由继续，不必为了消提示改坏代码。",
  });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
