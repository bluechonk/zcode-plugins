// 本文件由 scripts/build.mjs 从 external_plugins/security-review/src/baseline.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/security-review/src/lib/hook.ts
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
function stateDir() {
  return process.env["ZCODE_PLUGIN_DATA"] ?? process.env["CLAUDE_PLUGIN_DATA"] ?? join(homedir(), ".zcode", "security-review");
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
function disabled() {
  return process.env["SECURITY_REVIEW_DISABLE"] === "1";
}

// external_plugins/security-review/src/lib/git.ts
import { spawnSync } from "node:child_process";
function git(cwd, args) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 2e4,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024
  });
  return { ok: r.status === 0, out: r.stdout ?? "" };
}
function isRepo(cwd) {
  return git(cwd, ["rev-parse", "--is-inside-work-tree"]).out.trim() === "true";
}
function captureBaseline(cwd) {
  const stash = git(cwd, ["stash", "create"]);
  if (stash.ok && stash.out.trim()) return stash.out.trim();
  const head = git(cwd, ["rev-parse", "HEAD"]);
  return head.ok && head.out.trim() ? head.out.trim() : null;
}

// external_plugins/security-review/src/baseline.ts
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input || input.hook_event_name !== "UserPromptSubmit") return;
  const cwd = input.cwd ?? process.cwd();
  if (!isRepo(cwd)) return;
  const sha = captureBaseline(cwd);
  if (!sha) return;
  const sessionId = input.session_id ?? "default";
  writeState(sessionId, "baseline", { sha, cwd, at: (/* @__PURE__ */ new Date()).toISOString() });
  writeState(sessionId, "stop", { blocks: 0 });
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
