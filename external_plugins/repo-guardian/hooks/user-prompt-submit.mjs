// 本文件由 scripts/build.mjs 从 external_plugins/repo-guardian/src/user-prompt-submit.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/repo-guardian/src/lib/hook.ts
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
  return process.env["ZCODE_PLUGIN_DATA"] ?? process.env["CLAUDE_PLUGIN_DATA"] ?? join(homedir(), ".zcode", "repo-guardian");
}
function statePath(sessionId) {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "_");
  return join(stateDir(), `${safe}.json`);
}
function readState(sessionId, fallback) {
  try {
    const raw = readFileSync(statePath(sessionId), "utf8");
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}
function writeState(sessionId, value) {
  try {
    let current = {};
    if (value && typeof value === "object" && !Array.isArray(value)) {
      current = readState(sessionId, {});
    }
    const p = statePath(sessionId);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ ...current, ...value }), "utf8");
  } catch {
  }
}
function envFlag(name) {
  return process.env[name] === "1";
}
function disabled() {
  return envFlag("REPO_GUARDIAN_DISABLE");
}
function cwdOf(input) {
  const cwd = input.cwd;
  return typeof cwd === "string" && cwd.trim() ? cwd : process.cwd();
}

// external_plugins/repo-guardian/src/lib/detect.ts
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync as readFileSync2, readdirSync } from "node:fs";
import { join as join2 } from "node:path";
function findRepoRoot(cwd) {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}
function hasCI(root) {
  const dir = join2(root, ".github", "workflows");
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).some((f) => /\.ya?ml$/iu.test(f));
  } catch {
    return false;
  }
}
var EMOJI = new RegExp("\\p{Extended_Pictographic}", "u");

// external_plugins/repo-guardian/src/user-prompt-submit.ts
var EVERY_N_TURNS = 10;
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input || input.hook_event_name !== "UserPromptSubmit") return;
  if (isSubagent(input)) return;
  const sessionId = input.session_id ?? "";
  if (!sessionId) return;
  const root = findRepoRoot(cwdOf(input));
  if (!root || hasCI(root)) return;
  const state = readState(sessionId, { lastPromptedTurn: -EVERY_N_TURNS });
  const turn = state.lastPromptedTurn + 1;
  writeState(sessionId, { lastPromptedTurn: turn });
  if (turn % EVERY_N_TURNS !== 0 && turn !== 1) return;
  emit("UserPromptSubmit", {
    additionalContext: "[repo-guardian] \u63D0\u9192\uFF1A\u672C\u4ED3\u5E93\u4ECD\u6CA1\u6709 CI\uFF08.github/workflows/\uFF09\u3002\u5982\u679C\u8FD9\u662F\u4E00\u4E2A\u9700\u8981\u6301\u7EED\u7EF4\u62A4\u7684\u9879\u76EE\uFF0C\u5EFA\u8BAE\u8865\u4E00\u4E2A\u6700\u5C0F workflow\u3002"
  });
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
