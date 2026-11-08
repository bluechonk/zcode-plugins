/**
 * security-review 正则模式层：编辑写入后即时扫一遍新增内容，命中就在模型上下文里提示。
 *
 * 职责与约束：
 *   1. 只审「这次新增的文本」（Edit 的 new_string / Write 的 content），不重审整个文件
 *   2. 纯正则，无网络、无 LLM、无文件读取以外的副作用；任何异常一律静默放行
 *   3. 同一会话内同一条规则命中的同一个文件只提示一次，避免反复刷屏吃掉上下文
 * 挂载：hooks/hooks.json 的 PostToolUse（matcher Edit|Write|MultiEdit）。
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface HookInput {
  hook_event_name?: string;
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  agent_type?: string;
}

interface Rule {
  id: string;
  /** 一句话说清命中了什么 */
  what: string;
  /** 怎么修 */
  fix: string;
  pattern: RegExp;
}

/**
 * 规则集：刻意保持精简。宁缺毋滥——误报会持续吃掉模型上下文，
 * 比漏报更伤，所以每条都要求能在只看到新增文本的情况下判断。
 */
const RULES: readonly Rule[] = [
  {
    id: "hardcoded-secret",
    what: "疑似把密钥/口令写成字面量",
    fix: "改从环境变量或密钥管理读取，不要入库",
    pattern:
      /\b(api[_-]?key|secret|token|password|passwd|credential)\b\s*[:=]\s*["'`][^"'`\s]{12,}["'`]/i,
  },
  {
    id: "aws-access-key",
    what: "疑似 AWS Access Key ID",
    fix: "撤销该密钥并改用临时凭据",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    id: "private-key",
    what: "私钥内容被写进代码",
    fix: "私钥走密钥管理服务，绝不能入库",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    id: "sql-concat",
    what: "SQL 语句用字符串拼接构造",
    fix: "改用参数化查询（占位符 + 绑定参数）",
    // 中段允许引号：真实写法是 `"... WHERE id = " + userId`，闭合引号在 + 之前，
    // 若把引号排除出字符类就永远匹配不到
    pattern:
      /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[^\n;]{0,200}?(\+\s*[A-Za-z_$]|\$\{|%s|\.format\s*\()/i,
  },
  {
    id: "command-injection",
    what: "shell 命令用拼接/插值构造",
    fix: "改用数组形式传参（execFile/spawn 的 args），不要过 shell",
    pattern: /\b(exec|execSync|system|popen)\s*\(\s*[^)]*(\+\s*[A-Za-z_$]|\$\{|f")/,
  },
  {
    id: "path-from-request",
    what: "文件路径直接取自请求参数",
    fix: "做白名单或规范化后校验前缀，拒绝 ../ 与绝对路径",
    pattern:
      /\b(readFile|writeFile|createReadStream|createWriteStream|sendFile|unlink)\s*\([^)]*\b(req|request|ctx|params|query|body)\b/,
  },
  {
    id: "dynamic-code",
    what: "动态执行代码",
    fix: "改成显式分支或解析器，不要 eval / new Function",
    pattern: /\beval\s*\(|\bnew\s+Function\s*\(/,
  },
  {
    id: "tls-verify-off",
    what: "关闭了 TLS 证书校验",
    fix: "改回校验；确需自签证书就把该证书加进信任链",
    pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0/,
  },
  {
    id: "xss-html",
    what: "把未转义内容塞进 HTML",
    fix: "改用文本节点，或先经白名单净化",
    pattern: /\.innerHTML\s*=|dangerouslySetInnerHTML/,
  },
  {
    id: "weak-hash",
    what: "口令/签名场景使用了弱哈希",
    fix: "口令用 bcrypt/scrypt/argon2；完整性校验用 sha256 起步",
    pattern: /createHash\s*\(\s*["'`](md5|sha1)["'`]/i,
  },
  {
    id: "insecure-random",
    what: "疑似用 Math.random 生成安全相关值",
    fix: "改用 crypto.randomUUID / randomBytes",
    pattern: /\b(secret|token|salt|nonce|session[_-]?id|api[_-]?key)\w*\s*[:=]\s*[^;\n]*Math\.random\s*\(/i,
  },
  {
    id: "cors-wildcard",
    what: "CORS 允许任意来源",
    fix: "改为白名单来源，或明确说明为何需要放开",
    pattern: /(Access-Control-Allow-Origin["'`]?\s*[:,]\s*["'`]\*|origin\s*:\s*["'`]\*["'`])/i,
  },
];

/** 单次最多提示的条数：再多就该在别处解决，塞满上下文反而没人看 */
const MAX_WARNINGS = 5;
/** 超过这个体积不扫：大文件里的正则命中多半是噪音 */
const MAX_SCAN_BYTES = 200_000;

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c: string) => {
      data += c;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

/** 取出本次新增的文本；MultiEdit 逐条合并 */
function addedText(tool: string, input: Record<string, unknown>): string {
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

function statePath(sessionId: string): string {
  const dir = process.env["ZCODE_PLUGIN_DATA"] ?? process.env["CLAUDE_PLUGIN_DATA"] ?? join(homedir(), ".zcode", "security-review");
  return join(dir, `${sessionId.replace(/[^A-Za-z0-9_.-]/g, "_")}.json`);
}

/** 已提示过的 rule@文件 指纹；读写失败都不影响提示本身 */
function loadShown(sessionId: string): Set<string> {
  try {
    const raw = readFileSync(statePath(sessionId), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    // 首次运行或文件损坏：当作空集合，重新提示一遍是安全的
  }
  return new Set();
}

function saveShown(sessionId: string, shown: Set<string>): void {
  try {
    const p = statePath(sessionId);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, JSON.stringify([...shown]), "utf8");
  } catch {
    // 落盘失败只意味着下次可能重复提示，不影响本次结果
  }
}

function emitAdditionalContext(text: string): void {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } })
  );
}

async function main(): Promise<void> {
  const raw = await readStdin();
  if (!raw.trim()) return;

  let input: HookInput;
  try {
    input = JSON.parse(raw) as HookInput;
  } catch {
    return; // 入参不是 JSON：静默放行
  }

  if (input.hook_event_name !== "PostToolUse") return;
  const tool = input.tool_name ?? "";
  if (tool !== "Edit" && tool !== "Write" && tool !== "MultiEdit") return;

  const toolInput = input.tool_input ?? {};
  const text = addedText(tool, toolInput);
  if (!text || text.length > MAX_SCAN_BYTES) return;

  const file = typeof toolInput["file_path"] === "string" ? (toolInput["file_path"] as string) : "(未知文件)";
  const sessionId = input.session_id ?? "default";
  const shown = loadShown(sessionId);

  const hits: Array<{ rule: Rule; digest: string }> = [];
  for (const rule of RULES) {
    if (!rule.pattern.test(text)) continue;
    const digest = `${rule.id}@${file}`;
    if (shown.has(digest)) continue;
    hits.push({ rule, digest });
    if (hits.length >= MAX_WARNINGS) break;
  }
  if (hits.length === 0) return;

  for (const h of hits) shown.add(h.digest);
  saveShown(sessionId, shown);

  const lines = [
    `[security-review] 本次改动命中 ${hits.length} 条安全规则，请判断是否成立并处理：`,
    "",
  ];
  for (const [i, h] of hits.entries()) {
    lines.push(`${i + 1}. ${h.rule.what}（规则 ${h.rule.id}，文件 ${file}）`);
    lines.push(`   修法：${h.rule.fix}`);
  }
  lines.push("", "误报就直接说明理由并继续，不必为了消警告改坏代码。");
  emitAdditionalContext(lines.join("\n"));
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));

// 导出规则表与解析函数，供单测直接引用；构建为单文件时不影响运行时行为
export { RULES, addedText, MAX_WARNINGS };
