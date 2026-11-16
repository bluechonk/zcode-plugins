// 本文件由 scripts/build.mjs 从 external_plugins/dev-flow/src/session-start.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/dev-flow/src/lib/hook.ts
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

// external_plugins/dev-flow/src/session-start.ts
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input || input.hook_event_name !== "SessionStart") return;
  if (isSubagent(input)) return;
  const { branch, hasDev, trunk } = branchState(cwdOf(input));
  if (!branch) return;
  const lines = [`[dev-flow] \u5206\u652F\u72B6\u6001\uFF1A\u5F53\u524D ${branch} \xB7 \u672C\u5730 dev \u5206\u652F${hasDev ? "\u5DF2\u5B58\u5728" : "\u4E0D\u5B58\u5728"}`];
  if (trunk) {
    lines.push(
      "\u5F53\u524D\u5728\u4E3B\u5E72\u4E0A\u3002dev-flow \u6D41\u7A0B\u91CC\uFF0C\u8349\u7A3F\u5F0F\u6539\u52A8\u5E94\u5148\u843D dev \u5206\u652F\uFF08\u79EF\u7D2F\u5230\u4E00\u6279\u518D\u5F00\u6574\u7406\u4F1A\u62C6\u4E3B\u9898\u5206\u652F\uFF09\uFF1B",
      "\u786E\u5B9A\u6027\u4EFB\u52A1\u8D70\u666E\u901A\u7279\u6027\u5206\u652F\u5373\u53EF\u3002"
    );
  } else if (branch === "dev") {
    lines.push("\u5DF2\u5728 dev \u5206\u652F\uFF1A\u9002\u5408\u7EE7\u7EED\u79EF\u7D2F\u8349\u7A3F\uFF0C\u6216\u73B0\u5728\u5F00\u6574\u7406\u4F1A\u3002");
  } else {
    lines.push(`\u5F53\u524D\u5728 ${branch}\u3002\u82E5\u8FD9\u8F6E\u662F\u63A2\u7D22\u5F0F\u6539\u52A8\uFF0Cdev-flow \u5EFA\u8BAE\u6539\u5230 dev \u5206\u652F\u79EF\u7D2F\u3002`);
  }
  emit("SessionStart", { additionalContext: lines.join("\n") });
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
