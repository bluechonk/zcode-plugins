// 本文件由 scripts/build.mjs 从 external_plugins/repo-guardian/src/session-start.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/repo-guardian/src/lib/hook.ts
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
  return envFlag("REPO_GUARDIAN_DISABLE");
}
function cwdOf(input) {
  const cwd = input.cwd;
  return typeof cwd === "string" && cwd.trim() ? cwd : process.cwd();
}

// external_plugins/repo-guardian/src/lib/detect.ts
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
  const dir = join(root, ".github", "workflows");
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).some((f) => /\.ya?ml$/iu.test(f));
  } catch {
    return false;
  }
}
function hasGitattributes(root) {
  return existsSync(join(root, ".gitattributes"));
}
function readmeChineseRatio(root) {
  const p = join(root, "README.md");
  if (!existsSync(p)) return null;
  try {
    const text = readFileSync(p, "utf8");
    const chars = [...text.replace(/\s+/gu, "")];
    if (chars.length === 0) return 0;
    let cjk = 0;
    for (const c of chars) {
      const cp = c.codePointAt(0) ?? 0;
      if (cp >= 19968 && cp <= 40959) cjk += 1;
    }
    return cjk / chars.length;
  } catch {
    return null;
  }
}
var EMOJI = new RegExp("\\p{Extended_Pictographic}", "u");

// external_plugins/repo-guardian/src/session-start.ts
var MIN_CHINESE_RATIO = 0.3;
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input || input.hook_event_name !== "SessionStart") return;
  if (isSubagent(input)) return;
  const root = findRepoRoot(cwdOf(input));
  if (!root) return;
  const lines = ["[repo-guardian] \u4ED3\u5E93\u5065\u5EB7\u68C0\u67E5\u7ED3\u679C\uFF1A", ""];
  if (!hasCI(root)) {
    lines.push(
      "\u7F3A\u5C11 CI\uFF1A\u4ED3\u5E93\u6CA1\u6709 .github/workflows/\u3002\u5EFA\u8BAE\u8865\u4E00\u4E2A\u6700\u5C0F workflow\uFF0C\u81F3\u5C11\u8DD1\u6784\u5EFA\u4E0E\u6D4B\u8BD5\u3002",
      "",
      "\u6700\u5C0F\u9AA8\u67B6\uFF08.github/workflows/ci.yml\uFF09\uFF1A",
      "```yaml",
      "name: CI",
      "on:",
      "  push:",
      "    branches: [ main ]",
      "  pull_request:",
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: actions/setup-node@v4",
      "        with:",
      '          node-version: "22"',
      "      - run: npm ci",
      "      - run: npm test",
      "```",
      ""
    );
  }
  if (!hasGitattributes(root)) {
    lines.push(
      "\u7F3A\u5C11 .gitattributes\uFF1A\u6309\u4ED3\u5E93\u89C4\u8303\u5FC5\u987B\u5B58\u5728\uFF0C\u4E14\u81F3\u5C11\u5305\u542B `* text=auto eol=lf`\u3002",
      ""
    );
  }
  const ratio = readmeChineseRatio(root);
  if (ratio !== null && ratio < MIN_CHINESE_RATIO) {
    lines.push(
      `README.md \u7684\u4E2D\u6587\u5360\u6BD4\u4EC5 ${(ratio * 100).toFixed(0)}%\uFF08\u8981\u6C42 30%\uFF09\uFF1AREADME \u5FC5\u987B\u662F\u5168\u4E2D\u6587\u6587\u6863\u3002`,
      ""
    );
  }
  if (lines.length === 2) return;
  lines.push("\u4EE5\u4E0A\u53EA\u662F\u63D0\u793A\uFF0C\u4E0D\u662F\u963B\u585E\u3002\u5224\u65AD\u672C\u4ED3\u5E93\u786E\u5B9E\u4E0D\u9700\u8981\u67D0\u9879\u65F6\u76F4\u63A5\u8BF4\u660E\u7406\u7531\u7EE7\u7EED\u3002");
  emit("SessionStart", { additionalContext: lines.join("\n") });
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
