/**
 * 检测纯函数：仓库健康与本机规则。
 *
 * 全部只做只读判断，不抛异常——任何检测失败都按「未命中」处理，
 * 宁可漏报也不误伤。检测项集中在 AGENTS.md 里「机器可判定」的那部分规则。
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** 用 git 定位仓库根：monorepo 场景下 cwd 可能只是子目录 */
export function findRepoRoot(cwd: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/** CI：.github/workflows/ 下有 yml/yaml 才算 */
export function hasCI(root: string): boolean {
  const dir = join(root, ".github", "workflows");
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).some((f) => /\.ya?ml$/iu.test(f));
  } catch {
    return false;
  }
}

export function hasGitattributes(root: string): boolean {
  return existsSync(join(root, ".gitattributes"));
}

/** README 的中文占比；读不到返回 null */
export function readmeChineseRatio(root: string): number | null {
  const p = join(root, "README.md");
  if (!existsSync(p)) return null;
  try {
    const text = readFileSync(p, "utf8");
    const chars = [...text.replace(/\s+/gu, "")];
    if (chars.length === 0) return 0;
    let cjk = 0;
    for (const c of chars) {
      const cp = c.codePointAt(0) ?? 0;
      if (cp >= 0x4e00 && cp <= 0x9fff) cjk += 1;
    }
    return cjk / chars.length;
  } catch {
    return null;
  }
}

/** emoji 判定用 Unicode 官方属性，覆盖变体选择器与组合序列 */
const EMOJI = /\p{Extended_Pictographic}/u;

export function containsEmoji(text: string): boolean {
  return EMOJI.test(text);
}

/**
 * .ps1 写到 .tmp/ 之外。
 * AGENTS.md 只对 .ps1 明确规定「落点 .tmp/」；其他脚本扩展名是正常源码，
 * 用宽泛的「所有脚本」判据会把 src/ 下的业务代码全判成违规（实测踩过）。
 */
export function tempScriptOutsideTmp(filePath: string): boolean {
  const normalized = filePath.replace(/\\/gu, "/");
  if (normalized.startsWith(".tmp/") || normalized.includes("/.tmp/")) return false;
  return /\.ps1$/iu.test(normalized);
}

/**
 * 禁用命令：只匹配「命令位置」——行首，或 && / || / ; / | 之后。
 * 这样 `echo "pip install"` 或注释里的 `pip install` 不会误伤。
 */
const FORBIDDEN: ReadonlyArray<{ id: string; pattern: RegExp; message: string }> = [
  {
    id: "powershell.exe",
    pattern: /(?:^|&&|\|\||;|\|)\s*(?:[A-Za-z]:[\\/][^\s]*[\\/])?powershell\.exe\b/iu,
    message: "禁用 powershell.exe：只用 PowerShell 7（pwsh）",
  },
  {
    id: "cmd.exe",
    pattern: /(?:^|&&|\|\||;|\|)\s*(?:[A-Za-z]:[\\/][^\s]*[\\/])?cmd\.exe\b/iu,
    message: "禁用 cmd",
  },
  {
    id: "pip-install",
    pattern: /(?:^|&&|\|\||;|\|)\s*(?:[A-Za-z]:[\\/][^\s]*[\\/])?pip3?\s+install\b/iu,
    message: "禁用 pip install：Python 一律 uv",
  },
  {
    id: "poetry",
    pattern: /(?:^|&&|\|\||;|\|)\s*poetry\s+(?:add|install|update|remove|init|new)\b/iu,
    message: "禁用 poetry：Python 一律 uv",
  },
  {
    id: "conda",
    pattern: /(?:^|&&|\|\||;|\|)\s*conda\s+(?:install|create|env|activate)\b/iu,
    message: "禁用 conda：Python 一律 uv",
  },
];

export function findForbiddenCommand(command: string): { id: string; message: string } | null {
  for (const rule of FORBIDDEN) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(command)) return { id: rule.id, message: rule.message };
  }
  return null;
}
