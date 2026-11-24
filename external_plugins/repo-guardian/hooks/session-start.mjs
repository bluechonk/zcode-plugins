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
var CREDENTIAL_NAME = /(?:^|\/)(?:\.env\.(?:local|dev|development|prod|production|test|ci|stage|staging)$|\.env$|[^/]*\.(?:pem|key|p12|pfx|jks|keystore|kdbx)$|id_rsa(?:$|[._2]|\.pub)|id_ed25519(?:$|[._2])|\.htpasswd$|credentials$|service-account(?:[-.][^/]*)?\.json$|secrets?\.ya?ml$)/iu;
var CREDENTIAL_TEMPLATE = /(?:^|\/)\.env\.(?:example|sample|template|dist)$/iu;
function isCredentialPath(filePath) {
  const p = filePath.replace(/\\/gu, "/");
  if (CREDENTIAL_TEMPLATE.test(p)) return false;
  return CREDENTIAL_NAME.test(p);
}
var ARTIFACT_DIR = /^(?:node_modules|dist|build|out|coverage|target|bin|obj|\.next|\.nuxt|\.turbo|__pycache__|\.venv|venv|env)\//iu;
var ARTIFACT_FILE = /(?:\.tsbuildinfo|\.pyc|\.pyo|\.o|\.a|\.lib|\.exp|\.map)$/iu;
function isArtifactPath(filePath) {
  const p = filePath.replace(/\\/gu, "/");
  return ARTIFACT_DIR.test(p) || ARTIFACT_FILE.test(p);
}

// external_plugins/repo-guardian/src/lib/hygiene.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
var REQUIRED_GITATTRIBUTES_LINE = "* text=auto eol=lf";
var REQUIRED_IGNORE_ENTRIES = ["node_modules/", "dist/"];
function git(root, args) {
  try {
    return execFileSync2("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 32 * 1024 * 1024,
      timeout: 8e3
    });
  } catch {
    return null;
  }
}
function nul(text) {
  return text.split("\0").map((s) => s.trim()).filter(Boolean);
}
function posix(p) {
  return p.replace(/\\/gu, "/");
}
function gitattributesIssue(root) {
  const p = join2(root, ".gitattributes");
  if (!existsSync2(p)) return { kind: "missing", detail: "\u4ED3\u5E93\u6CA1\u6709 .gitattributes" };
  let text = "";
  try {
    text = readFileSync2(p, "utf8");
  } catch {
    return null;
  }
  const has = text.split(/\r?\n/u).some((line) => line.trim() === REQUIRED_GITATTRIBUTES_LINE);
  return has ? null : { kind: "no-lf-rule", detail: ".gitattributes \u7F3A\u5C11 `* text=auto eol=lf`" };
}
function crlfTrackedFiles(root, limit = 20) {
  const out = git(root, ["ls-files", "--eol", "-z"]);
  if (!out) return [];
  const hits = [];
  for (const record of out.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("	");
    if (tab < 0) continue;
    const [indexState] = record.slice(0, tab).trim().split(/\s+/u);
    const path = record.slice(tab + 1);
    if (indexState === "i/crlf") hits.push(posix(path));
    if (hits.length >= limit) break;
  }
  return hits;
}
function trackedArtifacts(root, limit = 20) {
  const out = git(root, ["ls-files", "-z"]);
  if (!out) return [];
  const hits = nul(out).filter(isArtifactPath);
  return hits.slice(0, limit);
}
function credentialFiles(root, limit = 20) {
  const trackedRaw = git(root, ["ls-files", "-z"]);
  const othersRaw = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const tracked = trackedRaw ? nul(trackedRaw).filter(isCredentialPath).slice(0, limit) : [];
  const atRisk = othersRaw ? nul(othersRaw).filter(isCredentialPath).slice(0, limit) : [];
  return { tracked, atRisk };
}
function missingIgnoreEntries(root) {
  const p = join2(root, ".gitignore");
  if (!existsSync2(p)) return [...REQUIRED_IGNORE_ENTRIES];
  let text = "";
  try {
    text = readFileSync2(p, "utf8");
  } catch {
    return [];
  }
  const lines = new Set(
    text.split(/\r?\n/u).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
  );
  return REQUIRED_IGNORE_ENTRIES.filter((e) => !lines.has(e) && !lines.has(e.replace(/\/$/u, "")));
}
function hygieneReport(root) {
  return {
    root,
    gitattributes: gitattributesIssue(root),
    crlfFiles: crlfTrackedFiles(root),
    artifacts: trackedArtifacts(root),
    credentials: credentialFiles(root),
    missingIgnores: missingIgnoreEntries(root)
  };
}
function hygieneFindings(r) {
  const findings = [];
  const credentialLines = [];
  if (r.credentials.tracked.length) {
    credentialLines.push(
      `\u51ED\u636E\u5DF2\u5165\u5E93\uFF08${r.credentials.tracked.length} \u4E2A\uFF09\uFF1A${r.credentials.tracked.join(", ")}`,
      "   \u5904\u7F6E\uFF1A\u7ACB\u5373\u64A4\u9500\u5E76\u8F6E\u6362\u8FD9\u4E9B\u51ED\u636E\uFF0C\u518D\u4ECE\u5386\u53F2\u91CC\u6E05\u9664\uFF08git filter-repo \u6216 BFG\uFF09\uFF0C\u6700\u540E force push\u3002"
    );
  }
  if (r.credentials.atRisk.length) {
    credentialLines.push(
      `\u51ED\u636E\u6587\u4EF6\u672A\u88AB .gitignore \u8986\u76D6\uFF08${r.credentials.atRisk.length} \u4E2A\uFF09\uFF1A${r.credentials.atRisk.join(", ")}`,
      "   \u5904\u7F6E\uFF1A\u52A0\u8FDB .gitignore\uFF1B\u5185\u5BB9\u6539\u8D70\u73AF\u5883\u53D8\u91CF\u6216\u5BC6\u94A5\u7BA1\u7406\u670D\u52A1\u3002"
    );
  }
  if (credentialLines.length) findings.push({ rule: "credentials", lines: credentialLines });
  const eolLines = [];
  if (r.gitattributes) {
    eolLines.push(
      r.gitattributes.kind === "missing" ? `\u7F3A\u5C11 .gitattributes\uFF1A\u81F3\u5C11\u8981\u6709 \`${REQUIRED_GITATTRIBUTES_LINE}\`` : r.gitattributes.detail
    );
  }
  if (r.crlfFiles.length) {
    eolLines.push(
      `\u5DF2\u5165\u5E93\u7684\u6587\u672C\u6587\u4EF6\u5E26 CRLF\uFF08${r.crlfFiles.length} \u4E2A\uFF09\uFF1A${r.crlfFiles.join(", ")}`,
      "   \u5904\u7F6E\uFF1A\u8865 .gitattributes \u540E git add --renormalize . \u4E00\u6B21\u6027\u5F52\u4E00\u3002"
    );
  }
  if (eolLines.length) findings.push({ rule: "eol", lines: eolLines });
  const artifactLines = [];
  if (r.missingIgnores.length) {
    artifactLines.push(`.gitignore \u7F3A\u5C11\u6761\u76EE\uFF1A${r.missingIgnores.join(", ")}`);
  }
  if (r.artifacts.length) {
    artifactLines.push(
      `\u6784\u5EFA\u4EA7\u7269\u6216\u8FD0\u884C\u65F6\u6570\u636E\u5DF2\u5165\u5E93\uFF08${r.artifacts.length} \u4E2A\uFF09\uFF1A${r.artifacts.join(", ")}`,
      "   \u5904\u7F6E\uFF1Agit rm -r --cached \u540E\u52A0\u8FDB .gitignore\u3002"
    );
  }
  if (artifactLines.length) findings.push({ rule: "artifacts", lines: artifactLines });
  return findings;
}
function hygieneFindingLines(r) {
  return hygieneFindings(r).flatMap((f) => [...f.lines, ""]);
}

// external_plugins/repo-guardian/src/session-start.ts
var MIN_CHINESE_RATIO = 0.15;
var COMMENT_RULES = [
  "[repo-guardian] \u4EE3\u7801\u4E0E\u6CE8\u91CA\u89C4\u8303\uFF08\u5199\u5165\u540E\u9010\u884C\u6838\u5BF9\uFF0C\u547D\u4E2D\u5373\u65F6\u63D0\u793A\uFF09\uFF1A",
  "",
  "1. \u6CE8\u91CA\u4E00\u5F8B\u4E2D\u6587\u3001\u7B80\u6D01\u3001\u4E0D\u590D\u8FF0\u4EE3\u7801\uFF1B\u968F\u4EE3\u7801\u6539\u52A8\u4E00\u8D77\u66F4\u65B0\uFF0C\u4E0D\u7559\u8FC7\u65F6\u6216\u8BEF\u5BFC\u6027\u6CE8\u91CA\u3002",
  "2. \u5199 why \u4E0D\u5199 what\uFF1A\u56DE\u7B54\u300C\u4E3A\u4EC0\u4E48\u8FD9\u6837\u5199\u300D\uFF08\u53D6\u820D\u3001\u7EA6\u675F\uFF09\uFF0C\u4E0D\u56DE\u7B54\u300C\u505A\u4E86\u4EC0\u4E48\u300D\u3002",
  "3. \u56DB\u7C7B\u7981\u5199\uFF1A\u4FEE\u8BA2\u8BB0\u5F55\u3001\u4F5C\u8005\u7F72\u540D\u4E0E\u5BA1\u6279\u7559\u75D5\u3001\u6CE8\u91CA\u6389\u7684\u4EE3\u7801\u3001\u534A\u540A\u5B50\u7FFB\u8BD1\u4E0E\u590D\u8FF0\u3002",
  "   \u7F72\u540D\u4E0E\u4FEE\u8BA2\u5386\u53F2\u7684\u552F\u4E00\u4E8B\u5B9E\u6E90\u662F git blame \u4E0E git log\uFF0C\u6CE8\u91CA\u91CC\u4E0D\u91CD\u590D\u3002",
  "4. \u65E5\u671F\u7ED1\u5728\u4E8B\u5B9E\u4E0A\u5FC5\u987B\u5199\uFF08\u300C\u5B9E\u6D4B\uFF082026-10-25\uFF09\u4E0A\u6E38\u6392\u961F 290s\u300D\uFF09\uFF0C\u7ED1\u5728\u4EBA\u8EAB\u4E0A\u7684\u4E00\u5F8B\u5220\u3002",
  "5. TODO / FIXME \u5199 `TODO(\u540D\u5B57): \u63CF\u8FF0`\uFF0C\u5E26\u6E05\u7406\u6761\u4EF6\uFF0C\u4E0D\u5E26\u4FEE\u8BA2\u65E5\u671F\u3002",
  "6. \u7A7A catch \u53EA\u5728\u5757\u5185\u5199\u660E\u300C\u6709\u610F\u5FFD\u7565\u300D\u65F6\u624D\u5141\u8BB8\uFF0C\u5426\u5219\u8BB0\u5F55\u65E5\u5FD7\u3001\u4E0A\u62A5\u6216\u8F6C\u6362\u540E\u91CD\u629B\uFF1B",
  "   `@deprecated` \u5FC5\u5199\u66FF\u4EE3\u65B9\u6848\u4E0E\u79FB\u9664\u6761\u4EF6\uFF1B`@ts-ignore` / `@ts-expect-error` \u5FC5\u987B\u540C\u884C\u5199\u660E\u7406\u7531\u3002",
  "7. \u7981\u7528 any \u56FE\u7701\u4E8B\uFF1B\u8DE8\u6A21\u5757\u5951\u7EA6\u9762\u7684\u523B\u610F\u5BBD\u677E\u8981\u5199\u660E\u8BBE\u8BA1\u7406\u7531\u3002",
  "8. \u6587\u4EF6\u5199\u5165\u53EA\u7528\u9879\u76EE\u5C01\u88C5\u7684\u8DEF\u5F84\u5DE5\u5177\uFF08paths.* / app.getPath()\uFF09\uFF0C\u4E0D\u786C\u7F16\u7801 Desktop\u3001C:\\\u3001",
  "   \u7528\u6237\u4E3B\u76EE\u5F55\u62FC\u63A5\u2014\u2014\u8FD9\u6761\u4F1A\u88AB\u673A\u5668\u6838\u5BF9\u3002",
  "9. \u8FD0\u884C\u65F6\u65E5\u5FD7\u4E00\u5F8B\u82F1\u6587\uFF1B\u9762\u5411\u7528\u6237\u7684 CLI \u62A5\u8868\u4E0E UI \u6587\u6848\u4FDD\u6301\u4E2D\u6587\u3002",
  "   \u8FD9\u6761\u673A\u5668\u5224\u4E0D\u4E86\uFF08\u4E24\u8005\u5199\u6CD5\u76F8\u540C\uFF09\uFF0C\u9760\u81EA\u89C9\u3002",
  "10. Bash \u5185\u5EFA\uFF08echo / printf\uFF09\u8F93\u51FA\u4E2D\u6587\u4F1A\u88AB\u6309\u7CFB\u7EDF\u4EE3\u7801\u9875\uFF08\u672C\u673A GBK/936\uFF09\u89E3\u7801\u800C\u4E71\u7801\uFF1A",
  "    \u5305\u4E00\u5C42 `| iconv -f UTF-8 -t GBK`\uFF0C\u6216\u628A\u4E2D\u6587\u4EA4\u7ED9\u5916\u90E8\u7A0B\u5E8F\u3002pwsh \u4E0E\u5916\u90E8\u7A0B\u5E8F\u4E0D\u53D7\u5F71\u54CD\u3002"
].join("\n");
var HYGIENE_RULES = [
  "[repo-guardian] \u4ED3\u5E93\u536B\u751F\u89C4\u8303\uFF08\u63D0\u4EA4\u524D\u540E\u5404\u6838\u5BF9\u4E00\u6B21\uFF09\uFF1A",
  "",
  "1. \u4ED3\u5E93\u5185\u6587\u672C\u6587\u4EF6\u4E00\u5F8B LF\uFF1B\u6BCF\u4E2A git \u4ED3\u5E93\u5FC5\u987B\u6709 .gitattributes\uFF0C\u81F3\u5C11\u5305\u542B `* text=auto eol=lf`\u3002",
  "   \u5B58\u91CF\u4ED3\u5E93\u5728\u4E0B\u6B21\u6539\u52A8\u65F6\u8865\u9F50\uFF0C\u4E0D\u4E13\u95E8\u5F00\u4E00\u6B21\u300C\u53EA\u6539\u6362\u884C\u7B26\u300D\u7684\u63D0\u4EA4\u3002",
  "2. \u4E25\u7981\u63D0\u4EA4\u51ED\u636E\uFF1Aapikey / accesskey / secret key / token / \u5BC6\u7801 / \u79C1\u94A5 / \u8BC1\u4E66 / \u6570\u636E\u5E93\u8FDE\u63A5\u4E32\uFF0C",
  "   \u4EE5\u53CA\u542B\u771F\u5B9E\u51ED\u636E\u7684 .env / .pem / .key\u3002\u654F\u611F\u5185\u5BB9\u8D70\u73AF\u5883\u53D8\u91CF\u6216\u5BC6\u94A5\u7BA1\u7406\u670D\u52A1\uFF0C\u5E76\u5199\u8FDB .gitignore\u3002",
  "   \u6A21\u677F\u6587\u4EF6\uFF08.env.example \u4E4B\u7C7B\uFF09\u53EF\u4EE5\u5165\u5E93\uFF0C\u4F46\u503C\u5FC5\u987B\u662F\u5360\u4F4D\u7B26\u3002",
  "3. \u63D0\u4EA4\u524D\u81EA\u67E5\u4E09\u4EF6\u4E8B\uFF1Agit status\u3001git diff\u3001\u654F\u611F\u8BCD\u626B\u63CF\u3002\u8BEF\u63D0\u4EA4\u7ACB\u5373\u64A4\u9500\u3001\u8F6E\u6362\u51ED\u636E\u5E76\u6E05\u7406\u5386\u53F2\u2014\u2014",
  "   \u53EA\u5220\u6587\u4EF6\u4E0D\u7B97\u5904\u7406\u5B8C\uFF0C\u51ED\u636E\u5728\u5386\u53F2\u91CC\u5C31\u8FD8\u5728\u3002",
  "4. \u6784\u5EFA\u4EA7\u7269\u4E0E\u8FD0\u884C\u65F6\u6570\u636E\u4E0D\u5165\u5E93\uFF1Adist/\u3001node_modules/\u3001\u8FD0\u884C\u65F6\u6570\u636E\u76EE\u5F55\u3002",
  "   \u5DF2\u7ECF\u88AB\u8DDF\u8E2A\u7684\u5148 git rm -r --cached\uFF0C\u518D\u8865 .gitignore\u3002"
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
    const hygiene = hygieneReport(root);
    health.push(...hygieneFindingLines(hygiene));
    const ratio = readmeChineseRatio(root);
    if (ratio !== null && ratio < MIN_CHINESE_RATIO) {
      health.push(`README.md \u7684\u4E2D\u6587\u5360\u6BD4\u4EC5 ${(ratio * 100).toFixed(0)}%\uFF1AREADME \u5FC5\u987B\u662F\u5168\u4E2D\u6587\u6587\u6863\u3002`, "");
    }
    if (health.length > 0) {
      lines.push("[repo-guardian] \u4ED3\u5E93\u5065\u5EB7\u68C0\u67E5\u7ED3\u679C\uFF1A", "", ...health);
      lines.push("\u4EE5\u4E0A\u53EA\u662F\u63D0\u793A\uFF0C\u4E0D\u662F\u963B\u585E\u3002\u5224\u65AD\u672C\u4ED3\u5E93\u786E\u5B9E\u4E0D\u9700\u8981\u67D0\u9879\u65F6\u76F4\u63A5\u8BF4\u660E\u7406\u7531\u7EE7\u7EED\u3002", "");
    }
  }
  if (lines.length > 0) lines.push("");
  lines.push(COMMENT_RULES);
  lines.push("");
  lines.push(HYGIENE_RULES);
  emit("SessionStart", { additionalContext: lines.join("\n") });
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
