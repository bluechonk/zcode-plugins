/**
 * 词法扫描：注释区间、字符串区间、以及剥掉两者后的代码文本。
 *
 * 独立成模块是因为有两类规则都要它：注释规范（只看注释内容）与代码规范
 * （只看代码、必须先把注释与字符串屏蔽掉）。两处各写一份会漂移。
 *
 * 逐字符走而不是按行正则：`url("http://x")` 里的 `//`、`"a # b"` 里的 `#`
 * 都会让按行正则误判成注释开始。
 */

const JS_LIKE = new Set([
  "ts", "tsx", "mts", "cts",
  "js", "jsx", "mjs", "cjs",
  "java", "go", "rs", "c", "h", "cc", "cpp", "hpp", "cs",
  "swift", "kt", "kts", "scala", "php", "dart", "proto",
]);
const BLOCK_ONLY = new Set(["css", "scss", "less"]);
const HASH_LIKE = new Set([
  "py", "pyi", "sh", "bash", "zsh", "fish",
  "yml", "yaml", "toml", "ini", "cfg", "conf", "properties",
  "ps1", "psm1", "rb", "pl", "pm", "r", "tf", "hcl",
  "gitignore", "gitattributes", "env",
]);
const HTML_LIKE = new Set(["html", "htm", "xml", "svg", "vue", "md", "markdown"]);
const DASH_LIKE = new Set(["sql", "lua"]);

interface LineMarker {
  mark: string;
  /** 需要前面是空白或行首才算注释：`#` 与 `--` 不设界限时，URL 片段会被误判 */
  boundary: boolean;
}

export function extOf(filePath: string): string {
  const base = (filePath.replace(/\\/gu, "/").split("/").pop() ?? "").toLowerCase();
  return base.includes(".") ? (base.split(".").pop() ?? "") : "";
}

export function isJsLike(filePath: string): boolean {
  return JS_LIKE.has(extOf(filePath));
}

function markersFor(filePath: string): { line: LineMarker[]; block: Array<[string, string]> } {
  const base = (filePath.replace(/\\/gu, "/").split("/").pop() ?? "").toLowerCase();
  const ext = extOf(filePath);
  if (HTML_LIKE.has(ext)) return { line: [], block: [["<!--", "-->"]] };
  if (HASH_LIKE.has(ext) || base === "dockerfile" || base === "makefile") {
    return { line: [{ mark: "#", boundary: true }], block: [] };
  }
  if (DASH_LIKE.has(ext)) return { line: [{ mark: "--", boundary: true }], block: [["--[[", "]]"]] };
  if (BLOCK_ONLY.has(ext)) return { line: [], block: [["/*", "*/"]] };
  if (JS_LIKE.has(ext)) return { line: [{ mark: "//", boundary: false }], block: [["/*", "*/"]] };
  return { line: [{ mark: "//", boundary: false }], block: [["/*", "*/"]] };
}

export interface CommentRange {
  start: number;
  end: number;
  bodyStart: number;
  bodyEnd: number;
  line: number;
  kind: "line" | "block";
}

export interface ScanResult {
  comments: CommentRange[];
  /** 字符串字面量区间：扫代码层规则时要一起屏蔽，否则字符串里的 `catch {}` 会被当真代码 */
  strings: Array<{ start: number; end: number }>;
}

function isBoundary(ch: string | undefined): boolean {
  return ch === undefined || /\s/u.test(ch);
}

/**
 * 扫描注释与字符串。
 *
 * 模板字符串跨行合法，所以反引号状态跨换行保留（仅 JS 系语言）；
 * 单引号与双引号不跨行，遇换行即结束。
 *
 * `//` 前面是冒号或反斜杠时不算注释：前者是 `https://`，后者是正则里的转义斜杠——
 * 少了这条守卫，`/^https?:\/\//u` 里「转义斜杠 + 闭合斜杠」会拼出一个假注释。
 */
export function scan(text: string, filePath: string): ScanResult {
  const { line: lineMarks, block: blockMarks } = markersFor(filePath);
  const jsLike = JS_LIKE.has(extOf(filePath));
  const comments: CommentRange[] = [];
  const strings: Array<{ start: number; end: number }> = [];
  const newlinesUpTo = (from: number, to: number): number => {
    let n = 0;
    for (let k = from; k < to; k += 1) if (text[k] === "\n") n += 1;
    return n;
  };

  let i = 0;
  let line = 1;

  // shebang 不是注释，先跳过，否则 `#!/usr/bin/env bash` 会被当成英文注释
  if (text.startsWith("#!")) {
    const eol = text.indexOf("\n");
    i = eol === -1 ? text.length : eol;
  }

  while (i < text.length) {
    const c = text[i] ?? "";
    if (c === "\n") {
      line += 1;
      i += 1;
      continue;
    }

    if (c === '"' || c === "'" || c === "`") {
      const multiline = c === "`" && jsLike;
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === c) break;
        if (text[j] === "\n" && !multiline) break;
        j += 1;
      }
      const end = Math.min(j + 1, text.length);
      strings.push({ start: i, end });
      line += newlinesUpTo(i, end);
      i = end;
      continue;
    }

    const block = blockMarks.find(([open]) => text.startsWith(open, i));
    if (block) {
      const [open, close] = block;
      const found = text.indexOf(close, i + open.length);
      const bodyEnd = found === -1 ? text.length : found;
      const end = found === -1 ? text.length : found + close.length;
      comments.push({ start: i, end, bodyStart: i + open.length, bodyEnd, line, kind: "block" });
      line += newlinesUpTo(i, end);
      i = end;
      continue;
    }

    const prev = text[i - 1];
    const lm = lineMarks.find(
      (m) =>
        text.startsWith(m.mark, i) &&
        (!m.boundary || isBoundary(prev)) &&
        !(m.mark === "//" && (prev === ":" || prev === "\\"))
    );
    if (lm) {
      const found = text.indexOf("\n", i);
      const end = found === -1 ? text.length : found;
      comments.push({ start: i, end, bodyStart: i + lm.mark.length, bodyEnd: end, line, kind: "line" });
      i = end;
      continue;
    }

    i += 1;
  }
  return { comments, strings };
}

/**
 * 把注释与字符串整段换成等长空白，保留换行——行号与偏移都不变，可以直接拿去扫代码层规则。
 *
 * 用 split("") 而不是 [...text]：后者按码位切分，遇到代理对会让下标与 UTF-16 偏移脱节，
 * 之后按偏移回原串取文本就会错位。
 */
export function stripCommentsAndStrings(text: string, filePath: string): string {
  const chars = text.split("");
  const { comments, strings } = scan(text, filePath);
  for (const r of [...comments, ...strings]) {
    for (let k = r.start; k < r.end; k += 1) {
      if (chars[k] !== "\n") chars[k] = " ";
    }
  }
  return chars.join("");
}

/** 把字符串字面量的内容也换成空白，但保留引号——用于「字符串里写了什么」这类判断 */
export function blankStringBodies(text: string, filePath: string): string {
  const chars = text.split("");
  const { strings } = scan(text, filePath);
  for (const r of strings) {
    // 保留首尾引号，中间置空
    for (let k = r.start + 1; k < r.end - 1; k += 1) {
      if (chars[k] !== "\n") chars[k] = " ";
    }
  }
  return chars.join("");
}

export function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text[i] === "\n") line += 1;
  return line;
}

export function shouldSkipFile(filePath: string): boolean {
  const p = filePath.replace(/\\/gu, "/");
  if (/(?:^|\/)(?:node_modules|dist|build|out|coverage)\//u.test(p)) return true;
  // .tmp/ 是诊断脚本的落点，按全局规则「不算正式产物」，不套正式文档与代码规范
  if (/(?:^|\/)\.tmp\//u.test(p)) return true;
  if (/\.min\.(?:js|css)$/u.test(p)) return true;
  if (/(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/u.test(p)) return true;
  if (/\.(?:svg|png|jpe?g|gif|ico|woff2?|ttf|eot|pdf|zip|gz|map)$/iu.test(p)) return true;
  return false;
}

/** 构建产物：banner 明写「不要直接编辑本文件」，模型不该手写它，逐行核对没有意义 */
export const GENERATED_BANNER = /本文件由 scripts\/build\.mjs 从/u;

/** 是否该整体跳过（目录、二进制、构建产物） */
export function isGeneratedOrSkipped(text: string, filePath: string): boolean {
  if (shouldSkipFile(filePath)) return true;
  return GENERATED_BANNER.test(text.slice(0, 300));
}
