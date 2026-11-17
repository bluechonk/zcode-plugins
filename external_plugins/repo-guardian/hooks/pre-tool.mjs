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
var CREDENTIAL_NAME = /(?:^|\/)(?:\.env\.(?:local|dev|development|prod|production|test|ci|stage|staging)$|\.env$|[^/]*\.(?:pem|key|p12|pfx|jks|keystore|kdbx)$|id_rsa(?:$|[._2]|\.pub)|id_ed2519(?:$|[._2])|\.htpasswd$|credentials$|service-account(?:[-.][^/]*)?\.json$|secrets?\.ya?ml$)/iu;
var CREDENTIAL_TEMPLATE = /(?:^|\/)\.env\.(?:example|sample|template|dist)$/iu;
function isCredentialPath(filePath) {
  const p = filePath.replace(/\\/gu, "/");
  if (CREDENTIAL_TEMPLATE.test(p)) return false;
  return CREDENTIAL_NAME.test(p);
}
var ARTIFACT_DIR = /^(?:node_modules|dist|build|out|coverage|target|bin|obj|\.next|\.nuxt|\.turbo|__pycache__|\.venv|venv|env)\//iu;
var ARTIFACT_FILE = /(?:\.tsbuildinfo|\.pyc|\.pyo|\.o|\.a|\.lib|\.exp|\.map)$/iu;
function isArtifactPath(filePath) {
  const p = filePath.replace(/\\/gu, "/");
  return ARTIFACT_DIR.test(p) || ARTIFACT_FILE.test(p);
}
function segments(command) {
  return command.split(/(?:&&|\|\||;|\||\n)/u).map((s) => s.trim()).filter(Boolean);
}
function gitSubcommand(segment) {
  const tokens = segment.split(/\s+/u);
  const gitIndex = tokens.findIndex((t) => t === "git" || t.endsWith("/git") || t.endsWith("git.exe"));
  if (gitIndex < 0) return null;
  return tokens.slice(gitIndex + 1);
}
function analyzeGitCommand(command) {
  const info = {
    intent: null,
    addTargets: [],
    forceAdd: false,
    forcePush: false,
    historyRewrite: false
  };
  for (const seg of segments(command)) {
    const rest = gitSubcommand(seg);
    if (!rest || rest.length === 0) continue;
    const sub = rest[0] ?? "";
    if (sub === "commit") {
      info.intent = info.intent ?? "commit";
    } else if (sub === "add") {
      info.intent = info.intent ?? "add";
      if (rest.some((t) => t === "-f" || t === "--force")) info.forceAdd = true;
      for (const t of rest.slice(1)) if (!t.startsWith("-")) info.addTargets.push(t);
    } else if (sub === "push") {
      info.intent = info.intent ?? "push";
      if (rest.some((t) => t === "-f" || t === "--force" || t === "--force-with-lease=false")) {
        info.forcePush = true;
      }
    } else if (sub === "filter-branch" || sub === "filter-repo") {
      info.historyRewrite = true;
      info.intent = info.intent ?? "history-rewrite";
    }
  }
  for (const seg of segments(command)) {
    const first = (seg.split(/\s+/u)[0] ?? "").toLowerCase();
    if (first === "bfg" || first.endsWith("/bfg") || first.endsWith("\\bfg")) {
      info.historyRewrite = true;
      break;
    }
  }
  if (!info.historyRewrite && /bfg[\w.-]*\.jar/iu.test(command)) info.historyRewrite = true;
  if (info.historyRewrite) info.intent = info.intent ?? "history-rewrite";
  return info;
}

// external_plugins/repo-guardian/src/lib/hygiene.ts
var REQUIRED_GITATTRIBUTES_LINE = "* text=auto eol=lf";

// external_plugins/repo-guardian/src/pre-tool.ts
var COMMIT_CHECKLIST = [
  "[repo-guardian] \u63D0\u4EA4\u524D\u81EA\u67E5\uFF08\u4ED3\u5E93\u536B\u751F\u7B2C 3 \u6761\uFF09\uFF1A",
  "1. `git status` \u2014\u2014 \u6709\u6CA1\u6709\u8BE5\u5FFD\u7565\u5374\u6CA1\u5FFD\u7565\u7684\u6587\u4EF6\u3001\u6709\u6CA1\u6709\u4E34\u65F6\u4EA7\u7269\u8DDF\u7740\u8FDB\u6765\u3002",
  "2. `git diff --cached` \u2014\u2014 \u9010\u6761\u770B\u8FC7\u8981\u63D0\u4EA4\u7684\u5185\u5BB9\uFF0C\u786E\u8BA4\u6CA1\u6709\u51ED\u636E\u3001\u5BC6\u94A5\u3001\u771F\u5B9E token\u3002",
  "3. \u654F\u611F\u8BCD\u626B\u63CF \u2014\u2014 \u5728\u6682\u5B58\u5185\u5BB9\u91CC\u641C apikey / accesskey / secret / token / password /",
  "   private key / BEGIN .* PRIVATE KEY / AKIA / \u6570\u636E\u5E93\u8FDE\u63A5\u4E32\u3002",
  "4. \u4E00\u4E2A commit = \u4E00\u4EF6\u5B8C\u6574\u7684\u903B\u8F91\uFF1A\u540C\u4E00\u4EF6\u4E8B\u7684\u591A\u6B21\u8FD4\u5DE5\u5408\u6210\u4E00\u6761\uFF0C\u4E0D\u540C\u7684\u4E8B\u522B\u6DF7\u63D0\u3002",
  "",
  "\u8BEF\u63D0\u4EA4\u4E86\u51ED\u636E\uFF1A\u64A4\u9500\u63D0\u4EA4 \u2192 \u8F6E\u6362\u51ED\u636E \u2192 \u6E05\u7406\u5386\u53F2\u3002\u53EA\u5220\u6587\u4EF6\u4E0D\u7B97\u5904\u7406\u5B8C\uFF0C",
  "\u51ED\u636E\u7559\u5728\u5386\u53F2\u91CC\u5C31\u7B49\u4E8E\u8FD8\u5728\u88AB\u4EBA\u80FD\u62C9\u5230\u3002"
].join("\n");
var HISTORY_REWRITE_HINT = "[repo-guardian] \u8FD9\u6761\u547D\u4EE4\u5728\u6539\u5199 git \u5386\u53F2\u3002\u82E5\u76EE\u7684\u662F\u6E05\u9664\u8BEF\u63D0\u4EA4\u7684\u51ED\u636E\uFF1A\u5148\u8F6E\u6362\u51ED\u636E\uFF0C\u518D\u6539\u5199\u5386\u53F2\uFF0C\u6700\u540E force push\u2014\u2014\u5386\u53F2\u91CC\u7684\u5BC6\u94A5\u4E00\u65E6\u88AB\u62C9\u5230\uFF0C\u5220\u9664\u53EA\u662F\u8865\u6551\uFF0C\u4E0D\u662F\u64A4\u9500\u3002";
var FORCE_PUSH_HINT = "[repo-guardian] force push \u4F1A\u91CD\u5199\u8FDC\u7AEF\u5386\u53F2\u3002\u786E\u8BA4\u8FD9\u4E0D\u662F\u5728\u63A9\u76D6\u4E00\u6B21\u51ED\u636E\u6CC4\u9732\uFF1A\u51ED\u636E\u5FC5\u987B\u5148\u8F6E\u6362\u3002";
var FORCE_ADD_HINT = "[repo-guardian] `git add -f` \u4F1A\u628A .gitignore \u8986\u76D6\u7684\u6587\u4EF6\u5F3A\u884C\u5165\u5E93\u3002\u5982\u679C\u76EE\u6807\u662F dist/\u3001node_modules/ \u6216\u51ED\u636E\u6587\u4EF6\uFF0C\u8FD9\u6B63\u662F\u89C4\u8303\u7981\u6B62\u7684\u52A8\u4F5C\u3002";
function hintBlock(hints) {
  emit("PreToolUse", {
    additionalContext: `${hints.join("\n\n")}

\u8BEF\u62A5\u5C31\u76F4\u63A5\u8BF4\u660E\u7406\u7531\u5E76\u7EE7\u7EED\uFF0C\u4E0D\u5FC5\u4E3A\u4E86\u6D88\u63D0\u793A\u6539\u574F\u4EE3\u7801\u3002`
  });
}
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
    const hints = [];
    if (bashChineseStdout(command)) {
      hints.push(
        '[repo-guardian] \u7F16\u7801\u63D0\u793A\uFF1A\u8FD9\u6761\u547D\u4EE4\u7528 bash \u5185\u5EFA\uFF08echo / printf\uFF09\u8F93\u51FA\u4E2D\u6587\u3002\nZCode \u6309\u7CFB\u7EDF\u4EE3\u7801\u9875\uFF08\u672C\u673A 936/GBK\uFF09\u89E3\u7801 Bash \u8F93\u51FA\uFF0C\u800C bash \u5185\u5EFA\u8F93\u51FA UTF-8 \u5B57\u8282\u2014\u2014\u4E2D\u6587\u4F1A\u4E71\u7801\u3002\n\u628A\u4E2D\u6587\u8F93\u51FA\u5305\u4E00\u5C42\uFF1A`echo "\u2026" | iconv -f UTF-8 -t GBK`\uFF1B\u6216\u628A\u4E2D\u6587\u4EA4\u7ED9\u5916\u90E8\u7A0B\u5E8F\uFF08curl -w \u7B49\u6309\u4EE3\u7801\u9875\u8F93\u51FA\uFF09\u3002\npwsh \u4E0E\u5916\u90E8\u7A0B\u5E8F\u4E0D\u53D7\u5F71\u54CD\u3002'
      );
    }
    const git = analyzeGitCommand(command);
    if (git.intent === "commit") hints.push(COMMIT_CHECKLIST);
    if (git.forceAdd) hints.push(FORCE_ADD_HINT);
    if (git.forcePush) hints.push(FORCE_PUSH_HINT);
    if (git.historyRewrite) hints.push(HISTORY_REWRITE_HINT);
    for (const target of git.addTargets) {
      if (isCredentialPath(target)) {
        hints.push(
          `[repo-guardian] git add \u4E86\u51ED\u636E\u5F62\u6001\u7684\u6587\u4EF6\uFF08${target}\uFF09\uFF1A\u542B\u771F\u5B9E\u51ED\u636E\u7684 .env / .pem / .key \u4E00\u5F8B\u4E0D\u5165\u5E93\u3002\u6539\u8D70\u73AF\u5883\u53D8\u91CF\u6216\u5BC6\u94A5\u7BA1\u7406\u670D\u52A1\uFF0C\u5E76\u628A\u5B83\u52A0\u8FDB .gitignore\u3002`
        );
      } else if (isArtifactPath(target)) {
        hints.push(
          `[repo-guardian] git add \u4E86\u6784\u5EFA\u4EA7\u7269\u8DEF\u5F84\uFF08${target}\uFF09\uFF1Adist/\u3001node_modules/\u3001\u8FD0\u884C\u65F6\u6570\u636E\u4E0D\u5165\u5E93\u3002`
        );
      }
    }
    if (hints.length > 0) hintBlock(hints);
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
  if (path && isCredentialPath(path)) {
    hits.push(
      `\u6B63\u5728\u5199\u5165\u51ED\u636E\u5F62\u6001\u7684\u6587\u4EF6\uFF08${path}\uFF09\uFF1A\u771F\u5B9E\u51ED\u636E\u4E0D\u5165\u5E93\uFF0C\u8D70\u73AF\u5883\u53D8\u91CF\u6216\u5BC6\u94A5\u7BA1\u7406\u670D\u52A1\uFF1B\u5165\u5E93\u7684\u53EA\u80FD\u662F\u5360\u4F4D\u7B26\u6A21\u677F\uFF08.env.example \u4E4B\u7C7B\uFF09\u3002\u786E\u8BA4\u5B83\u5DF2\u88AB .gitignore \u8986\u76D6\u3002`
    );
  }
  if (text && /\r\n/u.test(text)) {
    hits.push(
      `\u672C\u6B21\u5199\u5165\u7684\u5185\u5BB9\u542B CRLF \u6362\u884C\uFF1A\u4ED3\u5E93\u5185\u6587\u672C\u6587\u4EF6\u4E00\u5F8B LF\u3002\u6539\u6210 LF \u518D\u5199\uFF0C\u5E76\u786E\u8BA4 .gitattributes \u91CC\u6709 \`${REQUIRED_GITATTRIBUTES_LINE}\`\u3002`
    );
  }
  if (path && /(?:^|\/)\.gitattributes$/u.test(path.replace(/\\/gu, "/")) && text && !text.includes(REQUIRED_GITATTRIBUTES_LINE)) {
    hits.push(
      `.gitattributes \u7F3A\u5C11 \`${REQUIRED_GITATTRIBUTES_LINE}\`\uFF1A\u8FD9\u4E00\u884C\u662F\u4ED3\u5E93\u89C4\u8303\u7684\u786C\u6307\u6807\uFF0C\u53EA\u6709\u522B\u7684\u5C5E\u6027\u4E0D\u7B97\u8865\u9F50\u3002`
    );
  }
  if (hits.length === 0) return;
  hintBlock(hits);
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
