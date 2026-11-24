// 本文件由 scripts/build.mjs 从 external_plugins/repo-guardian/src/audit.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/repo-guardian/src/lib/hook.ts
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

// external_plugins/repo-guardian/src/audit.ts
var RULE_TITLES = {
  credentials: "\u89C4\u5219 2\uFF5C\u51ED\u636E\u4E0D\u5165\u5E93",
  eol: "\u89C4\u5219 1\uFF5C\u6362\u884C\u7B26\u4E0E .gitattributes",
  artifacts: "\u89C4\u5219 4\uFF5C\u6784\u5EFA\u4EA7\u7269\u4E0E\u8FD0\u884C\u65F6\u6570\u636E"
};
var PRECHECK = {
  title: "\u89C4\u5219 3\uFF5C\u63D0\u4EA4\u524D\u81EA\u67E5",
  ok: true,
  lines: [
    "\u6BCF\u6B21 `git commit` \u524D\u8DD1\uFF1A",
    "  1. git status \u2014\u2014 \u6709\u6CA1\u6709\u8BE5\u5FFD\u7565\u5374\u6CA1\u5FFD\u7565\u7684\u6587\u4EF6\u3001\u6709\u6CA1\u6709\u4E34\u65F6\u4EA7\u7269\u8DDF\u7740\u8FDB\u6765",
    "  2. git diff --cached \u2014\u2014 \u9010\u6761\u770B\u8FC7\u8981\u63D0\u4EA4\u7684\u5185\u5BB9",
    "  3. \u654F\u611F\u8BCD\u626B\u63CF \u2014\u2014 apikey / accesskey / secret / token / password / private key / AKIA / \u8FDE\u63A5\u4E32",
    "  4. \u4E00\u4E2A commit = \u4E00\u4EF6\u5B8C\u6574\u7684\u903B\u8F91",
    "\u8BEF\u63D0\u4EA4\u51ED\u636E\uFF1A\u64A4\u9500\u63D0\u4EA4 \u2192 \u8F6E\u6362\u51ED\u636E \u2192 \u6E05\u7406\u5386\u53F2\u3002\u53EA\u5220\u6587\u4EF6\u4E0D\u7B97\u5904\u7406\u5B8C\u3002"
  ]
};
function buildSections(root) {
  const report = hygieneReport(root);
  const findings = hygieneFindings(report);
  const byRule = new Map(findings.map((f) => [f.rule, f]));
  const sections = [
    {
      title: RULE_TITLES.eol,
      ok: !byRule.has("eol"),
      lines: byRule.get("eol")?.lines ?? [
        `\u901A\u8FC7\uFF1A.gitattributes \u542B \`${REQUIRED_GITATTRIBUTES_LINE}\`\uFF0C\u5DF2\u5165\u5E93\u6587\u672C\u6CA1\u6709 CRLF\u3002`
      ]
    },
    {
      title: RULE_TITLES.credentials,
      ok: !byRule.has("credentials"),
      lines: byRule.get("credentials")?.lines ?? ["\u901A\u8FC7\uFF1A\u6CA1\u6709\u51ED\u636E\u5F62\u6001\u7684\u6587\u4EF6\u5165\u5E93\u6216\u88F8\u5954\u3002"]
    },
    PRECHECK,
    {
      title: RULE_TITLES.artifacts,
      ok: !byRule.has("artifacts"),
      lines: byRule.get("artifacts")?.lines ?? [
        `\u901A\u8FC7\uFF1A\u6CA1\u6709\u6784\u5EFA\u4EA7\u7269\u5165\u5E93\uFF0C.gitignore \u8986\u76D6\u4E86 ${REQUIRED_IGNORE_ENTRIES.join("\u3001")}\u3002`
      ]
    },
    {
      title: "\u9644\uFF5CCI \u5B58\u5728\u6027",
      ok: hasCI(root),
      lines: hasCI(root) ? ["\u901A\u8FC7\uFF1A.github/workflows/ \u4E0B\u6709 workflow\u3002"] : ["\u672A\u901A\u8FC7\uFF1A\u4ED3\u5E93\u6CA1\u6709 CI\u3002\u5EFA\u8BAE\u8865\u4E00\u4E2A\u6700\u5C0F workflow\uFF0C\u81F3\u5C11\u8DD1\u6784\u5EFA\u4E0E\u6D4B\u8BD5\u3002"]
    }
  ];
  return sections;
}
function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const target = args.find((a) => !a.startsWith("--"));
  if (args.some((a) => a === "-h" || a === "--help")) {
    process.stdout.write("\u7528\u6CD5\uFF1Anode audit.mjs [--json] [\u4ED3\u5E93\u8DEF\u5F84]\n");
    return;
  }
  const root = findRepoRoot(target ?? cwdOf({}));
  if (!root) {
    process.stderr.write("\u4E0D\u5728 git \u4ED3\u5E93\u5185\uFF0C\u65E0\u6CD5\u5BA1\u8BA1\u3002\n");
    process.exitCode = 2;
    return;
  }
  const sections = buildSections(root);
  const failed = sections.filter((s) => !s.ok);
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ root, ok: failed.length === 0, sections }, null, 2)}
`);
    process.exitCode = failed.length === 0 ? 0 : 1;
    return;
  }
  process.stdout.write(`\u4ED3\u5E93\u536B\u751F\u5BA1\u8BA1\uFF1A${root}

`);
  for (const s of sections) {
    process.stdout.write(`${s.ok ? "[\u901A\u8FC7]   " : "[\u672A\u901A\u8FC7] "}${s.title}
`);
    for (const line of s.lines) process.stdout.write(`  ${line}
`);
    process.stdout.write("\n");
  }
  process.stdout.write(
    failed.length === 0 ? "\u5168\u90E8\u901A\u8FC7\u3002\n" : `\u5408\u8BA1 ${failed.length} \u9879\u672A\u901A\u8FC7\uFF1A${failed.map((f) => f.title).join("\u3001")}
`
  );
  process.exitCode = failed.length === 0 ? 0 : 1;
}
main();
