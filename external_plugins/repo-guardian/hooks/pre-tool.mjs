// 本文件由 scripts/build.mjs 从 external_plugins/repo-guardian/src/pre-tool.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/repo-guardian/src/lib/hook.ts
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
function envFlag(name) {
  return process.env[name] === "1";
}
function disabled() {
  return envFlag("REPO_GUARDIAN_DISABLE");
}

// external_plugins/repo-guardian/src/lib/comments.ts
function addedText(tool, input) {
  const asString = (v) => typeof v === "string" ? v : "";
  if (tool === "Write") return asString(input["content"]);
  if (tool === "Edit") return asString(input["new_string"]);
  if (tool === "MultiEdit") {
    const edits = input["edits"];
    if (!Array.isArray(edits)) return "";
    return edits.map((e) => e && typeof e === "object" ? asString(e["new_string"]) : "").join("\n");
  }
  return "";
}
function filePathOf(input) {
  return typeof input["file_path"] === "string" ? input["file_path"] : "";
}

// external_plugins/repo-guardian/src/lib/detect.ts
var EMOJI = new RegExp("\\p{Extended_Pictographic}", "u");
function containsEmoji(text) {
  return EMOJI.test(text);
}
function tempScriptOutsideTmp(filePath) {
  const normalized = filePath.replace(/\\/gu, "/");
  if (normalized.startsWith(".tmp/") || normalized.includes("/.tmp/")) return false;
  return /\.ps1$/iu.test(normalized);
}
var FORBIDDEN = [
  {
    id: "powershell.exe",
    pattern: /(?:^|&&|\|\||;|\|)\s*(?:[A-Za-z]:[\\/][^\s]*[\\/])?powershell\.exe\b/iu,
    message: "\u7981\u7528 powershell.exe\uFF1A\u53EA\u7528 PowerShell 7\uFF08pwsh\uFF09"
  },
  {
    id: "cmd.exe",
    pattern: /(?:^|&&|\|\||;|\|)\s*(?:[A-Za-z]:[\\/][^\s]*[\\/])?cmd\.exe\b/iu,
    message: "\u7981\u7528 cmd"
  },
  {
    id: "pip-install",
    pattern: /(?:^|&&|\|\||;|\|)\s*(?:[A-Za-z]:[\\/][^\s]*[\\/])?pip3?\s+install\b/iu,
    message: "\u7981\u7528 pip install\uFF1APython \u4E00\u5F8B uv"
  },
  {
    id: "poetry",
    pattern: /(?:^|&&|\|\||;|\|)\s*poetry\s+(?:add|install|update|remove|init|new)\b/iu,
    message: "\u7981\u7528 poetry\uFF1APython \u4E00\u5F8B uv"
  },
  {
    id: "conda",
    pattern: /(?:^|&&|\|\||;|\|)\s*conda\s+(?:install|create|env|activate)\b/iu,
    message: "\u7981\u7528 conda\uFF1APython \u4E00\u5F8B uv"
  }
];
function findForbiddenCommand(command) {
  for (const rule of FORBIDDEN) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(command)) return { id: rule.id, message: rule.message };
  }
  return null;
}
var CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/u;
function bashChineseStdout(command) {
  if (!CJK.test(command)) return false;
  if (/iconv/.test(command)) return false;
  for (const raw of command.split("\n")) {
    const line = raw.trim();
    if (!CJK.test(line)) continue;
    if (!/(?:^|[;&|]\s*|\bthen\s+|\bdo\s+|\{\s*)echo\b|\bprintf\b/iu.test(line)) continue;
    if (/>\s*\S/u.test(line)) continue;
    return true;
  }
  return false;
}

// external_plugins/repo-guardian/src/pre-tool.ts
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input || input.hook_event_name !== "PreToolUse") return;
  if (isSubagent(input)) return;
  const tool = input.tool_name ?? "";
  const toolInput = input.tool_input ?? {};
  if (tool === "Bash") {
    const command = typeof toolInput["command"] === "string" ? toolInput["command"] : "";
    if (!command) return;
    const forbidden = findForbiddenCommand(command);
    if (forbidden) {
      emit("PreToolUse", {
        permissionDecision: "deny",
        permissionDecisionReason: `[repo-guardian] ${forbidden.message}`
      });
      return;
    }
    if (bashChineseStdout(command)) {
      emit("PreToolUse", {
        additionalContext: '[repo-guardian] \u7F16\u7801\u63D0\u793A\uFF1A\u8FD9\u6761\u547D\u4EE4\u7528 bash \u5185\u5EFA\uFF08echo / printf\uFF09\u8F93\u51FA\u4E2D\u6587\u3002\nZCode \u6309\u7CFB\u7EDF\u4EE3\u7801\u9875\uFF08\u672C\u673A 936/GBK\uFF09\u89E3\u7801 Bash \u8F93\u51FA\uFF0C\u800C bash \u5185\u5EFA\u8F93\u51FA UTF-8 \u5B57\u8282\u2014\u2014\u4E2D\u6587\u4F1A\u4E71\u7801\u3002\n\u628A\u4E2D\u6587\u8F93\u51FA\u5305\u4E00\u5C42\uFF1A`echo "\u2026" | iconv -f UTF-8 -t GBK`\uFF1B\u6216\u628A\u4E2D\u6587\u4EA4\u7ED9\u5916\u90E8\u7A0B\u5E8F\uFF08curl -w \u7B49\u6309\u4EE3\u7801\u9875\u8F93\u51FA\uFF09\u3002\npwsh \u4E0E\u5916\u90E8\u7A0B\u5E8F\u4E0D\u53D7\u5F71\u54CD\u3002'
      });
    }
    return;
  }
  if (tool !== "Write" && tool !== "Edit" && tool !== "MultiEdit") return;
  const path = filePathOf(toolInput);
  const text = addedText(tool, toolInput);
  const hits = [];
  if (text && containsEmoji(text)) {
    hits.push("\u672C\u6B21\u5199\u5165\u542B emoji\uFF1A\u4ED3\u5E93\u89C4\u8303\u7981\u6B62 emoji\uFF08\u6587\u6863\u4E0E\u6301\u4E45\u8BB0\u5F55\u4E00\u5F8B\u7EAF\u6587\u672C\uFF09\u3002");
  }
  if (path && tempScriptOutsideTmp(path)) {
    hits.push(
      `\u811A\u672C\u5199\u5230 .tmp/ \u4E4B\u5916\uFF08${path}\uFF09\uFF1A\u6309\u89C4\u8303 .ps1 \u4E0E\u4E34\u65F6\u811A\u672C\u5FC5\u987B\u843D\u5728\u9879\u76EE\u6839\u7684 .tmp/\u3002`
    );
  }
  if (hits.length === 0) return;
  emit("PreToolUse", {
    additionalContext: `[repo-guardian] \u89C4\u5219\u63D0\u793A\uFF1A
${hits.map((h) => `- ${h}`).join("\n")}
\u8BEF\u62A5\u5C31\u76F4\u63A5\u8BF4\u660E\u7406\u7531\u5E76\u7EE7\u7EED\uFF0C\u4E0D\u5FC5\u4E3A\u4E86\u6D88\u63D0\u793A\u6539\u574F\u4EE3\u7801\u3002`
  });
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
