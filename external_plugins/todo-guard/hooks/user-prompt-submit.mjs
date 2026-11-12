// 本文件由 scripts/build.mjs 从 external_plugins/todo-guard/src/user-prompt-submit.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/todo-guard/src/lib/hook.ts
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
  return process.env["ZCODE_PLUGIN_DATA"] ?? process.env["CLAUDE_PLUGIN_DATA"] ?? join(homedir(), ".zcode", "todo-guard");
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
function envFlag(name) {
  return process.env[name] === "1";
}
function disabled() {
  return envFlag("TODO_GUARD_DISABLE");
}

// external_plugins/todo-guard/src/lib/zcode-db.ts
import { DatabaseSync } from "node:sqlite";
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
var DB_PATH = process.env["TODO_GUARD_DB"] ?? join2(homedir2(), ".zcode", "cli", "db", "db.sqlite");
function withDb(fn, fallback) {
  try {
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      return fn(db);
    } finally {
      db.close();
    }
  } catch {
    return fallback;
  }
}
function toolCallsThisTurn(sessionId) {
  return withDb((db) => {
    const rows = db.prepare(
      `SELECT json_extract(data, '$.tool') AS tool FROM part
         WHERE session_id = :sid
           AND json_extract(data, '$.tool') IS NOT NULL
           AND time_created >= COALESCE(
             (SELECT MAX(time_created) FROM message
              WHERE session_id = :sid AND json_extract(data, '$.semantics.kind') = 'user_prompt'),
             0)`
    ).all({ sid: sessionId });
    return rows.map((r) => String(r["tool"] ?? "")).filter((t) => t !== "");
  }, null);
}
function usedToolThisTurn(sessionId, tool) {
  const calls = toolCallsThisTurn(sessionId);
  return calls === null ? true : calls.includes(tool);
}

// external_plugins/todo-guard/src/user-prompt-submit.ts
var MAX_PROMPTS_PER_SESSION = 3;
var MULTI_STEP_LENGTH = 80;
var MULTI_STEP_HINTS = /实现|新增|添加|重构|改造|迁移|修复|排查|调研|设计|规划|优化|接入|替换|升级|帮我做|做一个|写一个|整理|清理|拆分|合并/iu;
var TEMPLATE = [
  "[todo-guard] \u8FD9\u770B\u8D77\u6765\u662F\u591A\u6B65\u4EFB\u52A1\u3002\u5EFA\u8BAE\u5148\u7528 TodoWrite \u62C6\u89E3\uFF1A",
  "",
  "1. \u6BCF\u9879\u5199\u6E05\u300C\u505A\u4EC0\u4E48 + \u600E\u4E48\u7B97\u5B8C\u6210\u300D\u2014\u2014\u9A8C\u6536\u6807\u51C6\u6BD4\u52A8\u4F5C\u63CF\u8FF0\u66F4\u91CD\u8981",
  "2. \u6309\u4F9D\u8D56\u987A\u5E8F\u6392\u5217\uFF0C\u88AB\u4F9D\u8D56\u7684\u5728\u524D",
  "3. \u4E00\u6B21\u53EA\u7559\u4E00\u4E2A in_progress\uFF0C\u5176\u4F59 pending",
  "4. \u5B8C\u6210\u540E\u7ACB\u523B\u6807 completed\uFF0C\u4E0D\u8981\u6512\u5230\u6700\u540E\u4E00\u8D77\u6807"
].join("\n");
function looksMultiStep(prompt) {
  const text = prompt.trim();
  if (!text) return false;
  if (text.length >= MULTI_STEP_LENGTH) return true;
  return MULTI_STEP_HINTS.test(text);
}
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input || input.hook_event_name !== "UserPromptSubmit") return;
  if (isSubagent(input)) return;
  const sessionId = input.session_id ?? "";
  if (!sessionId) return;
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  if (!looksMultiStep(prompt)) return;
  if (usedToolThisTurn(sessionId, "TodoWrite")) return;
  const state = readState(sessionId, "prompts", { prompts: 0 });
  if (state.prompts >= MAX_PROMPTS_PER_SESSION) return;
  writeState(sessionId, "prompts", { prompts: state.prompts + 1 });
  emit("UserPromptSubmit", { additionalContext: TEMPLATE });
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
