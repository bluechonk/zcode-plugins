/**
 * PreToolUse：本机规则检测。
 *
 * 硬规则（AGENTS.md 明写禁用）走 deny：powershell.exe / cmd / pip install / poetry / conda。
 * 软规则只注入提示：emoji、临时脚本写到 .tmp/ 之外。
 *
 * 为什么 deny 只给硬规则：这些是「用了就明确违规」的命令，重写代价低；
 * 而软规则（emoji、路径）容易误报，只提示不阻断。
 */

import { disabled, emit, isSubagent, readHookInput } from "./lib/hook";
import { addedText, filePathOf } from "./lib/comments";
import { containsEmoji, findForbiddenCommand, tempScriptOutsideTmp } from "./lib/detect";

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input || input.hook_event_name !== "PreToolUse") return;
  if (isSubagent(input)) return;

  const tool = input.tool_name ?? "";
  const toolInput = input.tool_input ?? {};

  // --- 硬规则：命令位置命中即 deny ---
  if (tool === "Bash") {
    const command = typeof toolInput["command"] === "string" ? (toolInput["command"] as string) : "";
    if (!command) return;
    const forbidden = findForbiddenCommand(command);
    if (forbidden) {
      emit("PreToolUse", {
        permissionDecision: "deny",
        permissionDecisionReason: `[repo-guardian] ${forbidden.message}`,
      });
      return;
    }
    return; // Bash 不查 emoji——命令里的 emoji 多半是输出内容
  }

  if (tool !== "Write" && tool !== "Edit" && tool !== "MultiEdit") return;

  // --- 软规则：只提示 ---
  const path = filePathOf(toolInput);
  const text = addedText(tool, toolInput);
  const hits: string[] = [];

  if (text && containsEmoji(text)) {
    hits.push("本次写入含 emoji：仓库规范禁止 emoji（文档与持久记录一律纯文本）。");
  }

  if (path && tempScriptOutsideTmp(path)) {
    hits.push(
      `脚本写到 .tmp/ 之外（${path}）：按规范 .ps1 与临时脚本必须落在项目根的 .tmp/。`
    );
  }

  if (hits.length === 0) return;

  emit("PreToolUse", {
    additionalContext: `[repo-guardian] 规则提示：\n${hits.map((h) => `- ${h}`).join("\n")}\n误报就直接说明理由并继续，不必为了消提示改坏代码。`,
  });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
