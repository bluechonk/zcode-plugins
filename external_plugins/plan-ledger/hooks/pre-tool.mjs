// 本文件由 scripts/build.mjs 从 external_plugins/plan-ledger/src/pre-tool.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


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

// external_plugins/plan-ledger/src/pre-tool.ts
var GENERIC_TITLE = /^#{1,3}\s+(context|背景|概述|概要|说明)\s*$/iu;
function genericTitleOf(plan) {
  for (const line of plan.split("\n")) {
    const m = /^(#{1,3})\s+(.+?)\s*$/u.exec(line);
    if (!m) continue;
    return GENERIC_TITLE.test(line) ? m[2] : null;
  }
  return null;
}
function blocksPlanMode() {
  return process.env["PLAN_LEDGER_ALLOW_PLAN_MODE"] !== "1";
}
var DENY_PLAN_MODE = "[plan-ledger] \u4E0D\u7528 ZCode \u5185\u7F6E plan \u6A21\u5F0F\uFF1A\u5B83\u4EA7\u51FA\u7684\u662F\u6D41\u7A0B\u6587\u6863\u800C\u975E\u53EF\u6267\u884C\u72B6\u6001\uFF0C\u4E14\u6BCF\u6B21\u90FD\u8981\u5BA1\u6279\u3002\u8BF7\u76F4\u63A5\u7528 TodoWrite \u62C6\u89E3\u4EFB\u52A1\u2014\u2014\u6BCF\u9879\u5199\u6E05\u300C\u505A\u4EC0\u4E48 + \u600E\u4E48\u7B97\u5B8C\u6210\u300D\uFF0C\u6309\u4F9D\u8D56\u6392\u5E8F\uFF0C\u4E00\u6B21\u53EA\u7559\u4E00\u4E2A in_progress\u3002\u5F85\u529E\u4F1A\u81EA\u52A8\u6C47\u603B\u5230 .zcode/plans/progress-<sessionId>.md\u3002\u786E\u9700\u539F\u751F plan \u6A21\u5F0F\u65F6\uFF0C\u8BBE PLAN_LEDGER_ALLOW_PLAN_MODE=1\u3002";
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input || input.hook_event_name !== "PreToolUse") return;
  if (isSubagent(input)) return;
  const sessionId = input.session_id ?? "";
  if (!sessionId) return;
  if (input.tool_name === "EnterPlanMode") {
    if (!blocksPlanMode()) return;
    emit("PreToolUse", {
      permissionDecision: "deny",
      permissionDecisionReason: DENY_PLAN_MODE
    });
    return;
  }
  if (input.tool_name !== "ExitPlanMode") return;
  const plan = input.tool_input?.["plan"];
  if (typeof plan !== "string" || !plan.trim()) return;
  writeState(sessionId, "plan", {
    capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
    phases: extractPhases(plan),
    bytes: plan.length
  });
  const generic = genericTitleOf(plan);
  if (generic) {
    emit("PreToolUse", {
      additionalContext: `[plan-ledger] \u8BA1\u5212\u6807\u9898\u300C${generic}\u300D\u592A\u901A\u7528\uFF1AZCode \u4FA7\u8FB9\u680F\u7528\u7B2C\u4E00\u4E2A\u6807\u9898\u4F5C\u4E3A\u8BA1\u5212\u540D\uFF0C\u591A\u6B21\u89C4\u5212\u540E\u4F1A\u5168\u90E8\u663E\u793A\u6210\u300C${generic}\u300D\uFF0C\u770B\u4E0D\u51FA\u6BCF\u4EFD\u8BA1\u5212\u8981\u505A\u4EC0\u4E48\u3002
\u5EFA\u8BAE\u6539\u6210\u5E26\u4E3B\u9898\u7684\u5199\u6CD5\uFF0C\u4F8B\u5982\u300C## Context\uFF1Arepo-guardian \u63D2\u4EF6\u300D\u3002`
    });
  }
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
