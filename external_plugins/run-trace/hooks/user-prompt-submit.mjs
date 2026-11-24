// 本文件由 scripts/build.mjs 从 external_plugins/run-trace/src/user-prompt-submit.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/run-trace/src/lib/hook.ts
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
  return process.env["ZCODE_PLUGIN_DATA"] ?? process.env["CLAUDE_PLUGIN_DATA"] ?? join(homedir(), ".zcode", "run-trace");
}
function statePath(sessionId) {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "_") || "default";
  return join(stateDir(), `${safe}.json`);
}
function readState(sessionId, fallback) {
  try {
    return JSON.parse(readFileSync(statePath(sessionId), "utf8")) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeState(sessionId, value) {
  try {
    const p = statePath(sessionId);
    let current = {};
    if (value && typeof value === "object") current = readState(sessionId, {});
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ ...current, ...value }), "utf8");
  } catch {
  }
}
function disabled() {
  return process.env["RUN_TRACE_DISABLE"] === "1";
}

// external_plugins/run-trace/src/user-prompt-submit.ts
var EVERY_N_TURNS = 12;
var REMINDER = [
  "[run-trace] \u63D0\u9192\uFF1A\u957F\u8DD1\u547D\u4EE4\uFF08\u8BAD\u7EC3 / \u57FA\u51C6 / \u6784\u5EFA / \u6D4B\u8BD5\u5957\u4EF6 / \u8FC1\u79FB\uFF09\u8981\u80FD\u770B\u89C1\u8FDB\u5EA6\u3001\u80FD\u4E8B\u540E\u8FFD\u6EAF\u3002",
  "\u4E0D\u8981\u7528 `\u2026 2>&1 | grep \u2026` \u8FD9\u79CD\u5199\u6CD5\uFF1A\u8F93\u51FA\u4F1A\u6512\u5230\u7ED3\u675F\u624D\u51FA\u73B0\uFF0C\u9000\u51FA\u7801\u4F1A\u88AB\u541E\uFF0Cstderr \u4F1A\u6D88\u5931\u3002",
  '\u6539\u7528 `node "${ZCODE_PLUGIN_ROOT}/hooks/trace.mjs" --log .tmp/runs/<\u540D\u5B57>.log -- <\u547D\u4EE4\u2026>`\uFF0C',
  "\u5B83\u8FB9\u8DD1\u8FB9\u56DE\u663E\u3001\u8FB9\u8DD1\u8FB9\u843D\u76D8\uFF0C\u7ED3\u5C3E\u5199 RESULT \u6807\u8BB0\u3002"
].join("\n");
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input || input.hook_event_name !== "UserPromptSubmit") return;
  if (isSubagent(input)) return;
  const sessionId = input.session_id ?? "";
  if (!sessionId) return;
  const state = readState(sessionId, { lastPromptedTurn: 0 });
  const turn = state.lastPromptedTurn + 1;
  writeState(sessionId, { lastPromptedTurn: turn });
  if (turn !== 1 && turn % EVERY_N_TURNS !== 0) return;
  emit("UserPromptSubmit", { additionalContext: REMINDER });
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
