/**
 * 仓库卫生检测：把「编码 / 仓库卫生」四条规则里机器可判定的部分做成纯函数。
 *
 * 与 lib/detect.ts 的分工：detect 判的是「单个动作」（一条命令、一次写入），
 * 这里判的是「仓库状态」——要看 git 索引与工作树才看得出来，只能在会话启动
 * 或显式审计时跑一次。
 *
 * 全部只读、不抛异常：任何 git 调用失败都按「未命中」处理。宁可漏报，
 * 也不因为一次 git 超时就往上下文里塞一段错误的指控。
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isArtifactPath, isCredentialPath } from "./detect";

/** 规则要求的唯一硬指标：这一行不在，.gitattributes 就等于没有 */
export const REQUIRED_GITATTRIBUTES_LINE = "* text=auto eol=lf";

/** .gitignore 必须覆盖的构建产物目录 */
export const REQUIRED_IGNORE_ENTRIES = ["node_modules/", "dist/"];

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 32 * 1024 * 1024,
      timeout: 8000,
    });
  } catch {
    return null;
  }
}

function nul(text: string): string[] {
  return text.split("\0").map((s) => s.trim()).filter(Boolean);
}

/** 路径归一成正斜杠，便于跨平台比对与展示 */
function posix(p: string): string {
  return p.replace(/\\/gu, "/");
}

export interface GitattributesIssue {
  kind: "missing" | "no-lf-rule";
  detail: string;
}

/**
 * `.gitattributes` 的存在与内容。
 *
 * 只查 `* text=auto eol=lf` 这一行：规则写的是「至少包含」，
 * 文件里有别的属性但缺这行，同样算没达标。
 */
export function gitattributesIssue(root: string): GitattributesIssue | null {
  const p = join(root, ".gitattributes");
  if (!existsSync(p)) return { kind: "missing", detail: "仓库没有 .gitattributes" };
  let text = "";
  try {
    text = readFileSync(p, "utf8");
  } catch {
    return null; // 读不动就当作已知，别拿一次 IO 失败当违规
  }
  const has = text
    .split(/\r?\n/u)
    .some((line) => line.trim() === REQUIRED_GITATTRIBUTES_LINE);
  return has ? null : { kind: "no-lf-rule", detail: ".gitattributes 缺少 `* text=auto eol=lf`" };
}

/**
 * 已入库的 CRLF 文本文件。
 *
 * 判据取索引侧（`i/crlf`）而不是工作树侧：工作树里出现 CRLF 可能只是本机
 * core.autocrlf 的结果，规则管的是「仓库内文本文件一律 LF」。
 * `-text`（二进制）不参与判定。
 */
export function crlfTrackedFiles(root: string, limit = 20): string[] {
  const out = git(root, ["ls-files", "--eol", "-z"]);
  if (!out) return [];
  const hits: string[] = [];
  // -z 的记录形如 `i/lf  w/lf  attr/text=auto eol=lf\tpath\0`：
  // attr 里可以有空格，所以字段边界只能靠那个制表符切，不能按空白 split
  for (const record of out.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [indexState] = record.slice(0, tab).trim().split(/\s+/u);
    const path = record.slice(tab + 1);
    // i/-text 是二进制，换行符不归规则管
    if (indexState === "i/crlf") hits.push(posix(path));
    if (hits.length >= limit) break;
  }
  return hits;
}

/** 已入库的构建产物与运行时数据 */
export function trackedArtifacts(root: string, limit = 20): string[] {
  const out = git(root, ["ls-files", "-z"]);
  if (!out) return [];
  const hits = nul(out).filter(isArtifactPath);
  return hits.slice(0, limit);
}

export interface CredentialScan {
  /** 已经提交进仓库的凭据文件——需要撤销、轮换并清理历史 */
  tracked: string[];
  /** 工作树里存在、但 .gitignore 没盖住的凭据文件——下一步就会提交上去 */
  atRisk: string[];
}

/**
 * 凭据文件盘点。
 *
 * atRisk 用 `--exclude-standard`：被 .gitignore 盖住的不会出现在结果里，
 * 于是「出现在这里」等价于「没被忽略、随时可能被顺手提交」。
 */
export function credentialFiles(root: string, limit = 20): CredentialScan {
  const trackedRaw = git(root, ["ls-files", "-z"]);
  const othersRaw = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const tracked = trackedRaw ? nul(trackedRaw).filter(isCredentialPath).slice(0, limit) : [];
  const atRisk = othersRaw ? nul(othersRaw).filter(isCredentialPath).slice(0, limit) : [];
  return { tracked, atRisk };
}

/** .gitignore 里缺哪些必需条目；没有 .gitignore 时全部算缺 */
export function missingIgnoreEntries(root: string): string[] {
  const p = join(root, ".gitignore");
  if (!existsSync(p)) return [...REQUIRED_IGNORE_ENTRIES];
  let text = "";
  try {
    text = readFileSync(p, "utf8");
  } catch {
    return [];
  }
  const lines = new Set(
    text
      .split(/\r?\n/u)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
  );
  // 收 node_modules 与 node_modules/ 两种写法：斜杠只表示「仅目录」，规则本意两者都算覆盖
  return REQUIRED_IGNORE_ENTRIES.filter((e) => !lines.has(e) && !lines.has(e.replace(/\/$/u, "")));
}

export interface HygieneReport {
  root: string;
  gitattributes: GitattributesIssue | null;
  crlfFiles: string[];
  artifacts: string[];
  credentials: CredentialScan;
  missingIgnores: string[];
}

/** 一次跑完四项，供 SessionStart、UserPromptSubmit 重申与 audit 命令共用 */
export function hygieneReport(root: string): HygieneReport {
  return {
    root,
    gitattributes: gitattributesIssue(root),
    crlfFiles: crlfTrackedFiles(root),
    artifacts: trackedArtifacts(root),
    credentials: credentialFiles(root),
    missingIgnores: missingIgnoreEntries(root),
  };
}

export function hasHygieneProblem(r: HygieneReport): boolean {
  return Boolean(
    r.gitattributes ||
      r.crlfFiles.length ||
      r.artifacts.length ||
      r.credentials.tracked.length ||
      r.credentials.atRisk.length ||
      r.missingIgnores.length
  );
}

/** 一条卫生问题：rule 用于让 hook 与审计命令按同一条规则归组，不再各写一套判据 */
export interface HygieneFinding {
  rule: "credentials" | "eol" | "artifacts";
  lines: string[];
}

/**
 * 把报告转成条目化中文文案。
 *
 * 排序按「处置代价」从重到轻：已提交的凭据要清历史并轮换，最贵；
 * .gitattributes 与 .gitignore 是一次性补齐；CRLF 与产物入库要改提交。
 * 审计命令与 hook 注入共用这份文案，避免两处各写一套措辞。
 */
export function hygieneFindings(r: HygieneReport): HygieneFinding[] {
  const findings: HygieneFinding[] = [];

  const credentialLines: string[] = [];
  if (r.credentials.tracked.length) {
    credentialLines.push(
      `凭据已入库（${r.credentials.tracked.length} 个）：${r.credentials.tracked.join(", ")}`,
      "   处置：立即撤销并轮换这些凭据，再从历史里清除（git filter-repo 或 BFG），最后 force push。"
    );
  }
  if (r.credentials.atRisk.length) {
    credentialLines.push(
      `凭据文件未被 .gitignore 覆盖（${r.credentials.atRisk.length} 个）：${r.credentials.atRisk.join(", ")}`,
      "   处置：加进 .gitignore；内容改走环境变量或密钥管理服务。"
    );
  }
  if (credentialLines.length) findings.push({ rule: "credentials", lines: credentialLines });

  const eolLines: string[] = [];
  if (r.gitattributes) {
    eolLines.push(
      r.gitattributes.kind === "missing"
        ? `缺少 .gitattributes：至少要有 \`${REQUIRED_GITATTRIBUTES_LINE}\``
        : r.gitattributes.detail
    );
  }
  if (r.crlfFiles.length) {
    eolLines.push(
      `已入库的文本文件带 CRLF（${r.crlfFiles.length} 个）：${r.crlfFiles.join(", ")}`,
      "   处置：补 .gitattributes 后 git add --renormalize . 一次性归一。"
    );
  }
  if (eolLines.length) findings.push({ rule: "eol", lines: eolLines });

  const artifactLines: string[] = [];
  if (r.missingIgnores.length) {
    artifactLines.push(`.gitignore 缺少条目：${r.missingIgnores.join(", ")}`);
  }
  if (r.artifacts.length) {
    artifactLines.push(
      `构建产物或运行时数据已入库（${r.artifacts.length} 个）：${r.artifacts.join(", ")}`,
      "   处置：git rm -r --cached 后加进 .gitignore。"
    );
  }
  if (artifactLines.length) findings.push({ rule: "artifacts", lines: artifactLines });

  return findings;
}

/** 摊平成 hook 注入用的纯文本行 */
export function hygieneFindingLines(r: HygieneReport): string[] {
  return hygieneFindings(r).flatMap((f) => [...f.lines, ""]);
}
