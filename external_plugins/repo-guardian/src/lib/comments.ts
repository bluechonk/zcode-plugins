/**
 * 注释规范检测：把全局规则里「机器可判定」的注释要求做成纯函数。
 *
 * 为什么下沉到这里：那些规则原本常驻 AGENTS.md，每轮都在上下文里，却只在改代码时才有意义。
 * 这里在写入之后立刻扫一遍新增文本，把命中项摆到模型面前。
 *
 * 宁缺毋滥：误报会持续吃掉上下文，比漏报更伤，所以每条规则都要求「只看新增文本」就能判定，
 * 拿不准的一律不报。全部只读、不抛异常，解析失败按未命中处理。
 */

export interface CommentHit {
  /** 规则 id：同一会话内按 id + 文件去重 */
  rule: string;
  /** 命中行号（1 起，相对传入文本） */
  line: number;
  /** 给模型看的一句话说明 */
  message: string;
}

import { GENERATED_BANNER, lineOf, scan, shouldSkipFile, stripCommentsAndStrings, type CommentRange } from "./scan";

/**
 * 中文证据：汉字之外还算中文标点、全角字符与中文排版专用的破折号/引号。
 *
 * 中文注释里天然夹着命令、URL、JSON 片段，那些行可能一个汉字都没有；
 * 若按「这行有没有汉字」判，它们会被全打成违规。
 */
const CJK = /[\u2010-\u2027\u2030-\u205e\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/u;

/** 源码里写成 `\u6CA1` 转义的中文：解码后再判，否则整段中文注释会被当成纯英文 */
function decodeUnicodeEscapes(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/gu, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

/** 注释开头的结构化标记：它们有固定语法，不适用「注释必须中文」 */
const DIRECTIVE =
  /^(?:@ts-(?:ignore|expect-error|nocheck)|eslint|prettier|oxlint|biome|stylelint|TODO\(|FIXME\(|@deprecated\b|\*\s*@|\/?\s*<(?:reference|amd-module)\b)/iu;

const AUTHOR = /(?:@author\b|\bauthor\s*[:：]|(?:作者|撰写|编写|审批|审核|复核|签核)\s*[:：]|\b(?:approved|reviewed|signed\s*off)\s+by\b)/iu;

/**
 * 修订记录。
 *
 * 限定在注释开头（允许前面带日期）：`修订记录` / `更新日志` 这类是标题式的，
 * 而正文里出现的「变更说明」是普通名词，不加锚点会把它一并误报。
 * 名词只收「记录 / 历史 / 日志」，不收「说明」——后者歧义太大。
 */
const REVISION = /^(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s*)?(?:修订|修改|变更|更新|改动)\s*(?:记录|历史|日志)(?:\s*[:：].*)?$/u;
const REVISION_EN = /^(?:changelog|change\s+history|revision\s+history)\b/iu;
const DATE = /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{4}\b/u;
/**
 * 日期旁边的动作词。
 *
 * 日期分两种：绑在外部事实上的观测时点必须写（「实测（2026-10-25）上游排队 290s」），
 * 绑在改动过程上的修订记录必须删。区别就在有没有这些动作词——所以只有两者同时出现才报。
 */
const CHANGE_VERB = /(?:修订|修复|新增|调整|改动|改好|补上|updated|modified|fixed|changed|revised|revamped)/iu;

const CODE_START =
  /^(?:const|let|var|function|class|interface|type|enum|import|export|return|throw|if|for|while|switch|try|catch|await|async|def|lambda|public|private|protected|static|void|print|console\.|echo|select|insert|update\s+set)\b/iu;
const ASSIGNMENT = /^[A-Za-z_$][\w$.]*\s*=\s*[^=]/u;

const TODO_LINE = /^(TODO|FIXME)\b(.*)$/u;
const TODO_OK = /^\s*\([^()]+\)\s*[:：]\s*\S/u;
const DEPRECATED = /@deprecated\b/u;
const REPLACEMENT = /(?:替代|改用|换成|移到|移除条件|将在|废弃|replace(?:d)?\s+(?:by|with)|use\s+\S+\s+instead|remove(?:d)?\s+in|will\s+be\s+removed)/iu;
const TS_IGNORE = /@ts-(?:ignore|expect-error)\b(.*)$/u;

/**
 * 环境变量前缀的命令示例：`DWS_CLI="..." node scripts/x.mjs`。
 *
 * 写法与赋值语句一致，但它是文档里的用法示例，不是注释掉的代码。
 * 判据是等号左边全大写（环境变量惯例）且等号右边之后还有命令。
 */
const ENV_PREFIX_EXAMPLE = /^[A-Z][A-Z0-9_]*=\S*\s+\S/u;

function looksLikeCode(body: string): boolean {
  const t = body.trim();
  if (!t) return false;
  // 含中文多半是说明而不是注释掉的代码；中文注释里出现标识符是正常的
  if (CJK.test(t)) return false;
  if (ENV_PREFIX_EXAMPLE.test(t)) return false;
  if (CODE_START.test(t)) return true;
  if (t.includes("=>")) return true;
  if (ASSIGNMENT.test(t)) return true;
  if (/;\s*$/u.test(t) && /[=(){}[\]]/u.test(t)) return true;
  return false;
}

function looksNonChinese(body: string): boolean {
  const t = decodeUnicodeEscapes(body).trim();
  if (!t) return false;
  if (CJK.test(t)) return false;
  // 少于三个英文词的短注释（`// ok`、`// FIXME`）不判，避免把标记类注释全打成违规
  const words = t.match(/[A-Za-z][A-Za-z'’-]{2,}/gu) ?? [];
  if (words.length < 3) return false;
  if (DIRECTIVE.test(t)) return false;
  if (/(?:copyright|spdx|licensed?\s+under|all\s+rights\s+reserved|@(?:param|returns?|type|see|link|example|throws)|https?:\/\/)/iu.test(t)) {
    return false;
  }
  // 注释掉的代码由专门规则报，不在这里重复报一次
  if (looksLikeCode(t)) return false;
  // 讲注释规范的注释：出现「注释 / comment」并提到这些规则词，是在描述规则而不是写英文注释
  if (/(?:注释|comment)/iu.test(t) && /(?:TODO|FIXME|deprecated|ts-ignore|署名|修订)/u.test(t)) return false;
  return true;
}

/** 块注释每行开头的 `*` 是排版标记，去掉后再判定，否则 `* TODO(x)` 会被判成代码 */
function cleanBody(raw: string): string {
  return raw.replace(/^\s*\*+/u, "").trim();
}

const MESSAGES: Record<string, string> = {
  "author-trail": "注释里写了作者或审批留痕：署名与审批的唯一事实源是 git blame，注释里不留。",
  "revision-record": "注释里写了修订记录或改动日期：修订历史的唯一事实源是 git log，注释里不留。",
  "commented-code": "注释掉的是代码：直接删（git 里找得回），确实要留就写明保留原因。",
  "todo-format": "TODO / FIXME 格式不合规：应为 `TODO(名字): 描述`，并写清什么条件下清理。",
  "deprecated-no-replacement": "`@deprecated` 没写替代方案与移除条件，二者必写。",
  "ts-ignore-no-reason": "`@ts-ignore` / `@ts-expect-error` 必须同行写明理由。",
  "non-chinese": "注释不是中文：规范要求注释一律中文、简洁、不复述代码。",
  "empty-catch": "空 catch 吞掉了异常：块内要写说明注释，否则记录日志、上报或转换后重抛。",
};

/**
 * 连续的同种行注释归为一块。
 *
 * 「是不是中文」是整块的性质：一段中文说明常跨好几行 `//`，其中某一行只有命令或 JSON。
 * 逐行判就会把那些行打成英文注释。块注释本身就是一块，不用再归并。
 */
function commentChunks(comments: CommentRange[]): CommentRange[][] {
  const chunks: CommentRange[][] = [];
  for (const r of comments) {
    const last = chunks.at(-1);
    const prev = last?.at(-1);
    const merge = last !== undefined && prev !== undefined && prev.kind === "line" && r.kind === "line" && r.line === prev.line + 1;
    if (merge && last) last.push(r);
    else chunks.push([r]);
  }
  return chunks;
}

export function checkComments(text: string, filePath: string): CommentHit[] {
  if (!text.trim()) return [];
  if (shouldSkipFile(filePath)) return [];
  if (GENERATED_BANNER.test(text.slice(0, 300))) return [];

  const hits: CommentHit[] = [];
  const push = (rule: string, line: number): void => {
    const message = MESSAGES[rule];
    if (message) hits.push({ rule, line, message });
  };

  const { comments } = scan(text, filePath);

  for (const chunk of commentChunks(comments)) {
    const first = chunk[0];
    if (!first) continue;
    const fullBody = chunk
      .map((r) => text.slice(r.bodyStart, r.bodyEnd))
      .join("\n");

    // 整块判定：@deprecated 的替代方案常写在下一行
    if (DEPRECATED.test(fullBody) && !REPLACEMENT.test(fullBody)) push("deprecated-no-replacement", first.line);

    for (const r of chunk) {
      const body = text.slice(r.bodyStart, r.bodyEnd);
      body.split("\n").forEach((raw, idx) => {
        const line = r.line + idx;
        const t = cleanBody(raw);
        if (!t) return;

        const todo = TODO_LINE.exec(t);
        // 正文里并列提两个标记（「TODO / FIXME 行」）是在讲规则，不是在留待办
        if (todo && !/(?:TODO|FIXME)/u.test(todo[2] ?? "") && !TODO_OK.test(todo[2] ?? "")) {
          push("todo-format", line);
          return;
        }

        const tsIgnore = TS_IGNORE.exec(t);
        if (tsIgnore && !(tsIgnore[1] ?? "").trim()) {
          push("ts-ignore-no-reason", line);
          return;
        }

        if (looksLikeCode(t)) {
          push("commented-code", line);
          return;
        }

        if (AUTHOR.test(t)) {
          push("author-trail", line);
          return;
        }

        const dated = DATE.test(t) && CHANGE_VERB.test(t);
        if (REVISION.test(t) || REVISION_EN.test(t) || dated) {
          push("revision-record", line);
          return;
        }
      });
    }

    if (!CJK.test(decodeUnicodeEscapes(fullBody)) && looksNonChinese(fullBody)) push("non-chinese", first.line);
  }

  hits.push(...findEmptyCatch(stripCommentsAndStrings(text, filePath), text));
  return hits;
}

/**
 * 空 catch：块内没有说明注释才算命中。
 *
 * 在剥掉注释与字符串的文本上找 catch 块，再回原文判断块内有没有注释。
 * 两边都不可省：不回原文看注释，规则允许的唯一合规形态（块内写说明）会被打成违规；
 * 不剥字符串，HTML 片段里 `catch(e){}` 这种字符串内容会被当成真代码。
 * 两份文本偏移一致，按同一区间回原串取即可。块内有嵌套花括号时正则匹配不上，直接放过。
 */
function findEmptyCatch(stripped: string, original: string): CommentHit[] {
  const hits: CommentHit[] = [];
  const re = /catch\s*(?:\([^)]*\))?\s*\{([^{}]*)\}/gu;
  let m: RegExpExecArray | null = re.exec(stripped);
  while (m !== null) {
    // 块内有处理逻辑（记日志、返回兜底、转换后重抛）本就合规，只在块为空时才谈注释
    if ((m[1] ?? "").trim() === "") {
      const bodyLen = (m[1] ?? "").length;
      const bodyStart = m.index + m[0].lastIndexOf("{") + 1;
      const body = original.slice(bodyStart, bodyStart + bodyLen);
      if (!/\/\/|\/\*/u.test(body)) {
        hits.push({ rule: "empty-catch", line: lineOf(stripped, m.index), message: MESSAGES["empty-catch"] ?? "" });
      }
    }
    m = re.exec(stripped);
  }
  return hits;
}

/** 取本次写入新增的文本：Edit 是新串，Write 是整份内容 */
export function addedText(tool: string, input: Record<string, unknown>): string {
  const asString = (v: unknown): string => (typeof v === "string" ? v : "");
  if (tool === "Write") return asString(input["content"]);
  if (tool === "Edit") return asString(input["new_string"]);
  if (tool === "MultiEdit") {
    const edits = input["edits"];
    if (!Array.isArray(edits)) return "";
    return edits
      .map((e) => (e && typeof e === "object" ? asString((e as Record<string, unknown>)["new_string"]) : ""))
      .join("\n");
  }
  return "";
}

export function filePathOf(input: Record<string, unknown>): string {
  return typeof input["file_path"] === "string" ? (input["file_path"] as string) : "";
}
