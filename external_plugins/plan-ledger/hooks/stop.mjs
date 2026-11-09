// 本文件由 scripts/build.mjs 从 external_plugins/plan-ledger/src/stop.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/plan-ledger/src/lib/hook.ts
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
  return envFlag("PLAN_LEDGER_DISABLE") || process.env["ZCODE_PLAN_GATE"] === "off";
}

// external_plugins/plan-ledger/src/lib/consistency.ts
function checkConsistency(input) {
  const out = [];
  const { goal, todos, planPath, phases } = input;
  const done = todos.filter((t) => t.status === "completed").length;
  const open = todos.length - done;
  const hasTodo = todos.length > 0;
  if (goal?.status === "active" && hasTodo && open === 0) {
    out.push(
      `\u76EE\u6807\u4ECD active\uFF0C\u4F46 ${todos.length} \u9879\u5F85\u529E\u5DF2\u5168\u90E8\u5B8C\u6210\uFF1A\u786E\u8BA4\u662F\u6536\u5C3E\u8BE5\u6267\u884C \`/goal clear\`\uFF0C\u8FD8\u662F\u6F0F\u4E86\u6536\u5C3E\u6B65\u9AA4\u3002`
    );
  }
  if (goal?.status === "complete" && open > 0) {
    out.push(`\u76EE\u6807\u5DF2\u6807\u8BB0 complete\uFF0C\u4F46\u4ECD\u6709 ${open} \u9879\u5F85\u529E\u672A\u5B8C\u6210\uFF1A\u6838\u5BF9\u662F\u5F85\u529E\u8FC7\u671F\uFF0C\u8FD8\u662F\u76EE\u6807\u5224\u65E9\u4E86\u3002`);
  }
  if (goal?.status === "active" && !hasTodo) {
    out.push("\u76EE\u6807 active \u4F46\u6CA1\u6709\u4EFB\u4F55\u5F85\u529E\uFF1A\u5EFA\u8BAE\u7528 TodoWrite \u628A\u76EE\u6807\u62C6\u6210\u53EF\u52FE\u9009\u7684\u6B65\u9AA4\u3002");
  }
  if (planPath && !hasTodo && phases.length > 0) {
    out.push(`\u6709\u8BA1\u5212\uFF08${phases.length} \u4E2A\u9636\u6BB5\uFF09\u4F46\u6CA1\u6709\u4EFB\u4F55\u5F85\u529E\uFF1A\u8BA1\u5212\u672A\u843D\u5230\u53EF\u6267\u884C\u7C92\u5EA6\u3002`);
  }
  if (phases.length >= 5 && todos.length <= 1) {
    out.push(
      `\u8BA1\u5212\u6709 ${phases.length} \u4E2A\u9636\u6BB5\uFF0C\u5F85\u529E\u5374\u53EA\u6709 ${todos.length} \u9879\uFF1A\u7C92\u5EA6\u4E0D\u5339\u914D\uFF0C\u628A\u5F85\u529E\u62C6\u5230\u4E0E\u9636\u6BB5\u5BF9\u5E94\u7684\u7C92\u5EA6\u3002`
    );
  }
  const STALE_TODO_MS = 2 * 60 * 60 * 1e3;
  if (goal?.status === "active" && todos.length > 0) {
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

// external_plugins/plan-ledger/src/lib/zcode-db.ts
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var DB_PATH = join(homedir(), ".zcode", "cli", "db", "db.sqlite");
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
function findPlanFile(cwd, sessionId) {
  const name = `plan-${sessionId.replace(/[^A-Za-z0-9._-]/g, "-")}.md`;
  let dir = cwd;
  for (let depth = 0; depth < 6; depth++) {
    const candidate = join(dir, ".zcode", "plans", name);
    if (existsSync(candidate)) return candidate;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
var NON_STEP_HEADINGS = /^(context|背景|目标|验证|测试|交付|风险|回滚|备注|附录|summary|verification|delivery)/i;
function extractPhases(planText) {
  const out = [];
  for (const line of planText.split("\n")) {
    const m = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const level = m[1].length;
    const title = m[2].trim();
    if (!title || NON_STEP_HEADINGS.test(title)) continue;
    if (level === 3 || /方案|阶段|实施|步骤/.test(title)) out.push(title);
    if (out.length >= 12) break;
  }
  return out;
}
function readPlan(cwd, sessionId) {
  const path = findPlanFile(cwd, sessionId);
  if (!path) return null;
  try {
    const text = readFileSync(path, "utf8");
    return { path, text, phases: extractPhases(text) };
  } catch {
    return null;
  }
}

// external_plugins/plan-ledger/src/stop.ts
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input) return;
  const event = input.hook_event_name;
  if (event !== "Stop" && event !== "SubagentStop") return;
  if (isSubagent(input)) return;
  const sessionId = input.session_id ?? "";
  const cwd = input.cwd ?? process.cwd();
  if (!sessionId) return;
  const todos = readTodos(sessionId);
  const goal = readGoal(sessionId);
  const plan = readPlan(cwd, sessionId);
  const issues = checkConsistency({
    goal,
    todos,
    planPath: plan?.path ?? null,
    phases: plan?.phases ?? []
  });
  if (issues.length === 0) return;
  emit("Stop", {
    additionalContext: ["[plan-ledger] \u8BA1\u5212 / \u76EE\u6807 / \u5F85\u529E\u4E4B\u95F4\u5B58\u5728\u4E0D\u4E00\u81F4\uFF1A", "", ...issues].join("\n")
  });
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
