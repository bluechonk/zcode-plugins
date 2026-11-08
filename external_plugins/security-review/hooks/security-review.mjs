// 本文件由 scripts/build.mjs 从 external_plugins/security-review/src/index.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/security-review/src/index.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var RULES = [
  {
    id: "hardcoded-secret",
    what: "\u7591\u4F3C\u628A\u5BC6\u94A5/\u53E3\u4EE4\u5199\u6210\u5B57\u9762\u91CF",
    fix: "\u6539\u4ECE\u73AF\u5883\u53D8\u91CF\u6216\u5BC6\u94A5\u7BA1\u7406\u8BFB\u53D6\uFF0C\u4E0D\u8981\u5165\u5E93",
    pattern: /\b(api[_-]?key|secret|token|password|passwd|credential)\b\s*[:=]\s*["'`][^"'`\s]{12,}["'`]/i
  },
  {
    id: "aws-access-key",
    what: "\u7591\u4F3C AWS Access Key ID",
    fix: "\u64A4\u9500\u8BE5\u5BC6\u94A5\u5E76\u6539\u7528\u4E34\u65F6\u51ED\u636E",
    pattern: /\bAKIA[0-9A-Z]{16}\b/
  },
  {
    id: "private-key",
    what: "\u79C1\u94A5\u5185\u5BB9\u88AB\u5199\u8FDB\u4EE3\u7801",
    fix: "\u79C1\u94A5\u8D70\u5BC6\u94A5\u7BA1\u7406\u670D\u52A1\uFF0C\u7EDD\u4E0D\u80FD\u5165\u5E93",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/
  },
  {
    id: "sql-concat",
    what: "SQL \u8BED\u53E5\u7528\u5B57\u7B26\u4E32\u62FC\u63A5\u6784\u9020",
    fix: "\u6539\u7528\u53C2\u6570\u5316\u67E5\u8BE2\uFF08\u5360\u4F4D\u7B26 + \u7ED1\u5B9A\u53C2\u6570\uFF09",
    // 中段允许引号：真实写法是 `"... WHERE id = " + userId`，闭合引号在 + 之前，
    // 若把引号排除出字符类就永远匹配不到
    pattern: /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[^\n;]{0,200}?(\+\s*[A-Za-z_$]|\$\{|%s|\.format\s*\()/i
  },
  {
    id: "command-injection",
    what: "shell \u547D\u4EE4\u7528\u62FC\u63A5/\u63D2\u503C\u6784\u9020",
    fix: "\u6539\u7528\u6570\u7EC4\u5F62\u5F0F\u4F20\u53C2\uFF08execFile/spawn \u7684 args\uFF09\uFF0C\u4E0D\u8981\u8FC7 shell",
    pattern: /\b(exec|execSync|system|popen)\s*\(\s*[^)]*(\+\s*[A-Za-z_$]|\$\{|f")/
  },
  {
    id: "path-from-request",
    what: "\u6587\u4EF6\u8DEF\u5F84\u76F4\u63A5\u53D6\u81EA\u8BF7\u6C42\u53C2\u6570",
    fix: "\u505A\u767D\u540D\u5355\u6216\u89C4\u8303\u5316\u540E\u6821\u9A8C\u524D\u7F00\uFF0C\u62D2\u7EDD ../ \u4E0E\u7EDD\u5BF9\u8DEF\u5F84",
    pattern: /\b(readFile|writeFile|createReadStream|createWriteStream|sendFile|unlink)\s*\([^)]*\b(req|request|ctx|params|query|body)\b/
  },
  {
    id: "dynamic-code",
    what: "\u52A8\u6001\u6267\u884C\u4EE3\u7801",
    fix: "\u6539\u6210\u663E\u5F0F\u5206\u652F\u6216\u89E3\u6790\u5668\uFF0C\u4E0D\u8981 eval / new Function",
    pattern: /\beval\s*\(|\bnew\s+Function\s*\(/
  },
  {
    id: "tls-verify-off",
    what: "\u5173\u95ED\u4E86 TLS \u8BC1\u4E66\u6821\u9A8C",
    fix: "\u6539\u56DE\u6821\u9A8C\uFF1B\u786E\u9700\u81EA\u7B7E\u8BC1\u4E66\u5C31\u628A\u8BE5\u8BC1\u4E66\u52A0\u8FDB\u4FE1\u4EFB\u94FE",
    pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0/
  },
  {
    id: "xss-html",
    what: "\u628A\u672A\u8F6C\u4E49\u5185\u5BB9\u585E\u8FDB HTML",
    fix: "\u6539\u7528\u6587\u672C\u8282\u70B9\uFF0C\u6216\u5148\u7ECF\u767D\u540D\u5355\u51C0\u5316",
    pattern: /\.innerHTML\s*=|dangerouslySetInnerHTML/
  },
  {
    id: "weak-hash",
    what: "\u53E3\u4EE4/\u7B7E\u540D\u573A\u666F\u4F7F\u7528\u4E86\u5F31\u54C8\u5E0C",
    fix: "\u53E3\u4EE4\u7528 bcrypt/scrypt/argon2\uFF1B\u5B8C\u6574\u6027\u6821\u9A8C\u7528 sha256 \u8D77\u6B65",
    pattern: /createHash\s*\(\s*["'`](md5|sha1)["'`]/i
  },
  {
    id: "insecure-random",
    what: "\u7591\u4F3C\u7528 Math.random \u751F\u6210\u5B89\u5168\u76F8\u5173\u503C",
    fix: "\u6539\u7528 crypto.randomUUID / randomBytes",
    pattern: /\b(secret|token|salt|nonce|session[_-]?id|api[_-]?key)\w*\s*[:=]\s*[^;\n]*Math\.random\s*\(/i
  },
  {
    id: "cors-wildcard",
    what: "CORS \u5141\u8BB8\u4EFB\u610F\u6765\u6E90",
    fix: "\u6539\u4E3A\u767D\u540D\u5355\u6765\u6E90\uFF0C\u6216\u660E\u786E\u8BF4\u660E\u4E3A\u4F55\u9700\u8981\u653E\u5F00",
    pattern: /(Access-Control-Allow-Origin["'`]?\s*[:,]\s*["'`]\*|origin\s*:\s*["'`]\*["'`])/i
  }
];
var MAX_WARNINGS = 5;
var MAX_SCAN_BYTES = 2e5;
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
function statePath(sessionId) {
  const dir = process.env["ZCODE_PLUGIN_DATA"] ?? process.env["CLAUDE_PLUGIN_DATA"] ?? join(homedir(), ".zcode", "security-review");
  return join(dir, `${sessionId.replace(/[^A-Za-z0-9_.-]/g, "_")}.json`);
}
function loadShown(sessionId) {
  try {
    const raw = readFileSync(statePath(sessionId), "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter((v) => typeof v === "string"));
  } catch {
  }
  return /* @__PURE__ */ new Set();
}
function saveShown(sessionId, shown) {
  try {
    const p = statePath(sessionId);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, JSON.stringify([...shown]), "utf8");
  } catch {
  }
}
function emitAdditionalContext(text) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } })
  );
}
async function main() {
  const raw = await readStdin();
  if (!raw.trim()) return;
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }
  if (input.hook_event_name !== "PostToolUse") return;
  const tool = input.tool_name ?? "";
  if (tool !== "Edit" && tool !== "Write" && tool !== "MultiEdit") return;
  const toolInput = input.tool_input ?? {};
  const text = addedText(tool, toolInput);
  if (!text || text.length > MAX_SCAN_BYTES) return;
  const file = typeof toolInput["file_path"] === "string" ? toolInput["file_path"] : "(\u672A\u77E5\u6587\u4EF6)";
  const sessionId = input.session_id ?? "default";
  const shown = loadShown(sessionId);
  const hits = [];
  for (const rule of RULES) {
    if (!rule.pattern.test(text)) continue;
    const digest = `${rule.id}@${file}`;
    if (shown.has(digest)) continue;
    hits.push({ rule, digest });
    if (hits.length >= MAX_WARNINGS) break;
  }
  if (hits.length === 0) return;
  for (const h of hits) shown.add(h.digest);
  saveShown(sessionId, shown);
  const lines = [
    `[security-review] \u672C\u6B21\u6539\u52A8\u547D\u4E2D ${hits.length} \u6761\u5B89\u5168\u89C4\u5219\uFF0C\u8BF7\u5224\u65AD\u662F\u5426\u6210\u7ACB\u5E76\u5904\u7406\uFF1A`,
    ""
  ];
  for (const [i, h] of hits.entries()) {
    lines.push(`${i + 1}. ${h.rule.what}\uFF08\u89C4\u5219 ${h.rule.id}\uFF0C\u6587\u4EF6 ${file}\uFF09`);
    lines.push(`   \u4FEE\u6CD5\uFF1A${h.rule.fix}`);
  }
  lines.push("", "\u8BEF\u62A5\u5C31\u76F4\u63A5\u8BF4\u660E\u7406\u7531\u5E76\u7EE7\u7EED\uFF0C\u4E0D\u5FC5\u4E3A\u4E86\u6D88\u8B66\u544A\u6539\u574F\u4EE3\u7801\u3002");
  emitAdditionalContext(lines.join("\n"));
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
export {
  MAX_WARNINGS,
  RULES,
  addedText
};
