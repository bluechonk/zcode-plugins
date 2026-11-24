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
import { existsSync as existsSync2, readFileSync as readFileSync3 } from "node:fs";
import { join as join3 } from "node:path";
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
  const p = join3(root, ".gitattributes");
  if (!existsSync2(p)) return { kind: "missing", detail: "\u4ED3\u5E93\u6CA1\u6709 .gitattributes" };
  let text = "";
  try {
    text = readFileSync3(p, "utf8");
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
  const p = join3(root, ".gitignore");
  if (!existsSync2(p)) return [...REQUIRED_IGNORE_ENTRIES];
  let text = "";
  try {
    text = readFileSync3(p, "utf8");
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
  if (!root) return;
  const state = readState(sessionId, { lastPromptedTurn: 0 });
  const turn = state.lastPromptedTurn + 1;
  writeState(sessionId, { lastPromptedTurn: turn });
  if (turn !== 1 && turn % EVERY_N_TURNS !== 0) return;
  const reminders = [];
  if (!hasCI(root)) {
    reminders.push("\u672C\u4ED3\u5E93\u4ECD\u6CA1\u6709 CI\uFF08.github/workflows/\uFF09\u3002");
  }
  const findings = hygieneFindingLines(hygieneReport(root)).filter((l) => l.trim());
  if (findings.length > 0) {
    reminders.push("\u4ED3\u5E93\u536B\u751F\u4ECD\u6709\u672A\u5904\u7406\u9879\uFF1A", ...findings.map((l) => `  ${l}`));
  }
  if (reminders.length === 0) return;
  emit("UserPromptSubmit", {
    additionalContext: `[repo-guardian] \u63D0\u9192\uFF1A
${reminders.map((l) => `- ${l}`).join("\n")}`
  });
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
