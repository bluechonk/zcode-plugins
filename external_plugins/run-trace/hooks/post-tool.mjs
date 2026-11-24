// 本文件由 scripts/build.mjs 从 external_plugins/run-trace/src/post-tool.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/run-trace/src/lib/hook.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      data += c;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}
async function readHookInput() {
  const raw = await readStdin();
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function isSubagent(input) {
  const agent = input.agent_type ?? "";
  return agent !== "" && agent !== "zcode-agent";
}
function emit(hookEventName, inner) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, ...inner } }));
}
function stateDir() {
  return process.env["ZCODE_PLUGIN_DATA"] ?? process.env["CLAUDE_PLUGIN_DATA"] ?? join(homedir(), ".zcode", "run-trace");
}
function statePath(sessionId) {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "_") || "default";
  return join(stateDir(), `${safe}.json`);
}
function readState(sessionId, fallback) {
  try {
    return JSON.parse(readFileSync(statePath(sessionId), "utf8")) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeState(sessionId, value) {
  try {
    const p = statePath(sessionId);
    let current = {};
    if (value && typeof value === "object") current = readState(sessionId, {});
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ ...current, ...value }), "utf8");
  } catch {
  }
}
function disabled() {
  return process.env["RUN_TRACE_DISABLE"] === "1";
}

// external_plugins/run-trace/src/lib/risks.ts
function missingFlush(text, filePath) {
  const p = filePath.replace(/\\/gu, "/").toLowerCase();
  if (!/\.(?:py|pyi)$/u.test(p)) return null;
  const code = stripPythonComments(text);
  const prints = code.match(/\bprint\s*\(/gu);
  if (!prints || prints.length < 2) return null;
  if (/\bflush\s*=\s*True\b/u.test(code) || /sys\.stdout\.reconfigure\s*\(/u.test(code)) return null;
  if (!/(?:for\s+\w+\s+in\b|while\s+|time\.sleep|\.encode\s*\(|requests\.|subprocess\.)/u.test(code)) return null;
  return {
    rule: "py-no-flush",
    message: `\u8FD9\u4E2A Python \u811A\u672C\u6709\u591A\u5904 print\uFF08${prints.length} \u5904\uFF09\u4F46\u6CA1\u5F00 flush\uFF1A\u88AB\u7BA1\u9053\u63A5\u8D70\u65F6 python \u9ED8\u8BA4\u5757\u7F13\u51B2\uFF0C\u8FDB\u5EA6\u4F1A\u6512\u5230\u7ED3\u675F\u624D\u4E00\u6B21\u6027\u51FA\u73B0\uFF0C\u7B49\u4E8E\u770B\u4E0D\u5230\u3002
   \u6539\u6CD5\uFF1A\`print(..., flush=True)\`\uFF0C\u6216\u6587\u4EF6\u5934 \`sys.stdout.reconfigure(line_buffering=True)\`\uFF0C\u6216\u8FD0\u884C\u65F6 \`python -u\`\u3002`
  };
}
function stripPythonComments(text) {
  const out = [];
  for (const rawLine of text.split("\n")) {
    let inString = null;
    let cut = rawLine.length;
    for (let i = 0; i < rawLine.length; i += 1) {
      const ch = rawLine[i];
      if (inString) {
        if (ch === "\\") {
          i += 1;
        } else if (ch === inString) {
          inString = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = ch;
        continue;
      }
      if (ch === "#") {
        cut = i;
        break;
      }
    }
    out.push(rawLine.slice(0, cut));
  }
  return out.join("\n");
}

// external_plugins/run-trace/src/post-tool.ts
function filePathOf(toolInput) {
  const p = toolInput["file_path"] ?? toolInput["path"] ?? toolInput["filePath"];
  return typeof p === "string" ? p : "";
}
function addedText(tool, toolInput) {
  if (tool === "Write") {
    const c = toolInput["content"];
    return typeof c === "string" ? c : "";
  }
  const n = toolInput["new_string"] ?? toolInput["newString"];
  return typeof n === "string" ? n : "";
}
async function main() {
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
  const state = readState(sessionId, { seen: [] });
  const seen = new Set(state.seen ?? []);
  if (seen.has(`${hit.rule}	${path}`)) return;
  seen.add(`${hit.rule}	${path}`);
  writeState(sessionId, { seen: [...seen] });
  emit("PostToolUse", {
    additionalContext: `[run-trace] ${hit.message}

\u8FD9\u662F\u63D0\u793A\uFF0C\u4E0D\u963B\u585E\u3002\u811A\u672C\u672C\u6765\u5C31\u53EA\u8DD1\u4E00\u6B21\u3001\u4E0D\u5728\u4E4E\u5B9E\u65F6\u8FDB\u5EA6\u7684\u8BDD\uFF0C\u8BF4\u660E\u7406\u7531\u7EE7\u7EED\u5373\u53EF\u3002`
  });
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
