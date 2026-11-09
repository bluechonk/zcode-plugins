// 本文件由 scripts/build.mjs 从 external_plugins/security-review/src/stop.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/security-review/src/lib/hook.ts
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
function emitStopBlock(reason) {
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}
function stateDir() {
  return process.env["ZCODE_PLUGIN_DATA"] ?? process.env["CLAUDE_PLUGIN_DATA"] ?? join(homedir(), ".zcode", "security-review");
}
function statePath(sessionId, name) {
  const safe = sessionId.replace(/[^A-Za-z0-9_.-]/g, "_") || "default";
  return join(stateDir(), `${safe}.${name}.json`);
}
function readState(sessionId, name, fallback) {
  try {
    const parsed = JSON.parse(readFileSync(statePath(sessionId, name), "utf8"));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}
function writeState(sessionId, name, value) {
  try {
    const p = statePath(sessionId, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(value), "utf8");
  } catch {
  }
}
function envInt(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}
function disabled() {
  return process.env["SECURITY_REVIEW_DISABLE"] === "1";
}

// external_plugins/security-review/src/lib/git.ts
import { spawnSync } from "node:child_process";
import { readFileSync as readFileSync2 } from "node:fs";
function git(cwd, args) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 2e4,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024
  });
  return { ok: r.status === 0, out: r.stdout ?? "" };
}
function captureBaseline(cwd) {
  const stash = git(cwd, ["stash", "create"]);
  if (stash.ok && stash.out.trim()) return stash.out.trim();
  const head = git(cwd, ["rev-parse", "HEAD"]);
  return head.ok && head.out.trim() ? head.out.trim() : null;
}
var SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|php|cs|c|h|cpp|swift|sh|bash|sql|yml|yaml|toml)$/i;
function looksLikeSource(path) {
  return SOURCE_EXT.test(path);
}
function diffSince(cwd, baseline, maxBytes) {
  const tracked = git(cwd, ["diff", "--no-color", "--unified=3", baseline]);
  const parts = [];
  let bytes = 0;
  let files = 0;
  let truncated = false;
  const push = (chunk) => {
    if (bytes >= maxBytes) {
      truncated = true;
      return;
    }
    const room = maxBytes - bytes;
    parts.push(chunk.length > room ? chunk.slice(0, room) : chunk);
    bytes += Math.min(chunk.length, room);
  };
  if (tracked.ok && tracked.out.trim()) {
    const chunks = tracked.out.split(/^diff --git /m).filter(Boolean);
    for (const chunk of chunks) {
      const header = chunk.slice(0, chunk.indexOf("\n"));
      const m = /b\/(\S+)/.exec(header);
      const path = m?.[1] ?? "";
      if (path && !looksLikeSource(path)) continue;
      push(`diff --git ${chunk}`);
      files++;
    }
  }
  const untracked = git(cwd, ["ls-files", "--others", "--exclude-standard"]);
  if (untracked.ok) {
    for (const path of untracked.out.split("\n").map((l) => l.trim()).filter(Boolean)) {
      if (!looksLikeSource(path)) continue;
      if (files >= 20) {
        truncated = true;
        break;
      }
      let body;
      try {
        body = readFileSync2(`${cwd}/${path}`, "utf8");
      } catch {
        continue;
      }
      const lines = body.split("\n").slice(0, 400);
      push(`
### \u65B0\u6587\u4EF6 ${path}
${lines.map((l) => `+${l}`).join("\n")}`);
      files++;
    }
  }
  return { text: parts.join(""), files, truncated };
}

// external_plugins/security-review/src/lib/review.ts
import { DatabaseSync } from "node:sqlite";
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
var ZCODE_DB = join2(homedir2(), ".zcode", "cli", "db", "db.sqlite");
function resolveModel(sessionId) {
  const explicit = process.env["SECURITY_REVIEW_MODEL"];
  if (explicit) return explicit;
  try {
    const db = new DatabaseSync(ZCODE_DB, { readOnly: true });
    try {
      const last = db.prepare(
        `SELECT json_extract(data,'$.modelId') AS m FROM message
           WHERE session_id = ? AND json_extract(data,'$.semantics.kind') = 'assistant_response'
           ORDER BY sequence DESC LIMIT 1`
      ).get(sessionId);
      if (last?.m) return last.m;
      const asked = db.prepare(
        `SELECT json_extract(data,'$.modelSelection.modelId') AS m FROM message
           WHERE session_id = ? AND json_extract(data,'$.semantics.kind') = 'user_prompt'
           ORDER BY sequence DESC LIMIT 1`
      ).get(sessionId);
      return asked?.m ?? null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}
var SYSTEM_PROMPT = [
  "\u4F60\u662F\u5B89\u5168\u5BA1\u67E5\u5458\uFF0C\u53EA\u505A\u53EA\u8BFB\u5206\u6790\u3002",
  "\u53EA\u62A5\u4F60\u5728\u8FD9\u6BB5 diff \u91CC\u80FD\u786E\u8BC1\u7684\u771F\u5B9E\u6F0F\u6D1E\uFF0C\u4E0D\u8981\u62A5\u98CE\u683C\u95EE\u9898\u3001\u4E0D\u8981\u62A5\u5360\u4F4D\u7B26/\u793A\u4F8B/\u6D4B\u8BD5\u5939\u5177\u3002",
  "\u62FF\u4E0D\u51C6\u5C31\u4E0D\u8981\u62A5\u2014\u2014\u8BEF\u62A5\u4F1A\u8BA9\u5F00\u53D1\u8005\u4ED8\u51FA\u6BD4\u6F0F\u62A5\u66F4\u9AD8\u7684\u4EE3\u4EF7\u3002",
  "",
  "\u53EA\u8F93\u51FA JSON\uFF0C\u4E0D\u8981\u4EFB\u4F55\u89E3\u91CA\u6587\u5B57\uFF1A",
  '{"findings":[{"severity":"high|medium|low","file":"\u8DEF\u5F84","issue":"\u95EE\u9898","fix":"\u5177\u4F53\u4FEE\u6CD5"}]}',
  '\u6CA1\u6709\u771F\u5B9E\u6F0F\u6D1E\u65F6\u8F93\u51FA {"findings":[]}\u3002'
].join("\n");
function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
function toFindings(parsed) {
  if (!parsed || typeof parsed !== "object") return [];
  const raw = parsed.findings;
  if (!Array.isArray(raw)) return [];
  return raw.filter((f) => Boolean(f) && typeof f === "object").map((f) => ({
    severity: String(f["severity"] ?? "low"),
    file: String(f["file"] ?? "?"),
    issue: String(f["issue"] ?? ""),
    fix: String(f["fix"] ?? "")
  })).filter((f) => f.issue.length > 0);
}
async function reviewDiff(opts) {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/chat/completions`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        stream: false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `\u672C\u8F6E\u6539\u52A8\u7684 git diff\uFF1A

${opts.diff}` }
        ]
      }),
      signal: AbortSignal.timeout(opts.timeoutMs)
    });
  } catch (e) {
    return { status: "transport-error", findings: [], note: e instanceof Error ? e.message : String(e) };
  }
  if (!res.ok) {
    return { status: "transport-error", findings: [], note: `HTTP ${res.status}` };
  }
  const body = await res.json().catch(() => null);
  const msg = body?.choices?.[0]?.message;
  if (!msg) return { status: "transport-error", findings: [], note: "\u54CD\u5E94\u91CC\u6CA1\u6709 choices" };
  const candidates = [msg.content ?? "", msg.reasoning_content ?? ""].filter((s) => s.trim().length > 0);
  for (const text of candidates) {
    const parsed = extractJson(text);
    if (parsed !== null) {
      const findings = toFindings(parsed);
      const note = !msg.content?.trim() && msg.reasoning_content?.trim() ? "\u7ED3\u8BBA\u53D6\u81EA reasoning_content\uFF08content \u4E3A\u7A7A\uFF09" : void 0;
      return { status: "ok", findings, ...note ? { note } : {} };
    }
  }
  return { status: "ok", findings: [], note: "\u5BA1\u67E5\u8F93\u51FA\u4E0D\u662F JSON\uFF0C\u5DF2\u5FFD\u7565" };
}

// external_plugins/security-review/src/stop.ts
var DEFAULT_BASE_URL = "http://127.0.0.1:4412/v1";
var SEVERITY_LABEL = {
  high: "\u9AD8",
  medium: "\u4E2D",
  low: "\u4F4E"
};
function formatFindings(findings) {
  const lines = [
    `[security-review] \u672C\u8F6E\u6539\u52A8\u901A\u8FC7\u5B89\u5168\u5BA1\u67E5\u53D1\u73B0 ${findings.length} \u5904\u95EE\u9898\uFF0C\u8BF7\u9010\u6761\u5224\u65AD\u5E76\u5904\u7406\uFF1A`,
    ""
  ];
  findings.forEach((f, i) => {
    lines.push(`${i + 1}. [${SEVERITY_LABEL[f.severity] ?? f.severity}] ${f.file}`);
    lines.push(`   \u95EE\u9898\uFF1A${f.issue}`);
    if (f.fix) lines.push(`   \u4FEE\u6CD5\uFF1A${f.fix}`);
  });
  lines.push("");
  lines.push("\u786E\u8BA4\u4E3A\u8BEF\u62A5\u5C31\u76F4\u63A5\u8BF4\u660E\u7406\u7531\uFF0C\u4E0D\u5FC5\u4E3A\u4E86\u6D88\u8B66\u544A\u6539\u574F\u4EE3\u7801\uFF1B\u5904\u7406\u5B8C\u518D\u6536\u5C3E\u3002");
  return lines.join("\n");
}
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input) return;
  const event = input.hook_event_name;
  if (event !== "Stop" && event !== "SubagentStop") return;
  const agent = input.agent_type ?? "";
  if (agent && agent !== "zcode-agent") return;
  const sessionId = input.session_id ?? "default";
  const base = readState(sessionId, "baseline", null);
  if (!base?.sha || !base.cwd) return;
  const diff = diffSince(base.cwd, base.sha, envInt("SECURITY_REVIEW_MAX_DIFF_BYTES", 6e4));
  if (!diff.text.trim() || diff.files === 0) return;
  const model = resolveModel(sessionId);
  if (!model) {
    return;
  }
  const outcome = await reviewDiff({
    baseUrl: process.env["SECURITY_REVIEW_BASE_URL"] ?? DEFAULT_BASE_URL,
    model,
    diff: diff.text,
    timeoutMs: envInt("SECURITY_REVIEW_TIMEOUT_MS", 12e4)
  });
  const next = captureBaseline(base.cwd);
  if (next) writeState(sessionId, "baseline", { sha: next, cwd: base.cwd, at: (/* @__PURE__ */ new Date()).toISOString() });
  if (outcome.status !== "ok" || outcome.findings.length === 0) return;
  const state = readState(sessionId, "stop", { blocks: 0 });
  if (state.blocks >= envInt("SECURITY_REVIEW_MAX_BLOCKS", 2)) return;
  writeState(sessionId, "stop", { blocks: state.blocks + 1 });
  emitStopBlock(formatFindings(outcome.findings));
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
