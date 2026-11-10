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
var MIN_CHINESE_RATIO = 0.15;
var COMMENT_RULES = [
  "[repo-guardian] \u6CE8\u91CA\u89C4\u8303\uFF08\u5199\u5165\u540E\u9010\u884C\u6838\u5BF9\uFF0C\u547D\u4E2D\u5373\u65F6\u63D0\u793A\uFF09\uFF1A",
  "",
  "1. \u6CE8\u91CA\u4E00\u5F8B\u4E2D\u6587\u3001\u7B80\u6D01\u3001\u4E0D\u590D\u8FF0\u4EE3\u7801\uFF1B\u968F\u4EE3\u7801\u6539\u52A8\u4E00\u8D77\u66F4\u65B0\uFF0C\u4E0D\u7559\u8FC7\u65F6\u6216\u8BEF\u5BFC\u6027\u6CE8\u91CA\u3002",
  "2. \u5199 why \u4E0D\u5199 what\uFF1A\u56DE\u7B54\u300C\u4E3A\u4EC0\u4E48\u8FD9\u6837\u5199\u300D\uFF08\u53D6\u820D\u3001\u7EA6\u675F\uFF09\uFF0C\u4E0D\u56DE\u7B54\u300C\u505A\u4E86\u4EC0\u4E48\u300D\u3002",
  "3. \u56DB\u7C7B\u7981\u5199\uFF1A\u4FEE\u8BA2\u8BB0\u5F55\u3001\u4F5C\u8005\u7F72\u540D\u4E0E\u5BA1\u6279\u7559\u75D5\u3001\u6CE8\u91CA\u6389\u7684\u4EE3\u7801\u3001\u534A\u540A\u5B50\u7FFB\u8BD1\u4E0E\u590D\u8FF0\u3002",
  "   \u7F72\u540D\u4E0E\u4FEE\u8BA2\u5386\u53F2\u7684\u552F\u4E00\u4E8B\u5B9E\u6E90\u662F git blame \u4E0E git log\uFF0C\u6CE8\u91CA\u91CC\u4E0D\u91CD\u590D\u3002",
  "4. \u65E5\u671F\u7ED1\u5728\u4E8B\u5B9E\u4E0A\u5FC5\u987B\u5199\uFF08\u300C\u5B9E\u6D4B\uFF082026-10-25\uFF09\u4E0A\u6E38\u6392\u961F 290s\u300D\uFF09\uFF0C\u7ED1\u5728\u4EBA\u8EAB\u4E0A\u7684\u4E00\u5F8B\u5220\u3002",
  "5. TODO / FIXME \u5199 `TODO(\u540D\u5B57): \u63CF\u8FF0`\uFF0C\u5E26\u6E05\u7406\u6761\u4EF6\uFF0C\u4E0D\u5E26\u4FEE\u8BA2\u65E5\u671F\u3002",
  "6. \u7A7A catch \u53EA\u5728\u5757\u5185\u5199\u660E\u300C\u6709\u610F\u5FFD\u7565\u300D\u65F6\u624D\u5141\u8BB8\uFF0C\u5426\u5219\u8BB0\u5F55\u65E5\u5FD7\u3001\u4E0A\u62A5\u6216\u8F6C\u6362\u540E\u91CD\u629B\uFF1B",
  "   `@deprecated` \u5FC5\u5199\u66FF\u4EE3\u65B9\u6848\u4E0E\u79FB\u9664\u6761\u4EF6\uFF1B`@ts-ignore` / `@ts-expect-error` \u5FC5\u987B\u540C\u884C\u5199\u660E\u7406\u7531\u3002",
  "7. \u7981\u7528 any \u56FE\u7701\u4E8B\uFF1B\u8DE8\u6A21\u5757\u5951\u7EA6\u9762\u7684\u523B\u610F\u5BBD\u677E\u8981\u5199\u660E\u8BBE\u8BA1\u7406\u7531\u3002"
].join("\n");
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input || input.hook_event_name !== "SessionStart") return;
  if (isSubagent(input)) return;
  const lines = [];
  const root = findRepoRoot(cwdOf(input));
  if (root) {
    const health = [];
    if (!hasCI(root)) {
      health.push(
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
      health.push("\u7F3A\u5C11 .gitattributes\uFF1A\u6309\u4ED3\u5E93\u89C4\u8303\u5FC5\u987B\u5B58\u5728\uFF0C\u4E14\u81F3\u5C11\u5305\u542B `* text=auto eol=lf`\u3002", "");
    }
    const ratio = readmeChineseRatio(root);
    if (ratio !== null && ratio < MIN_CHINESE_RATIO) {
      health.push(`README.md \u7684\u4E2D\u6587\u5360\u6BD4\u4EC5 ${(ratio * 100).toFixed(0)}%\uFF1AREADME \u5FC5\u987B\u662F\u5168\u4E2D\u6587\u6587\u6863\u3002`, "");
    }
    if (health.length > 0) {
      lines.push("[repo-guardian] \u4ED3\u5E93\u5065\u5EB7\u68C0\u67E5\u7ED3\u679C\uFF1A", "", ...health);
      lines.push("\u4EE5\u4E0A\u53EA\u662F\u63D0\u793A\uFF0C\u4E0D\u662F\u963B\u585E\u3002\u5224\u65AD\u672C\u4ED3\u5E93\u786E\u5B9E\u4E0D\u9700\u8981\u67D0\u9879\u65F6\u76F4\u63A5\u8BF4\u660E\u7406\u7531\u7EE7\u7EED\u3002");
    }
  }
  if (lines.length > 0) lines.push("");
  lines.push(COMMENT_RULES);
  emit("SessionStart", { additionalContext: lines.join("\n") });
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
