/**
 * PreToolUse：拦「跑起来看不见、死了没现场」的命令。
 *
 * 为什么不 deny：长跑命令不带 tee 有正当场景（比如只关心最后几行、或马上要重跑），
 * 硬拦会逼模型为了过检把命令拆得七零八落。这里给提示 + 现成的改法，
 * 让它自己决定要不要改。
 *
 * 但有一条例外：`2>&1 | grep` 这类会把退出码吞掉的写法，错误会被误判成成功，
 * 后果比「看不到进度」严重得多——所以这条单独强调，仍然不 deny，
 * 因为改写成本极低、而误伤（合法的 grep 用法）概率不低。
 */

import { disabled, emit, isSubagent, readHookInput, readState, writeState } from "./lib/hook";
import { traceRisks } from "./lib/risks";

interface State {
  /** 已提示过的「规则 + 命令」组合 */
  seen?: string[];
}

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input || input.hook_event_name !== "PreToolUse") return;
  if (isSubagent(input)) return;
  if ((input.tool_name ?? "") !== "Bash") return;

  const command = input.tool_input?.["command"];
  if (typeof command !== "string") return;

  const risks = traceRisks(command);
  if (risks.length === 0) return;

  const sessionId = input.session_id ?? "";
  if (!sessionId) {
    // 没有会话 id 就不去重：宁可重复提示，也不要因为状态写不进去而漏掉
    emit("PreToolUse", { additionalContext: format(risks) });
    return;
  }

  const state = readState<State>(sessionId, { seen: [] });
  const seen = new Set(state.seen ?? []);
  const fresh = risks.filter((r) => !seen.has(`${r.rule}\t${command}`));
  if (fresh.length === 0) return;

  for (const r of fresh) seen.add(`${r.rule}\t${command}`);
  writeState(sessionId, { seen: [...seen] });

  emit("PreToolUse", { additionalContext: format(fresh) });
}

function format(risks: Array<{ rule: string; message: string }>): string {
  const lines = [
    `[run-trace] 这条命令有 ${risks.length} 处会让运行过程「看不见」或「事后查不到」：`,
    "",
    ...risks.map((r, i) => `${i + 1}. ${r.message}`),
    "",
    "判断这里确实不需要（比如马上重跑、或只关心末尾结果）就说明理由继续。",
  ];
  return lines.join("\n");
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
