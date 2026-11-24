/**
 * PostToolUse：命令跑完了，检查这次运行有没有留下可追溯的现场。
 *
 * 与 PreToolUse 的分工：那里是「还没跑，先劝你加 tee」；这里是「跑完了，
 * 如果它确实是个长跑且没落盘，趁模型还记得命令长什么样，提醒它下次带上」。
 * 两者都只提示——真正兜底的是 trace 命令行（hooks/trace.mjs），
 * 它由模型主动用，能做到边跑边落盘。
 *
 * 另一件事：Write/Edit 写出的 Python 脚本若有多处 print 却没 flush，
 * 这里提醒一次。这是「明明 print 了却看不到」的另一半原因。
 */

import { disabled, emit, isSubagent, readHookInput, readState, writeState } from "./lib/hook";
import { missingFlush } from "./lib/risks";

interface State {
  seen?: string[];
}

function filePathOf(toolInput: Record<string, unknown>): string {
  const p = toolInput["file_path"] ?? toolInput["path"] ?? toolInput["filePath"];
  return typeof p === "string" ? p : "";
}

/** 写入的文本：Write 取 content，Edit 取 new_string */
function addedText(tool: string, toolInput: Record<string, unknown>): string {
  if (tool === "Write") {
    const c = toolInput["content"];
    return typeof c === "string" ? c : "";
  }
  const n = toolInput["new_string"] ?? toolInput["newString"];
  return typeof n === "string" ? n : "";
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

  const hit = missingFlush(text, path);
  if (!hit) return;

  const state = readState<State>(sessionId, { seen: [] });
  const seen = new Set(state.seen ?? []);
  if (seen.has(`${hit.rule}\t${path}`)) return;
  seen.add(`${hit.rule}\t${path}`);
  writeState(sessionId, { seen: [...seen] });

  emit("PostToolUse", {
    additionalContext: `[run-trace] ${hit.message}\n\n这是提示，不阻塞。脚本本来就只跑一次、不在乎实时进度的话，说明理由继续即可。`,
  });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
