// 本文件由 scripts/build.mjs 从 external_plugins/plan-with-files/src/session-start.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/plan-with-files/src/lib/hook.ts
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
function emit(hookEventName, inner) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, ...inner } }));
}
function stateDir() {
  return process.env["ZCODE_PLUGIN_DATA"] ?? process.env["CLAUDE_PLUGIN_DATA"] ?? join(homedir(), ".zcode", "plan-with-files");
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
  return envFlag("PLAN_WITH_FILES_DISABLE") || process.env["ZCODE_PLAN_GATE"] === "off";
}

// external_plugins/plan-with-files/src/lib/zcode-db.ts
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync as readFileSync2, readdirSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
var DB_PATH = process.env["PLAN_WITH_FILES_DB"] ?? join2(homedir2(), ".zcode", "cli", "db", "db.sqlite");
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
    const candidate = join2(dir, ".zcode", "plans", name);
    if (existsSync(candidate)) return candidate;
    const parent = join2(dir, "..");
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
    const text = readFileSync2(path, "utf8");
    return { path, text, phases: extractPhases(text) };
  } catch {
    return null;
  }
}

// external_plugins/plan-with-files/src/session-start.ts
var FULL_EVERY = 5;
function short(text, n) {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= n ? one : `${one.slice(0, n)}\u2026`;
}
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input || input.hook_event_name !== "SessionStart") return;
  const sessionId = input.session_id ?? "";
  const cwd = input.cwd ?? process.cwd();
  if (!sessionId) return;
  const todos = readTodos(sessionId);
  const goal = readGoal(sessionId);
  const plan = readPlan(cwd, sessionId);
  const captured = readState(sessionId, "plan", null);
  const phases = plan?.phases ?? captured?.phases ?? [];
  if (todos.length === 0 && !goal && !plan) return;
  const state = readState(sessionId, "sessionstart", { turns: 0 });
  const turns = state.turns + 1;
  const full = turns % FULL_EVERY === 0 || turns === 1;
  writeState(sessionId, "sessionstart", { turns });
  const open = todos.filter((t) => t.status !== "completed");
  const lines = ["[plan-with-files] \u5F53\u524D\u4EFB\u52A1\u72B6\u6001\uFF08\u81EA\u52A8\u6C47\u603B\uFF0C\u975E\u6307\u4EE4\uFF09\uFF1A", ""];
  if (goal) {
    lines.push(`\u76EE\u6807\uFF1A${goal.status} \xB7 ${short(goal.objective, 80)}`);
  } else {
    lines.push("\u76EE\u6807\uFF1A\u672A\u8BBE\u7F6E");
  }
  lines.push(`\u8BA1\u5212\uFF1A${plan ? plan.path : "\u65E0\u8BA1\u5212\u6587\u4EF6"}`);
  if (todos.length > 0) {
    lines.push(
      `\u5F85\u529E\uFF1A${todos.length} \u9879\uFF0C\u672A\u5B8C\u6210 ${open.length} \u9879` + (open.length > 0 ? `\uFF08${open.slice(0, 3).map((t) => short(t.content, 24)).join(" / ")}${open.length > 3 ? " \u2026" : ""}\uFF09` : "")
    );
  } else {
    lines.push("\u5F85\u529E\uFF1A\u65E0");
  }
  if (full && phases.length > 0) {
    lines.push("", "\u8BA1\u5212\u9636\u6BB5\uFF1A");
    phases.forEach((p, i) => lines.push(`${i + 1}. ${short(p, 60)}`));
  }
  if (open.length > 0) {
    lines.push("", "\u672A\u5B8C\u6210\u9879\u4F18\u5148\uFF1B\u5DF2\u5B8C\u6210\u7684\u90E8\u5206\u4E0D\u8981\u91CD\u505A\u3002");
  }
  if (turns === 1) {
    lines.push(
      "",
      "\u89C4\u5212\u6587\u4EF6\uFF08\u9879\u76EE\u6839\uFF09\uFF1A",
      "- task_plan.md\uFF1A\u76EE\u6807 / \u4E0B\u4E00\u6B65 / \u9636\u6BB5\u72B6\u6001\uFF0C\u63D2\u4EF6\u6D3E\u751F\uFF0C\u4E0D\u8981\u624B\u6539",
      "- progress.md\uFF1A\u6D3B\u52A8\u7EBF\u4E0E\u5F85\u529E\u5FEB\u7167\uFF0C\u63D2\u4EF6\u6D3E\u751F\uFF0C\u4E0D\u8981\u624B\u6539",
      "- findings.md\uFF1A\u8C03\u7814\u7ED3\u679C\u4E0E\u6280\u672F\u51B3\u7B56\uFF0C\u7531\u4F60\u7EF4\u62A4\u2014\u2014\u8FD9\u662F\u552F\u4E00\u4E0D\u7531\u63D2\u4EF6\u751F\u6210\u7684\u6587\u4EF6\uFF0C\u6570\u636E\u5E93\u91CC\u6CA1\u6709\u8FD9\u4E9B\u4FE1\u606F\uFF0C\u4E0A\u4E0B\u6587\u538B\u7F29\u540E\u5C31\u4E22\u4E86"
    );
  }
  emit("SessionStart", { additionalContext: lines.join("\n") });
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
