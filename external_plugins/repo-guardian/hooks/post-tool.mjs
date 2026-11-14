// 本文件由 scripts/build.mjs 从 external_plugins/repo-guardian/src/post-tool.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/repo-guardian/src/lib/hook.ts
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
  return process.env["ZCODE_PLUGIN_DATA"] ?? process.env["CLAUDE_PLUGIN_DATA"] ?? join(homedir(), ".zcode", "repo-guardian");
}
function statePath(sessionId) {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "_");
  return join(stateDir(), `${safe}.json`);
}
function readState(sessionId, fallback) {
  try {
    const raw = readFileSync(statePath(sessionId), "utf8");
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}
function writeState(sessionId, value) {
  try {
    let current = {};
    if (value && typeof value === "object" && !Array.isArray(value)) {
      current = readState(sessionId, {});
    }
    const p = statePath(sessionId);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ ...current, ...value }), "utf8");
  } catch {
  }
}
function envFlag(name) {
  return process.env[name] === "1";
}
function disabled() {
  return envFlag("REPO_GUARDIAN_DISABLE");
}

// external_plugins/repo-guardian/src/lib/scan.ts
var JS_LIKE = /* @__PURE__ */ new Set([
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "java",
  "go",
  "rs",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "swift",
  "kt",
  "kts",
  "scala",
  "php",
  "dart",
  "proto"
]);
var BLOCK_ONLY = /* @__PURE__ */ new Set(["css", "scss", "less"]);
var HASH_LIKE = /* @__PURE__ */ new Set([
  "py",
  "pyi",
  "sh",
  "bash",
  "zsh",
  "fish",
  "yml",
  "yaml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "properties",
  "ps1",
  "psm1",
  "rb",
  "pl",
  "pm",
  "r",
  "tf",
  "hcl",
  "gitignore",
  "gitattributes",
  "env"
]);
var HTML_LIKE = /* @__PURE__ */ new Set(["html", "htm", "xml", "svg", "vue", "md", "markdown"]);
var DASH_LIKE = /* @__PURE__ */ new Set(["sql", "lua"]);
function extOf(filePath) {
  const base = (filePath.replace(/\\/gu, "/").split("/").pop() ?? "").toLowerCase();
  return base.includes(".") ? base.split(".").pop() ?? "" : "";
}
function markersFor(filePath) {
  const base = (filePath.replace(/\\/gu, "/").split("/").pop() ?? "").toLowerCase();
  const ext = extOf(filePath);
  if (HTML_LIKE.has(ext)) return { line: [], block: [["<!--", "-->"]] };
  if (HASH_LIKE.has(ext) || base === "dockerfile" || base === "makefile") {
    return { line: [{ mark: "#", boundary: true }], block: [] };
  }
  if (DASH_LIKE.has(ext)) return { line: [{ mark: "--", boundary: true }], block: [["--[[", "]]"]] };
  if (BLOCK_ONLY.has(ext)) return { line: [], block: [["/*", "*/"]] };
  if (JS_LIKE.has(ext)) return { line: [{ mark: "//", boundary: false }], block: [["/*", "*/"]] };
  return { line: [{ mark: "//", boundary: false }], block: [["/*", "*/"]] };
}
function isBoundary(ch) {
  return ch === void 0 || /\s/u.test(ch);
}
function scan(text, filePath) {
  const { line: lineMarks, block: blockMarks } = markersFor(filePath);
  const jsLike = JS_LIKE.has(extOf(filePath));
  const comments = [];
  const strings = [];
  const newlinesUpTo = (from, to) => {
    let n = 0;
    for (let k = from; k < to; k += 1) if (text[k] === "\n") n += 1;
    return n;
  };
  let i = 0;
  let line = 1;
  if (text.startsWith("#!")) {
    const eol = text.indexOf("\n");
    i = eol === -1 ? text.length : eol;
  }
  while (i < text.length) {
    const c = text[i] ?? "";
    if (c === "\n") {
      line += 1;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const multiline = c === "`" && jsLike;
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === c) break;
        if (text[j] === "\n" && !multiline) break;
        j += 1;
      }
      const end = Math.min(j + 1, text.length);
      strings.push({ start: i, end });
      line += newlinesUpTo(i, end);
      i = end;
      continue;
    }
    const block = blockMarks.find(([open]) => text.startsWith(open, i));
    if (block) {
      const [open, close] = block;
      const found = text.indexOf(close, i + open.length);
      const bodyEnd = found === -1 ? text.length : found;
      const end = found === -1 ? text.length : found + close.length;
      comments.push({ start: i, end, bodyStart: i + open.length, bodyEnd, line, kind: "block" });
      line += newlinesUpTo(i, end);
      i = end;
      continue;
    }
    const prev = text[i - 1];
    const lm = lineMarks.find(
      (m) => text.startsWith(m.mark, i) && (!m.boundary || isBoundary(prev)) && !(m.mark === "//" && (prev === ":" || prev === "\\"))
    );
    if (lm) {
      const found = text.indexOf("\n", i);
      const end = found === -1 ? text.length : found;
      comments.push({ start: i, end, bodyStart: i + lm.mark.length, bodyEnd: end, line, kind: "line" });
      i = end;
      continue;
    }
    i += 1;
  }
  return { comments, strings };
}
function stripCommentsAndStrings(text, filePath) {
  const chars = text.split("");
  const { comments, strings } = scan(text, filePath);
  for (const r of [...comments, ...strings]) {
    for (let k = r.start; k < r.end; k += 1) {
      if (chars[k] !== "\n") chars[k] = " ";
    }
  }
  return chars.join("");
}
function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text[i] === "\n") line += 1;
  return line;
}
function shouldSkipFile(filePath) {
  const p = filePath.replace(/\\/gu, "/");
  if (/(?:^|\/)(?:node_modules|dist|build|out|coverage)\//u.test(p)) return true;
  if (/(?:^|\/)\.tmp\//u.test(p)) return true;
  if (/\.min\.(?:js|css)$/u.test(p)) return true;
  if (/(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/u.test(p)) return true;
  if (/\.(?:svg|png|jpe?g|gif|ico|woff2?|ttf|eot|pdf|zip|gz|map)$/iu.test(p)) return true;
  return false;
}
var GENERATED_BANNER = /本文件由 scripts\/build\.mjs 从/u;
function isGeneratedOrSkipped(text, filePath) {
  if (shouldSkipFile(filePath)) return true;
  return GENERATED_BANNER.test(text.slice(0, 300));
}

// external_plugins/repo-guardian/src/lib/comments.ts
var CJK = /[\u2010-\u2027\u2030-\u205e\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/u;
function decodeUnicodeEscapes(text) {
  return text.replace(/\\u([0-9a-fA-F]{4})/gu, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}
var DIRECTIVE = /^(?:@ts-(?:ignore|expect-error|nocheck)|eslint|prettier|oxlint|biome|stylelint|TODO\(|FIXME\(|@deprecated\b|\*\s*@|\/?\s*<(?:reference|amd-module)\b)/iu;
var AUTHOR = /(?:@author\b|\bauthor\s*[:：]|(?:作者|撰写|编写|审批|审核|复核|签核)\s*[:：]|\b(?:approved|reviewed|signed\s*off)\s+by\b)/iu;
var REVISION = /^(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s*)?(?:修订|修改|变更|更新|改动)\s*(?:记录|历史|日志)(?:\s*[:：].*)?$/u;
var REVISION_EN = /^(?:changelog|change\s+history|revision\s+history)\b/iu;
var DATE = /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{4}\b/u;
var CHANGE_VERB = /(?:修订|修复|新增|调整|改动|改好|补上|updated|modified|fixed|changed|revised|revamped)/iu;
var CODE_START = /^(?:const|let|var|function|class|interface|type|enum|import|export|return|throw|if|for|while|switch|try|catch|await|async|def|lambda|public|private|protected|static|void|print|console\.|echo|select|insert|update\s+set)\b/iu;
var ASSIGNMENT = /^[A-Za-z_$][\w$.]*\s*=\s*[^=]/u;
var TODO_LINE = /^(TODO|FIXME)\b(.*)$/u;
var TODO_OK = /^\s*\([^()]+\)\s*[:：]\s*\S/u;
var DEPRECATED = /@deprecated\b/u;
var REPLACEMENT = /(?:替代|改用|换成|移到|移除条件|将在|废弃|replace(?:d)?\s+(?:by|with)|use\s+\S+\s+instead|remove(?:d)?\s+in|will\s+be\s+removed)/iu;
var TS_IGNORE = /@ts-(?:ignore|expect-error)\b(.*)$/u;
var ENV_PREFIX_EXAMPLE = /^[A-Z][A-Z0-9_]*=\S*\s+\S/u;
function looksLikeCode(body) {
  const t = body.trim();
  if (!t) return false;
  if (CJK.test(t)) return false;
  if (ENV_PREFIX_EXAMPLE.test(t)) return false;
  if (CODE_START.test(t)) return true;
  if (t.includes("=>")) return true;
  if (ASSIGNMENT.test(t)) return true;
  if (/;\s*$/u.test(t) && /[=(){}[\]]/u.test(t)) return true;
  return false;
}
function looksNonChinese(body) {
  const t = decodeUnicodeEscapes(body).trim();
  if (!t) return false;
  if (CJK.test(t)) return false;
  const words = t.match(/[A-Za-z][A-Za-z'’-]{2,}/gu) ?? [];
  if (words.length < 3) return false;
  if (DIRECTIVE.test(t)) return false;
  if (/(?:copyright|spdx|licensed?\s+under|all\s+rights\s+reserved|@(?:param|returns?|type|see|link|example|throws)|https?:\/\/)/iu.test(t)) {
    return false;
  }
  if (looksLikeCode(t)) return false;
  if (/(?:注释|comment)/iu.test(t) && /(?:TODO|FIXME|deprecated|ts-ignore|署名|修订)/u.test(t)) return false;
  return true;
}
function cleanBody(raw) {
  return raw.replace(/^\s*\*+/u, "").trim();
}
var MESSAGES = {
  "author-trail": "\u6CE8\u91CA\u91CC\u5199\u4E86\u4F5C\u8005\u6216\u5BA1\u6279\u7559\u75D5\uFF1A\u7F72\u540D\u4E0E\u5BA1\u6279\u7684\u552F\u4E00\u4E8B\u5B9E\u6E90\u662F git blame\uFF0C\u6CE8\u91CA\u91CC\u4E0D\u7559\u3002",
  "revision-record": "\u6CE8\u91CA\u91CC\u5199\u4E86\u4FEE\u8BA2\u8BB0\u5F55\u6216\u6539\u52A8\u65E5\u671F\uFF1A\u4FEE\u8BA2\u5386\u53F2\u7684\u552F\u4E00\u4E8B\u5B9E\u6E90\u662F git log\uFF0C\u6CE8\u91CA\u91CC\u4E0D\u7559\u3002",
  "commented-code": "\u6CE8\u91CA\u6389\u7684\u662F\u4EE3\u7801\uFF1A\u76F4\u63A5\u5220\uFF08git \u91CC\u627E\u5F97\u56DE\uFF09\uFF0C\u786E\u5B9E\u8981\u7559\u5C31\u5199\u660E\u4FDD\u7559\u539F\u56E0\u3002",
  "todo-format": "TODO / FIXME \u683C\u5F0F\u4E0D\u5408\u89C4\uFF1A\u5E94\u4E3A `TODO(\u540D\u5B57): \u63CF\u8FF0`\uFF0C\u5E76\u5199\u6E05\u4EC0\u4E48\u6761\u4EF6\u4E0B\u6E05\u7406\u3002",
  "deprecated-no-replacement": "`@deprecated` \u6CA1\u5199\u66FF\u4EE3\u65B9\u6848\u4E0E\u79FB\u9664\u6761\u4EF6\uFF0C\u4E8C\u8005\u5FC5\u5199\u3002",
  "ts-ignore-no-reason": "`@ts-ignore` / `@ts-expect-error` \u5FC5\u987B\u540C\u884C\u5199\u660E\u7406\u7531\u3002",
  "non-chinese": "\u6CE8\u91CA\u4E0D\u662F\u4E2D\u6587\uFF1A\u89C4\u8303\u8981\u6C42\u6CE8\u91CA\u4E00\u5F8B\u4E2D\u6587\u3001\u7B80\u6D01\u3001\u4E0D\u590D\u8FF0\u4EE3\u7801\u3002",
  "empty-catch": "\u7A7A catch \u541E\u6389\u4E86\u5F02\u5E38\uFF1A\u5757\u5185\u8981\u5199\u8BF4\u660E\u6CE8\u91CA\uFF0C\u5426\u5219\u8BB0\u5F55\u65E5\u5FD7\u3001\u4E0A\u62A5\u6216\u8F6C\u6362\u540E\u91CD\u629B\u3002"
};
function commentChunks(comments) {
  const chunks = [];
  for (const r of comments) {
    const last = chunks.at(-1);
    const prev = last?.at(-1);
    const merge = last !== void 0 && prev !== void 0 && prev.kind === "line" && r.kind === "line" && r.line === prev.line + 1;
    if (merge && last) last.push(r);
    else chunks.push([r]);
  }
  return chunks;
}
function checkComments(text, filePath) {
  if (!text.trim()) return [];
  if (shouldSkipFile(filePath)) return [];
  if (GENERATED_BANNER.test(text.slice(0, 300))) return [];
  const hits = [];
  const push = (rule, line) => {
    const message = MESSAGES[rule];
    if (message) hits.push({ rule, line, message });
  };
  const { comments } = scan(text, filePath);
  for (const chunk of commentChunks(comments)) {
    const first = chunk[0];
    if (!first) continue;
    const fullBody = chunk.map((r) => text.slice(r.bodyStart, r.bodyEnd)).join("\n");
    if (DEPRECATED.test(fullBody) && !REPLACEMENT.test(fullBody)) push("deprecated-no-replacement", first.line);
    for (const r of chunk) {
      const body = text.slice(r.bodyStart, r.bodyEnd);
      body.split("\n").forEach((raw, idx) => {
        const line = r.line + idx;
        const t = cleanBody(raw);
        if (!t) return;
        const todo = TODO_LINE.exec(t);
        if (todo && !/(?:TODO|FIXME)/u.test(todo[2] ?? "") && !TODO_OK.test(todo[2] ?? "")) {
          push("todo-format", line);
          return;
        }
        const tsIgnore = TS_IGNORE.exec(t);
        if (tsIgnore && !(tsIgnore[1] ?? "").trim()) {
          push("ts-ignore-no-reason", line);
          return;
        }
        if (looksLikeCode(t)) {
          push("commented-code", line);
          return;
        }
        if (AUTHOR.test(t)) {
          push("author-trail", line);
          return;
        }
        const dated = DATE.test(t) && CHANGE_VERB.test(t);
        if (REVISION.test(t) || REVISION_EN.test(t) || dated) {
          push("revision-record", line);
          return;
        }
      });
    }
    if (!CJK.test(decodeUnicodeEscapes(fullBody)) && looksNonChinese(fullBody)) push("non-chinese", first.line);
  }
  hits.push(...findEmptyCatch(stripCommentsAndStrings(text, filePath), text));
  return hits;
}
function findEmptyCatch(stripped, original) {
  const hits = [];
  const re = /catch\s*(?:\([^)]*\))?\s*\{([^{}]*)\}/gu;
  let m = re.exec(stripped);
  while (m !== null) {
    if ((m[1] ?? "").trim() === "") {
      const bodyLen = (m[1] ?? "").length;
      const bodyStart = m.index + m[0].lastIndexOf("{") + 1;
      const body = original.slice(bodyStart, bodyStart + bodyLen);
      if (!/\/\/|\/\*/u.test(body)) {
        hits.push({ rule: "empty-catch", line: lineOf(stripped, m.index), message: MESSAGES["empty-catch"] ?? "" });
      }
    }
    m = re.exec(stripped);
  }
  return hits;
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
function filePathOf(input) {
  return typeof input["file_path"] === "string" ? input["file_path"] : "";
}

// external_plugins/repo-guardian/src/lib/code-rules.ts
var MESSAGES2 = {
  "hardcoded-path": "\u5199\u6B7B\u4E86\u7EDD\u5BF9\u8DEF\u5F84\uFF1A\u6539\u7528\u9879\u76EE\u5C01\u88C5\u7684\u8DEF\u5F84\u5DE5\u5177\uFF08paths.* / app.getPath()\uFF09\u6216\u76F8\u5BF9\u8DEF\u5F84\u62FC\u63A5\u3002"
};
var PROTOCOL = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u;
var ABSOLUTE_PATH = [
  // 盘符前面必须是串首、空白、引号或分隔符，且后面紧跟反斜杠或正斜杠
  { id: "windows-drive", pattern: /(?:^|[\s"'`(=,;])[A-Za-z]:[\\/]/u },
  // 只有「Desktop 出现在路径位置」才算：User-Agent 里的 `Loomy|Desktop|Electron`
  // 是产品标识，不是路径，按单词边界匹配会把它误报进来
  { id: "desktop", pattern: /(?:^|[\s"'`(=,;])Desktop[\\/]/u },
  { id: "posix-home", pattern: /\/(?:Users|home)\/[A-Za-z]/u },
  { id: "appdata", pattern: /(?:^|[\s"'`(=,;])AppData[\\/]/u }
];
function looksHardcodedPath(body) {
  const t = body.trim();
  if (!t) return false;
  if (PROTOCOL.test(t)) return false;
  return ABSOLUTE_PATH.some((r) => r.pattern.test(t));
}
var PATH_RULE_EXEMPT = /(?:^|\/)(?:test|tests|__tests__|fixtures?|examples?|samples?)\//u;
var PATH_TOOL_FILE = /(?:^|\/)(?:paths?|path-utils|paths\.config)\.[cm]?[jt]sx?$/u;
function isPathRuleExempt(filePath) {
  const p = filePath.replace(/\\/gu, "/");
  return PATH_RULE_EXEMPT.test(p) || PATH_TOOL_FILE.test(p);
}
function checkCode(text, filePath) {
  if (!text.trim()) return [];
  if (isGeneratedOrSkipped(text, filePath)) return [];
  const hits = [];
  const push = (rule, line) => {
    const message = MESSAGES2[rule];
    if (message) hits.push({ rule, line, message });
  };
  if (isPathRuleExempt(filePath)) return hits;
  const { strings } = scan(text, filePath);
  for (const s of strings) {
    const body = text.slice(s.start + 1, Math.max(s.start + 1, s.end - 1));
    if (looksHardcodedPath(body)) {
      push("hardcoded-path", lineOf(text, s.start));
      break;
    }
  }
  return hits;
}

// external_plugins/repo-guardian/src/post-tool.ts
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
  const hits = [...checkComments(text, path), ...checkCode(text, path)];
  if (hits.length === 0) return;
  const state = readState(sessionId, { seen: [] });
  const seen = new Set(state.seen ?? []);
  const fresh = hits.filter((h) => !seen.has(`${h.rule}	${path}`));
  if (fresh.length === 0) return;
  for (const h of fresh) seen.add(`${h.rule}	${path}`);
  writeState(sessionId, { seen: [...seen] });
  const lines = fresh.sort((a, b) => a.line - b.line).map((h) => `- \u7B2C ${h.line} \u884C\uFF1A${h.message}`);
  emit("PostToolUse", {
    additionalContext: `[repo-guardian] \u672C\u6B21\u5199\u5165\u6709 ${fresh.length} \u5904\u4E0D\u7B26\u5408\u89C4\u8303\uFF08${path}\uFF09\uFF1A
${lines.join("\n")}
\u8FD9\u662F\u98CE\u683C\u63D0\u793A\uFF0C\u4E0D\u963B\u585E\u3002\u5224\u65AD\u89C4\u5219\u4E0D\u9002\u7528\u5C31\u76F4\u63A5\u8BF4\u660E\u7406\u7531\u7EE7\u7EED\uFF0C\u4E0D\u5FC5\u4E3A\u4E86\u6D88\u63D0\u793A\u6539\u574F\u4EE3\u7801\u3002`
  });
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
