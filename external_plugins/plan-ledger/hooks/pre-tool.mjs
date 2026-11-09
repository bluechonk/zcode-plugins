// 本文件由 scripts/build.mjs 从 external_plugins/plan-ledger/src/pre-tool.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/plan-ledger/src/pre-tool.ts
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";
import { homedir as homedir3 } from "node:os";
import { join as join3 } from "node:path";

// external_plugins/plan-ledger/src/lib/hook.ts
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
function inPlanMode(input) {
  return (input.permission_mode ?? input.mode ?? "") === "plan";
}
function isSubagent(input) {
  const agent = input.agent_type ?? "";
  return agent !== "" && agent !== "zcode-agent";
}
function emit(hookEventName, inner) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, ...inner } }));
}
function stateDir() {
  return process.env["ZCODE_PLUGIN_DATA"] ?? process.env["CLAUDE_PLUGIN_DATA"] ?? join(homedir(), ".zcode", "plan-ledger");
}
function statePath(sessionId, name) {
  const safe = sessionId.replace(/[^A-Za-z0-9_.-]/g, "_") || "default";
  return join(stateDir(), `${safe}.${name}.json`);
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
  return envFlag("PLAN_LEDGER_DISABLE") || process.env["ZCODE_PLAN_GATE"] === "off";
}

// external_plugins/plan-ledger/src/lib/zcode-db.ts
import { DatabaseSync } from "node:sqlite";
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
var DB_PATH = join2(homedir2(), ".zcode", "cli", "db", "db.sqlite");
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

// external_plugins/plan-ledger/src/pre-tool.ts
var DB_PATH2 = join3(homedir3(), ".zcode", "cli", "db", "db.sqlite");
var ALWAYS_ALLOW = /* @__PURE__ */ new Set([
  "TodoWrite",
  "TodoRead",
  "Read",
  "Grep",
  "Glob",
  "Bash",
  "WebSearch",
  "WebFetch",
  "ListModels",
  "AskUserQuestion",
  "Skill",
  "ToolSearch",
  "TaskOutput",
  "TaskStop",
  "SendMessage",
  "EnterPlanMode",
  "ExitPlanMode",
  "DeferredToolCall"
]);
var NUDGE_AFTER = 25;
var DENY_REASON = "\u672C\u8F6E\u5C1A\u672A\u89C4\u5212\uFF1A\u81EA\u4E0A\u6B21\u7528\u6237\u63D0\u95EE\u4EE5\u6765\u6CA1\u6709 TodoWrite \u8BB0\u5F55\u3002\u8BF7\u5148\u8C03\u7528 TodoWrite \u5199\u4E0B\u4EFB\u52A1\u62C6\u89E3\uFF08\u6B65\u9AA4\u3001\u987A\u5E8F\u3001\u9A8C\u6536\u6807\u51C6\uFF09\uFF0C\u518D\u6267\u884C\u8BE5\u5DE5\u5177\u3002\u89C4\u5212\u524D\u53EF\u5148\u7528\u53EA\u8BFB\u5DE5\u5177\u4E0E Bash \u6478\u73B0\u72B6\uFF0C\u4F46\u6539\u4EE3\u7801\u7C7B\u52A8\u4F5C\u8981\u5148\u6709\u89C4\u5212\u3002";
var PLAN_QUERY = `
SELECT
  EXISTS(
    SELECT 1 FROM part
    WHERE session_id = ?
      AND json_extract(data, '$.tool') = 'TodoWrite'
      AND time_created >= COALESCE(
        (SELECT MAX(time_created) FROM message
         WHERE session_id = ? AND json_extract(data, '$.semantics.kind') = 'user_prompt'),
        0)
  ) AS planned,
  (
    SELECT COUNT(*) FROM part
    WHERE session_id = ?
      AND json_extract(data, '$.type') = 'tool'
      AND time_created > COALESCE(
        (SELECT MAX(time_created) FROM part
         WHERE session_id = ? AND json_extract(data, '$.tool') = 'TodoWrite'),
        0)
  ) AS calls_since_todo
`;
function readPlanState(sessionId) {
  try {
    const db = new DatabaseSync2(DB_PATH2, { readOnly: true });
    try {
      const row = db.prepare(PLAN_QUERY).get(sessionId, sessionId, sessionId, sessionId);
      return {
        planned: Boolean(row?.planned),
        calls: Number(row?.calls_since_todo ?? 0)
      };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input || input.hook_event_name !== "PreToolUse") return;
  if (isSubagent(input)) return;
  const sessionId = input.session_id ?? "";
  const tool = input.tool_name ?? "";
  if (!sessionId) return;
  if (tool === "ExitPlanMode") {
    const plan = input.tool_input?.["plan"];
    if (typeof plan === "string" && plan.trim()) {
      const phases = plan.split("\n").map((l) => /^#{2,3}\s+(.+?)\s*$/.exec(l)?.[1]).filter((x) => Boolean(x)).slice(0, 12);
      writeState(sessionId, "plan", {
        capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
        phases,
        bytes: plan.length
      });
    }
    return;
  }
  if (!tool || ALWAYS_ALLOW.has(tool)) return;
  if (inPlanMode(input)) return;
  const goal = readGoal(sessionId);
  if (goal?.status === "active") return;
  const state = readPlanState(sessionId);
  if (!state) return;
  if (!state.planned) {
    emit("PreToolUse", {
      permissionDecision: "deny",
      permissionDecisionReason: DENY_REASON
    });
    return;
  }
  if (state.calls >= NUDGE_AFTER) {
    emit("PreToolUse", {
      additionalContext: `\u8FDB\u5EA6\u63D0\u9192\uFF1A\u8DDD\u4E0A\u6B21 TodoWrite \u5DF2\u6267\u884C ${state.calls} \u6B21\u5DE5\u5177\u8C03\u7528\uFF0C\u5F85\u529E\u6E05\u5355\u53EF\u80FD\u5DF2\u8FC7\u65F6\u3002\u8BF7\u7528 TodoWrite \u66F4\u65B0\u8FDB\u5EA6\uFF08\u5B8C\u6210\u9879\u6807 completed\uFF0C\u8FDB\u884C\u4E2D\u9879\u6807 in_progress\uFF09\u3002`
    });
  }
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
