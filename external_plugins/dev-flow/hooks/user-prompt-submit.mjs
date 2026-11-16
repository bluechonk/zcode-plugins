// 本文件由 scripts/build.mjs 从 external_plugins/dev-flow/src/user-prompt-submit.ts 生成。
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

// external_plugins/dev-flow/src/lib/exploratory.ts
var EXPLORATORY_TRIGGERS = /整理提交|拆分支|拆成|累计起来|攒多了|梳理这轮|梳理一下这轮|这轮改动|探索式|随便改改|先试着改|试改|草稿/;
function looksExploratory(prompt) {
  return EXPLORATORY_TRIGGERS.test(prompt);
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

// external_plugins/dev-flow/src/user-prompt-submit.ts
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input || input.hook_event_name !== "UserPromptSubmit") return;
  if (isSubagent(input)) return;
  const sessionId = input.session_id ?? "";
  if (!sessionId) return;
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  if (!looksExploratory(prompt)) return;
  const { branch, hasDev, trunk } = branchState(cwdOf(input));
  const state = readState(sessionId, {});
  if (branch === "dev") {
    if (!state.exploratory) writeState(sessionId, { ...state, exploratory: true });
    return;
  }
  if (state.prompted) return;
  const lines = ["[dev-flow] \u8FD9\u662F\u63A2\u7D22\u5F0F/\u6536\u53E3\u573A\u666F\uFF0C\u8349\u7A3F\u6539\u52A8\u5E94\u843D dev \u5206\u652F\u3002"];
  if (!branch) {
    lines.push("\u8BFB\u4E0D\u5230\u5F53\u524D\u5206\u652F\uFF08\u4E0D\u5728 git \u4ED3\u5E93\u6216\u5904\u4E8E detached HEAD\uFF09\uFF1A\u5148\u786E\u8BA4\u4ED3\u5E93\u72B6\u6001\u518D\u52A8\u624B\u3002");
  } else if (hasDev) {
    lines.push(`\u672C\u5730\u5DF2\u6709 dev \u5206\u652F\uFF1A\u5207\u8FC7\u53BB\u518D\u6539\uFF08git switch dev\uFF09\uFF0C\u4E0D\u8981\u65B0\u5EFA\u91CD\u590D\u5206\u652F\u3002`);
  } else {
    lines.push(`\u672C\u5730\u8FD8\u6CA1\u6709 dev \u5206\u652F\uFF1A\u4ECE\u5F53\u524D\u7A33\u5B9A\u70B9\u5EFA\u4E00\u4E2A\uFF08git switch -c dev\uFF09\uFF0C\u518D\u5F00\u59CB\u8349\u7A3F\u6539\u52A8\u3002`);
  }
  if (trunk) {
    lines.push(`\u6CE8\u610F\uFF1A\u5F53\u524D\u5728 ${branch}\uFF08\u4E3B\u5E72\uFF09\uFF0C\u76F4\u63A5\u843D\u8349\u7A3F\u4F1A\u6C61\u67D3\u4E3B\u5E72\u5386\u53F2\u3002`);
  }
  lines.push("\u79EF\u7D2F\u5230\u4E00\u6279\u540E\u5F00\u6574\u7406\u4F1A\uFF0C\u6309\u4E3B\u9898\u62C6\u6210\u5E72\u51C0\u7684\u5206\u652F\u518D\u9010\u4E2A PR\u3002");
  writeState(sessionId, { ...state, exploratory: true, prompted: true });
  emit("UserPromptSubmit", { additionalContext: lines.join("\n") });
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
