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

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/u;

/**
 * bash 内建（echo / printf）把中文输出到 stdout。
 *
 * 为什么单独立一条：ZCode 的 Bash 输出捕获层按系统代码页（本机 936/GBK）解码，
 * 而 bash 内建输出的是 UTF-8 字节——两者不一致，中文必然乱码（实测：
 * `echo "停后"` 显示成「鍋滃悗」）。外部程序（curl -w 等）按代码页输出，反而正常。
 *
 * 判据刻意收窄，避免变成「见中文就报」：
 *   - 命令含中文，且某一行是 echo / printf 且没有重定向到文件
 *     （`echo "中文" > f` 写进文件是 UTF-8，不受影响）
 *   - 已经出现过 iconv 就不再提示（模型可能已自行处理）
 *   - pwsh 脚本不在此列：PowerShell 输出中文正常
 */
export function bashChineseStdout(command: string): boolean {
  if (!CJK.test(command)) return false;
  if (/iconv/.test(command)) return false;
  for (const raw of command.split("\n")) {
    const line = raw.trim();
    if (!CJK.test(line)) continue;
    if (!/(?:^|[;&|]\s*|\bthen\s+|\bdo\s+|\{\s*)echo\b|\bprintf\b/iu.test(line)) continue;
    if (/>\s*\S/u.test(line)) continue; // 重定向到文件：中文进文件，不经捕获层解码
    return true;
  }
  return false;
}

/**
 * 凭据形态的文件名。
 *
 * 只收「一看就是凭据」的形态，不收「可能是配置」的宽泛名字：
 * config.json 之类误报率太高，报一次就要模型花一轮去解释。
 * `.env.example` / `.env.sample` / `.env.template` 是模板，明确排除。
 */
const CREDENTIAL_NAME =
  /(?:^|\/)(?:\.env\.(?:local|dev|development|prod|production|test|ci|stage|staging)$|\.env$|[^/]*\.(?:pem|key|p12|pfx|jks|keystore|kdbx)$|id_rsa(?:$|[._2]|\.pub)|id_ed2519(?:$|[._2])|\.htpasswd$|credentials$|service-account(?:[-.][^/]*)?\.json$|secrets?\.ya?ml$)/iu;
const CREDENTIAL_TEMPLATE = /(?:^|\/)\.env\.(?:example|sample|template|dist)$/iu;

export function isCredentialPath(filePath: string): boolean {
  const p = filePath.replace(/\\/gu, "/");
  if (CREDENTIAL_TEMPLATE.test(p)) return false;
  return CREDENTIAL_NAME.test(p);
}

/** 构建产物与运行时数据的路径形态 */
const ARTIFACT_DIR =
  /^(?:node_modules|dist|build|out|coverage|target|bin|obj|\.next|\.nuxt|\.turbo|__pycache__|\.venv|venv|env)\//iu;
const ARTIFACT_FILE = /(?:\.tsbuildinfo|\.pyc|\.pyo|\.o|\.a|\.lib|\.exp|\.map)$/iu;

export function isArtifactPath(filePath: string): boolean {
  const p = filePath.replace(/\\/gu, "/");
  return ARTIFACT_DIR.test(p) || ARTIFACT_FILE.test(p);
}

export interface GitCommandInfo {
  /** 命令链里最高优先级的意图：提交、暂存、推送、改写历史 */
  intent: "commit" | "add" | "push" | "history-rewrite" | null;
  /** `git add` 的目标路径（不含选项） */
  addTargets: string[];
  /** `git add -f` / `--force`：把被忽略的文件硬塞进来 */
  forceAdd: boolean;
  /** `git push --force` 及等价写法 */
  forcePush: boolean;
  /** filter-branch / filter-repo / BFG：改写历史的命令 */
  historyRewrite: boolean;
}

/** 按 && / || / ; / | / 换行 把命令链拆成单条 */
function segments(command: string): string[] {
  return command
    .split(/(?:&&|\|\||;|\||\n)/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** `git` 可能带路径前缀或选项出现在段首，取到子命令名 */
function gitSubcommand(segment: string): string[] | null {
  const tokens = segment.split(/\s+/u);
  const gitIndex = tokens.findIndex((t) => t === "git" || t.endsWith("/git") || t.endsWith("git.exe"));
  if (gitIndex < 0) return null;
  return tokens.slice(gitIndex + 1);
}

/**
 * 识别这条命令链里的 git 意图。
 *
 * 提交前自查（git status / diff / 敏感词扫描）只能在「模型要提交」这一刻提醒才有用，
 * 所以得从命令里认出 commit / add / push，而不是凭空每轮都说一遍。
 */
export function analyzeGitCommand(command: string): GitCommandInfo {
  const info: GitCommandInfo = {
    intent: null,
    addTargets: [],
    forceAdd: false,
    forcePush: false,
    historyRewrite: false,
  };

  for (const seg of segments(command)) {
    const rest = gitSubcommand(seg);
    if (!rest || rest.length === 0) continue;
    const sub = rest[0] ?? "";

    if (sub === "commit") {
      info.intent = info.intent ?? "commit";
    } else if (sub === "add") {
      info.intent = info.intent ?? "add";
      if (rest.some((t) => t === "-f" || t === "--force")) info.forceAdd = true;
      for (const t of rest.slice(1)) if (!t.startsWith("-")) info.addTargets.push(t);
    } else if (sub === "push") {
      info.intent = info.intent ?? "push";
      if (rest.some((t) => t === "-f" || t === "--force" || t === "--force-with-lease=false")) {
        info.forcePush = true;
      }
    } else if (sub === "filter-branch" || sub === "filter-repo") {
      info.historyRewrite = true;
      info.intent = info.intent ?? "history-rewrite";
    }
  }

  // BFG 是独立可执行文件或 java -jar，不是 git 子命令；只认「命令位置上的 bfg」
  // 与任意位置的 bfg\*.jar，避免把路径里恰好含 bfg 的文件误判
  for (const seg of segments(command)) {
    const first = (seg.split(/\s+/u)[0] ?? "").toLowerCase();
    if (first === "bfg" || first.endsWith("/bfg") || first.endsWith("\\bfg")) {
      info.historyRewrite = true;
      break;
    }
  }
  if (!info.historyRewrite && /bfg[\w.-]*\.jar/iu.test(command)) info.historyRewrite = true;
  if (info.historyRewrite) info.intent = info.intent ?? "history-rewrite";

  return info;
}

