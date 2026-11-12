// 本文件由 scripts/build.mjs 从 external_plugins/todo-guard/src/pre-tool.ts 生成。
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

// external_plugins/todo-guard/src/lib/todo-discipline.ts
function parseTodos(toolInput) {
  const raw = toolInput["todos"];
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const rec = item;
    const content = typeof rec["content"] === "string" ? rec["content"] : "";
    if (!content) return null;
    out.push({ content, status: typeof rec["status"] === "string" ? rec["status"] : "pending" });
  }
  return out;
}
function droppedOpenTodos(input) {
  const { previous, next, readFirst } = input;
  if (readFirst) return [];
  if (next === null) return [];
  if (previous.length === 0) return [];
  const kept = new Set(next.map((t) => t.content));
  return previous.filter((t) => t.status !== "completed" && !kept.has(t.content)).map((t) => t.content);
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
function readTodos(sessionId) {
  return withDb((db) => {
    const rows = db.prepare(
      `SELECT content, status, priority, position, time_updated FROM todo
         WHERE session_id = ? ORDER BY position ASC`
    ).all(sessionId);
    return rows.map((r) => ({
      content: String(r["content"] ?? ""),
      status: String(r["status"] ?? "pending"),
      priority: String(r["priority"] ?? "medium"),
      position: Number(r["position"] ?? 0),
      timeUpdated: Number(r["time_updated"] ?? 0)
    }));
  }, []);
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

// external_plugins/todo-guard/src/pre-tool.ts
var GENERIC_TITLE = /^#{1,3}\s+(context|背景|概述|概要|说明)\s*$/iu;
function genericTitleOf(plan) {
  for (const line of plan.split("\n")) {
    const m = /^(#{1,3})\s+(.+?)\s*$/u.exec(line);
    if (!m) continue;
    return GENERIC_TITLE.test(line) ? m[2] : null;
  }
  return null;
}
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input || input.hook_event_name !== "PreToolUse") return;
  if (isSubagent(input)) return;
  const sessionId = input.session_id ?? "";
  if (!sessionId) return;
  const tool = input.tool_name ?? "";
  const toolInput = input.tool_input ?? {};
  if (tool === "TodoWrite") {
    const dropped = droppedOpenTodos({
      previous: readTodos(sessionId),
      next: parseTodos(toolInput),
      readFirst: usedToolThisTurn(sessionId, "TodoRead")
    });
    if (dropped.length === 0) return;
    const signature = dropped.join("|");
    const state = readState(sessionId, "discipline", {});
    if (state.lastDropSignature === signature) return;
    writeState(sessionId, "discipline", { ...state, lastDropSignature: signature });
    emit("PreToolUse", {
      additionalContext: `[todo-guard] \u672C\u6B21 TodoWrite \u4F1A\u8BA9 ${dropped.length} \u9879\u672A\u5B8C\u6210\u5F85\u529E\u4ECE\u6E05\u5355\u91CC\u6D88\u5931\uFF1A
` + dropped.map((c) => `- ${c}`).join("\n") + "\nTodoWrite \u662F\u6574\u4EFD\u66FF\u6362\uFF0C\u4E0D\u662F\u589E\u91CF\u3002\u786E\u5B9E\u505A\u5B8C\u4E86\u5C31\u6807 completed \u800C\u4E0D\u662F\u5220\u6389\uFF1B\u53EA\u662F\u6CA1\u60F3\u8D77\u6765\u7684\u8BDD\uFF0C\u5148 TodoRead \u53D6\u56DE\u5B8C\u6574\u6E05\u5355\u518D\u6539\u3002"
    });
    return;
  }
  if (tool !== "ExitPlanMode") return;
  const plan = typeof toolInput["plan"] === "string" ? toolInput["plan"] : "";
  if (!plan) return;
  const generic = genericTitleOf(plan);
  if (!generic) return;
  emit("PreToolUse", {
    additionalContext: `[todo-guard] \u8BA1\u5212\u6807\u9898\u300C${generic}\u300D\u592A\u901A\u7528\uFF1AZCode \u4FA7\u8FB9\u680F\u7528\u7B2C\u4E00\u4E2A\u6807\u9898\u5F53\u8BA1\u5212\u540D\uFF0C\u591A\u6B21\u89C4\u5212\u540E\u4F1A\u5168\u663E\u793A\u6210\u540C\u4E00\u4E2A\u8BCD\uFF0C\u5206\u4E0D\u6E05\u54EA\u4EFD\u662F\u54EA\u4EFD\u3002\u6539\u6210\u5E26\u4E3B\u9898\u7684\u5199\u6CD5\uFF0C\u4F8B\u5982 \`## Context\uFF1A<\u8FD9\u6B21\u8981\u505A\u4EC0\u4E48>\`\u3002`
  });
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
