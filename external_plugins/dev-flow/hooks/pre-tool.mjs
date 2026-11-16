// 本文件由 scripts/build.mjs 从 external_plugins/dev-flow/src/pre-tool.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/dev-flow/src/lib/hook.ts
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
  return process.env["ZCODE_PLUGIN_DATA"] ?? join(homedir(), ".zcode", "dev-flow");
}
function statePath(sessionId) {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "_") || "default";
  return join(stateDir(), `${safe}.json`);
}
function readState(sessionId, fallback) {
  try {
    const parsed = JSON.parse(readFileSync(statePath(sessionId), "utf8"));
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}
function writeState(sessionId, value) {
  try {
    const p = statePath(sessionId);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(value), "utf8");
  } catch {
  }
}
function envFlag(name) {
  return process.env[name] === "1";
}
function disabled() {
  return envFlag("DEV_FLOW_DISABLE");
}
function cwdOf(input) {
  const cwd = input.cwd;
  return typeof cwd === "string" && cwd.trim() ? cwd : process.cwd();
}

// external_plugins/dev-flow/src/lib/branch.ts
import { execFileSync } from "node:child_process";
function currentBranch(cwd) {
  try {
    return execFileSync("git", ["branch", "--show-current"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}
function hasLocalBranch(cwd, name) {
  try {
    const out = execFileSync("git", ["branch", "--list", name], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}
function isTrunk(branch) {
  return branch === "main" || branch === "master";
}
function branchState(cwd) {
  const branch = currentBranch(cwd);
  return { branch, hasDev: hasLocalBranch(cwd, "dev"), trunk: isTrunk(branch) };
}

// external_plugins/dev-flow/src/pre-tool.ts
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input || input.hook_event_name !== "PreToolUse") return;
  if (isSubagent(input)) return;
  const tool = input.tool_name ?? "";
  if (tool !== "Write" && tool !== "Edit" && tool !== "MultiEdit") return;
  const sessionId = input.session_id ?? "";
  if (!sessionId) return;
  const state = readState(sessionId, {});
  if (!state.exploratory || state.warned) return;
  const { branch, hasDev } = branchState(cwdOf(input));
  if (!branch || branch === "dev") return;
  writeState(sessionId, { ...state, warned: true });
  emit("PreToolUse", {
    additionalContext: `[dev-flow] \u672C\u4F1A\u8BDD\u662F\u63A2\u7D22\u5F0F\u6D41\u7A0B\uFF0C\u4F46\u8FD9\u6B21\u5199\u5165\u843D\u5728 ${branch} \u5206\u652F\u4E0A\u3002
` + (hasDev ? "\u672C\u5730\u5DF2\u6709 dev \u5206\u652F\u2014\u2014\u5148 git switch dev \u518D\u7EE7\u7EED\uFF0C\u907F\u514D\u8349\u7A3F\u843D\u9519\u5730\u65B9\u3002" : "\u672C\u5730\u8FD8\u6CA1\u6709 dev \u5206\u652F\u2014\u2014\u5148 git switch -c dev \u518D\u7EE7\u7EED\u3002") + "\n\u5DF2\u5728 dev \u4E0A\u5219\u5FFD\u7565\u672C\u63D0\u793A\u3002"
  });
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
