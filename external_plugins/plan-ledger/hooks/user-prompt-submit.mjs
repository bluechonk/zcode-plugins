// 本文件由 scripts/build.mjs 从 external_plugins/plan-ledger/src/user-prompt-submit.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/plan-ledger/src/user-prompt-submit.ts
import { DatabaseSync } from "node:sqlite";
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";

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
  return envFlag("PLAN_LEDGER_DISABLE") || process.env["ZCODE_PLAN_GATE"] === "off";
}

// external_plugins/plan-ledger/src/user-prompt-submit.ts
var DB_PATH = join2(homedir2(), ".zcode", "cli", "db", "db.sqlite");
var MAX_PROMPTS_PER_SESSION = 3;
var MULTI_STEP_LENGTH = 80;
var MULTI_STEP_HINTS = /实现|新增|添加|重构|改造|迁移|修复|排查|调研|设计|规划|优化|接入|替换|升级|实现一下|帮我做|做一个|写一个|整理|清理|拆分|合并/iu;
function hasTodoThisTurn(sessionId) {
  try {
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      const row = db.prepare(
        `SELECT EXISTS(
             SELECT 1 FROM part
             WHERE session_id = :sid
               AND json_extract(data, '$.tool') = 'TodoWrite'
               AND time_created >= COALESCE(
                 (SELECT MAX(time_created) FROM message
                  WHERE session_id = :sid AND json_extract(data, '$.semantics.kind') = 'user_prompt'),
                 0)
           ) AS has`
      ).get({ sid: sessionId });
      return Boolean(row?.has);
    } finally {
      db.close();
    }
  } catch {
    return true;
  }
}
function looksMultiStep(prompt) {
  const text = prompt.trim();
  if (!text) return false;
  if (text.length >= MULTI_STEP_LENGTH) return true;
  return MULTI_STEP_HINTS.test(text);
}
var TEMPLATE = [
  "[plan-ledger] \u8FD9\u770B\u8D77\u6765\u662F\u591A\u6B65\u4EFB\u52A1\u3002\u5EFA\u8BAE\u5148\u7528 TodoWrite \u62C6\u89E3\uFF0C\u4E0D\u9700\u8981\u8FDB\u5165 plan \u6A21\u5F0F\uFF1A",
  "",
  "1. \u6BCF\u9879\u5199\u6E05\u300C\u505A\u4EC0\u4E48 + \u600E\u4E48\u7B97\u5B8C\u6210\u300D\u2014\u2014\u9A8C\u6536\u6807\u51C6\u6BD4\u52A8\u4F5C\u63CF\u8FF0\u66F4\u91CD\u8981",
  "2. \u6309\u4F9D\u8D56\u987A\u5E8F\u6392 position\uFF0C\u88AB\u4F9D\u8D56\u7684\u5728\u524D",
  "3. \u4E00\u6B21\u53EA\u7559\u4E00\u4E2A in_progress\uFF0C\u5176\u4F59 pending",
  "4. \u5B8C\u6210\u540E\u7ACB\u523B\u6807 completed\uFF0C\u4E0D\u8981\u6512\u5230\u6700\u540E\u4E00\u8D77\u6807",
  "",
  "\u793A\u4F8B\uFF1A",
  "- [pending] \u65B0\u589E repo-guardian \u7684 detect.ts\uFF1A\u5BFC\u51FA hasCI / hasGitattributes / readmeChineseRatio\uFF0C\u5355\u6D4B\u8986\u76D6\u4E09\u79CD\u4ED3\u5E93\u72B6\u6001",
  "- [in_progress] \u5199 pre-tool.ts\uFF1A\u547D\u4E2D\u7981\u7528\u547D\u4EE4\u5373 deny\uFF0C\u5176\u4F59\u53EA\u63D0\u793A\uFF0C\u9694\u79BB\u6D4B\u8BD5\u9A8C\u8BC1\u4E0D\u8BEF\u4F24",
  "",
  "\u5F85\u529E\u4F1A\u5199\u8FDB .zcode/plans/progress-<sessionId>.md\uFF0C\u968F\u65F6\u53EF\u67E5\u5F53\u524D\u8FDB\u5EA6\u3002"
].join("\n");
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input || input.hook_event_name !== "UserPromptSubmit") return;
  if (isSubagent(input)) return;
  const sessionId = input.session_id ?? "";
  if (!sessionId) return;
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  if (!looksMultiStep(prompt)) return;
  if (hasTodoThisTurn(sessionId)) return;
  const state = readState(sessionId, "prompts", { prompts: 0 });
  if (state.prompts >= MAX_PROMPTS_PER_SESSION) return;
  writeState(sessionId, "prompts", { prompts: state.prompts + 1 });
  emit("UserPromptSubmit", { additionalContext: TEMPLATE });
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
