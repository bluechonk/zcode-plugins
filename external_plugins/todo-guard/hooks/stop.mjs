// 本文件由 scripts/build.mjs 从 external_plugins/todo-guard/src/stop.ts 生成。
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

// external_plugins/todo-guard/src/lib/consistency.ts
var STALE_TODO_MS = 2 * 60 * 60 * 1e3;
function checkConsistency(input) {
  const out = [];
  const { goal, todos } = input;
  if (!goal) return out;
  const done = todos.filter((t) => t.status === "completed").length;
  const open = todos.length - done;
  const hasTodo = todos.length > 0;
  if (goal.status === "active" && hasTodo && open === 0) {
    out.push(
      `\u76EE\u6807\u4ECD active\uFF0C\u4F46 ${todos.length} \u9879\u5F85\u529E\u5DF2\u5168\u90E8\u5B8C\u6210\uFF1A\u786E\u8BA4\u662F\u6536\u5C3E\u8BE5\u6267\u884C \`/goal clear\`\uFF0C\u8FD8\u662F\u6F0F\u4E86\u6536\u5C3E\u6B65\u9AA4\u3002`
    );
  }
  if (goal.status === "complete" && open > 0) {
    out.push(`\u76EE\u6807\u5DF2\u6807\u8BB0 complete\uFF0C\u4F46\u4ECD\u6709 ${open} \u9879\u5F85\u529E\u672A\u5B8C\u6210\uFF1A\u6838\u5BF9\u662F\u5F85\u529E\u8FC7\u671F\uFF0C\u8FD8\u662F\u76EE\u6807\u5224\u65E9\u4E86\u3002`);
  }
  if (goal.status === "active" && !hasTodo) {
    out.push("\u76EE\u6807 active \u4F46\u6CA1\u6709\u4EFB\u4F55\u5F85\u529E\uFF1A\u5EFA\u8BAE\u7528 TodoWrite \u628A\u76EE\u6807\u62C6\u6210\u53EF\u52FE\u9009\u7684\u6B65\u9AA4\u3002");
  }
  if (goal.status === "active" && hasTodo) {
    const newest = Math.max(...todos.map((t) => t.timeUpdated));
    if (newest > 0 && Date.now() - newest > STALE_TODO_MS) {
      const hours = Math.round((Date.now() - newest) / 36e5);
      out.push(
        `\u76EE\u6807\u4ECD active\uFF0C\u4F46\u5F85\u529E\u5DF2 ${hours} \u5C0F\u65F6\u672A\u66F4\u65B0\uFF1A\u786E\u8BA4\u662F\u6F0F\u4E86\u66F4\u65B0\uFF0C\u8FD8\u662F\u4EFB\u52A1\u5DF2\u5B9E\u9645\u5B8C\u6210\u8BE5\u6267\u884C \`/goal clear\`\u3002`
      );
    }
  }
  return out;
}

// external_plugins/todo-guard/src/lib/todo-discipline.ts
function looksUndecomposed(input) {
  const { allTodos, turnToolCalls, minToolCalls, todoWriteSeen } = input;
  if (todoWriteSeen) return false;
  if (allTodos.length > 0) return false;
  return turnToolCalls.length >= minToolCalls;
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
function readGoal(sessionId) {
  return withDb((db) => {
    const row = db.prepare(
      `SELECT objective, status, tokens_used, time_used_seconds, summary_title
         FROM session_target WHERE session_id = ?`
    ).get(sessionId);
    if (!row) return null;
    return {
      objective: String(row["objective"] ?? ""),
      status: String(row["status"] ?? ""),
      tokensUsed: Number(row["tokens_used"] ?? 0),
      timeUsedSeconds: Number(row["time_used_seconds"] ?? 0),
      summaryTitle: row["summary_title"] == null ? null : String(row["summary_title"])
    };
  }, null);
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

// external_plugins/todo-guard/src/stop.ts
var MIN_TOOL_CALLS = 6;
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input) return;
  const event = input.hook_event_name;
  if (event !== "Stop" && event !== "SubagentStop") return;
  if (isSubagent(input)) return;
  const sessionId = input.session_id ?? "";
  if (!sessionId) return;
  const todos = readTodos(sessionId);
  const goal = readGoal(sessionId);
  const issues = checkConsistency({ goal, todos });
  const state = readState(sessionId, "discipline", {});
  const calls = toolCallsThisTurn(sessionId);
  const undecomposed = !state.nudgedUndecomposed && calls !== null && looksUndecomposed({
    allTodos: todos,
    turnToolCalls: calls,
    minToolCalls: MIN_TOOL_CALLS,
    todoWriteSeen: calls.includes("TodoWrite")
  });
  if (issues.length === 0 && !undecomposed) return;
  const lines = [];
  if (issues.length > 0) {
    lines.push("[todo-guard] \u76EE\u6807 / \u5F85\u529E\u4E4B\u95F4\u5B58\u5728\u4E0D\u4E00\u81F4\uFF1A", "", ...issues);
  }
  if (undecomposed) {
    if (lines.length > 0) lines.push("");
    lines.push(
      `[todo-guard] \u672C\u8F6E\u8C03\u4E86 ${calls?.length ?? 0} \u6B21\u5DE5\u5177\uFF0C\u4F46\u4F1A\u8BDD\u81F3\u4ECA\u6CA1\u6709\u5F85\u529E\u3002\u591A\u6B65\u4EFB\u52A1\u5EFA\u8BAE\u5148\u7528 TodoWrite \u62C6\u89E3\uFF1A\u4E00\u6B21\u53EA\u7559\u4E00\u4E2A in_progress\uFF0C\u5B8C\u6210\u540E\u7ACB\u523B\u6807 completed\u3002`
    );
    writeState(sessionId, "discipline", { ...state, nudgedUndecomposed: true });
  }
  emit("Stop", { additionalContext: lines.join("\n") });
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
