/**
 * 代码规范检测：把全局规则里「机器可判定」的代码要求做成纯函数。
 *
 * 只收一条：硬编码绝对路径——写死 `C:\`、`Desktop`、`/Users/`、`/home/` 这类绝对位置。
 *
 * 为什么只有一条：注释规范那一整套在 comments.ts；而「运行时日志一律英文」这条
 * 试过之后撤掉了——它不可机器判定，理由见下面 chinese-log 的注释。其余要求
 * （路径工具封装、契约面宽类型的设计理由）需要看项目结构或语义，机器判不了，
 * 留在 AGENTS.md 与规范卡里。
 *
 * 宁缺毋滥：误报会持续吃掉上下文，比漏报更伤，所以每条都要求「只看新增文本」就能判定。
 */

import { isGeneratedOrSkipped, lineOf, scan } from "./scan";

export interface CodeHit {
  /** 规则 id：同一会话内按 id + 文件去重 */
  rule: string;
  /** 命中行号（1 起，相对传入文本） */
  line: number;
  /** 给模型看的一句话说明 */
  message: string;
}

const MESSAGES: Record<string, string> = {
  "hardcoded-path": "写死了绝对路径：改用项目封装的路径工具（paths.* / app.getPath()）或相对路径拼接。",
};

/**
 * 硬编码绝对路径。
 *
 * 只认「字符串字面量里出现绝对位置」：文档表格、注释里的示例路径不算（那些是在
 * 描述事实，不是在代码里写死）。所以先按字符串区间取内容再判。
 *
 * 盘符那条必须先排掉协议：`https://` 里 `s:/` 恰好满足「一个字母 + 冒号 + 斜杠」，
 * `ui://` 同理——不排会把所有 URL 判成硬编码路径（实测五个文件全中这一条）。
 *
 * 不收 `~` 展开与 `$HOME`：那类写法本就依赖运行时，不是硬编码。
 */
const PROTOCOL = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u;

const ABSOLUTE_PATH: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  // 盘符前面必须是串首、空白、引号或分隔符，且后面紧跟反斜杠或正斜杠
  { id: "windows-drive", pattern: /(?:^|[\s"'`(=,;])[A-Za-z]:[\\/]/u },
  // 只有「Desktop 出现在路径位置」才算：User-Agent 里的 `Loomy|Desktop|Electron`
  // 是产品标识，不是路径，按单词边界匹配会把它误报进来
  { id: "desktop", pattern: /(?:^|[\s"'`(=,;])Desktop[\\/]/u },
  { id: "posix-home", pattern: /\/(?:Users|home)\/[A-Za-z]/u },
  { id: "appdata", pattern: /(?:^|[\s"'`(=,;])AppData[\\/]/u },
];

function looksHardcodedPath(body: string): boolean {
  const t = body.trim();
  if (!t) return false;
  if (PROTOCOL.test(t)) return false; // URL，不是本地路径
  return ABSOLUTE_PATH.some((r) => r.pattern.test(t));
}

/**
 * 这些文件天然要写绝对路径：路径工具自身、测试夹具、配置样例。
 * 判据按路径片段，不按文件名——同名的 `paths.ts` 在别处也可能是普通模块。
 */
const PATH_RULE_EXEMPT = /(?:^|\/)(?:test|tests|__tests__|fixtures?|examples?|samples?)\//u;
const PATH_TOOL_FILE = /(?:^|\/)(?:paths?|path-utils|paths\.config)\.[cm]?[jt]sx?$/u;

function isPathRuleExempt(filePath: string): boolean {
  const p = filePath.replace(/\\/gu, "/");
  return PATH_RULE_EXEMPT.test(p) || PATH_TOOL_FILE.test(p);
}

/**
 * 「运行时日志一律英文」这条为什么不做成检测：
 *
 * 试过，实测不可判定。日志调用与面向用户的 CLI 报表写法完全一样——
 * `console.log("守护PID: …")` 既是运行时输出也可能是状态报表，靠词法分不开。
 * 按目录白名单（scripts/bin/cli）区分也不行：modelmux 的 daemon.ts、headless.ts
 * 都在 src 下，却全是给人看的中文报表，44 处命中里 43 处是这类误报。
 *
 * 要做对需要「这个 console.log 的输出流向终端用户还是日志文件」的信息，
 * 那要读整个项目的调用链，超出「只看新增文本」的边界。所以这条留在规范卡里，
 * 靠模型自觉——宁可漏，不可误报。
 */

export function checkCode(text: string, filePath: string): CodeHit[] {
  if (!text.trim()) return [];
  if (isGeneratedOrSkipped(text, filePath)) return [];

  const hits: CodeHit[] = [];
  const push = (rule: string, line: number): void => {
    const message = MESSAGES[rule];
    if (message) hits.push({ rule, line, message });
  };

  if (isPathRuleExempt(filePath)) return hits;

  // --- 硬编码路径：只看字符串字面量的内容 ---
  const { strings } = scan(text, filePath);
  for (const s of strings) {
    const body = text.slice(s.start + 1, Math.max(s.start + 1, s.end - 1));
    // 注释里、文档里的路径不在此列：这里只取字符串区间
    if (looksHardcodedPath(body)) {
      push("hardcoded-path", lineOf(text, s.start));
      break; // 同一文件只报一次，够模型定位就够了
    }
  }

  return hits;
}
