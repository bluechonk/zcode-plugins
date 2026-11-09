// 本文件由 scripts/build.mjs 从 external_plugins/plan-with-files/src/post-tool.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/plan-with-files/src/post-tool.ts
import { join as join4 } from "node:path";

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
function isSubagent(input) {
  const agent = input.agent_type ?? "";
  return agent !== "" && agent !== "zcode-agent";
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

// external_plugins/plan-with-files/src/lib/consistency.ts
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

// external_plugins/plan-with-files/src/lib/ledger.ts
import { mkdirSync as mkdirSync2, readdirSync, rmSync, statSync, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
var MAX_ACTIVITY_LINES = 15;
var MAX_LEDGERS = 200;
var STATUS_MARK = {
  completed: "x",
  in_progress: ">",
  pending: " "
};
function short(text, n) {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= n ? one : `${one.slice(0, n)}\u2026`;
}
function renderLedger(input) {
  const { todos } = input;
  const done = todos.filter((t) => t.status === "completed").length;
  const doing = todos.filter((t) => t.status === "in_progress").length;
  const todo = todos.filter((t) => t.status === "pending").length;
  const now = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").slice(0, 16);
  const lines = ["# \u8BA1\u5212\u8FDB\u5EA6", ""];
  lines.push(`- \u4F1A\u8BDD: ${input.sessionId}`);
  lines.push(`- \u8BA1\u5212: ${input.planPath ?? "\uFF08\u672C\u4F1A\u8BDD\u6CA1\u6709\u8BA1\u5212\u6587\u4EF6\uFF09"}`);
  if (input.goal) {
    const g = input.goal;
    lines.push(
      `- \u76EE\u6807: ${g.status} \xB7 ${short(g.objective, 60)} \xB7 \u5DF2\u7528 ${g.tokensUsed.toLocaleString("en-US")} tokens`
    );
  } else {
    lines.push("- \u76EE\u6807: \u65E0\uFF08\u672A\u8BBE\u7F6E /goal\uFF09");
  }
  lines.push(`- \u66F4\u65B0: ${now}`, "");
  lines.push("## \u5F53\u524D\u5F85\u529E", "");
  if (todos.length === 0) {
    lines.push("- \uFF08\u672C\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u5F85\u529E\uFF09");
  } else {
    for (const t of todos) {
      lines.push(`- [${STATUS_MARK[t.status] ?? " "}] ${t.content}`);
    }
    lines.push("", `\u7EDF\u8BA1\uFF1A${todos.length} \u9879 \xB7 \u5B8C\u6210 ${done} \xB7 \u8FDB\u884C\u4E2D ${doing} \xB7 \u672A\u5F00\u59CB ${todo}`);
  }
  lines.push("");
  lines.push("## \u8BA1\u5212\u9636\u6BB5", "");
  if (input.phases.length === 0) {
    lines.push("- \uFF08\u65E0\u8BA1\u5212\u6587\u4EF6\u6216\u672A\u63D0\u53D6\u5230\u9636\u6BB5\u6807\u9898\uFF09");
  } else {
    input.phases.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
  }
  lines.push("", "> \u9636\u6BB5\u4EC5\u4F5C\u5BFC\u822A\uFF1B\u5B8C\u6210\u5EA6\u4EE5\u300C\u5F53\u524D\u5F85\u529E\u300D\u4E3A\u51C6\uFF0C\u76EE\u6807\u5C42\u4EE5 /goal \u4E3A\u51C6\u3002", "");
  if (input.consistency.length > 0) {
    lines.push("## \u4E00\u81F4\u6027", "");
    for (const c of input.consistency) lines.push(`- ${c}`);
    lines.push("");
  }
  if (input.events.length > 0) {
    lines.push("## \u6D3B\u52A8\u7EBF", "", "| \u65F6\u95F4 | \u4E8B\u4EF6 | \u53D8\u5316 |", "| --- | --- | --- |");
    for (const e of input.events.slice(-MAX_ACTIVITY_LINES)) {
      lines.push(`| ${e.at} | ${e.event} | ${e.detail} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
function ledgerPath(cwd, sessionId, planPath) {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "_");
  if (planPath) return join2(planPath, "..", `progress-${safe}.md`);
  return join2(cwd, ".zcode", "plans", `progress-${safe}.md`);
}
function writeLedger(path, content) {
  try {
    mkdirSync2(join2(path, ".."), { recursive: true });
    writeFileSync2(path, content, "utf8");
  } catch {
  }
}
function pruneLedgers(plansDir, max = MAX_LEDGERS) {
  try {
    const stale = readdirSync(plansDir).filter((f) => /^progress-.+\.md$/u.test(f)).map((f) => {
      const p = join2(plansDir, f);
      return { p, mtime: statSync(p).mtimeMs };
    }).sort((a, b) => b.mtime - a.mtime).slice(max);
    for (const { p } of stale) rmSync(p, { force: true });
  } catch {
  }
}

// external_plugins/plan-with-files/src/lib/zcode-db.ts
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync as readFileSync3, readdirSync as readdirSync2 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join3 } from "node:path";
var DB_PATH = join3(homedir2(), ".zcode", "cli", "db", "db.sqlite");
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
    const candidate = join3(dir, ".zcode", "plans", name);
    if (existsSync(candidate)) return candidate;
    const parent = join3(dir, "..");
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
    const text = readFileSync3(path, "utf8");
    return { path, text, phases: extractPhases(text) };
  } catch {
    return null;
  }
}

// external_plugins/plan-with-files/src/post-tool.ts
function stamp() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(11, 16);
}
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input || input.hook_event_name !== "PostToolUse") return;
  if (isSubagent(input)) return;
  const tool = input.tool_name ?? "";
  if (tool !== "TodoWrite" && tool !== "TodoRead") return;
  const sessionId = input.session_id ?? "";
  const cwd = input.cwd ?? process.cwd();
  if (!sessionId) return;
  const todos = readTodos(sessionId);
  const goal = readGoal(sessionId);
  const plan = readPlan(cwd, sessionId);
  const captured = readState(sessionId, "plan", null);
  const phases = plan?.phases ?? captured?.phases ?? [];
  const prev = readState(sessionId, "ledger", {});
  const events = prev.events ?? [];
  const sig = todos.map((t) => `${t.status}:${t.content}`).join("|");
  const detail = tool === "TodoRead" ? "\u8BFB\u53D6\u6E05\u5355\uFF08\u65E0\u53D8\u5316\uFF09" : sig === prev.todoSig ? "\u5199\u5165\u76F8\u540C\u6E05\u5355\uFF08\u65E0\u53D8\u5316\uFF09" : `\u5F85\u529E\u66F4\u65B0\u4E3A ${todos.length} \u9879`;
  events.push({ at: stamp(), event: tool, detail });
  writeState(sessionId, "ledger", { events: events.slice(-40), todoSig: sig });
  const consistency = checkConsistency({ goal, todos, planPath: plan?.path ?? null, phases });
  const content = renderLedger({
    sessionId,
    planPath: plan?.path ?? null,
    phases,
    goal,
    todos,
    events,
    consistency
  });
  const ledger = ledgerPath(cwd, sessionId, plan?.path ?? null);
  writeLedger(ledger, content);
  pruneLedgers(join4(ledger, ".."));
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
