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

import { RULES, type Rule } from "./lib/rules";

interface HookInput {
  hook_event_name?: string;
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  agent_type?: string;
}

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

/**
 * 提示状态。
 * shown: 已提示过的 rule@文件 指纹，同一处只提示一次。
 * hits:  每条规则的累计命中次数——误报调优的依据：某规则长期高命中却没人改，
 *        说明规则写得不对，该收紧或删掉。
 */
interface RuleStats {
  shown: string[];
  hits: Record<string, number>;
}

function loadStats(sessionId: string): RuleStats {
  try {
    const raw = readFileSync(statePath(sessionId), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // 旧格式只有 shown 数组，兼容读取
      return { shown: parsed.filter((v): v is string => typeof v === "string"), hits: {} };
    }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      return {
        shown: Array.isArray(obj["shown"])
          ? obj["shown"].filter((v): v is string => typeof v === "string")
          : [],
        hits:
          obj["hits"] && typeof obj["hits"] === "object"
            ? (obj["hits"] as Record<string, number>)
            : {},
      };
    }
  } catch {
    // 首次运行或文件损坏：当作空状态，重新提示一遍是安全的
  }
  return { shown: [], hits: {} };
}

function saveStats(sessionId: string, stats: RuleStats): void {
  try {
    const p = statePath(sessionId);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, JSON.stringify(stats), "utf8");
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
  const stats = loadStats(sessionId);
  const shown = new Set(stats.shown);

  const hits: Array<{ rule: Rule; digest: string }> = [];
  for (const rule of RULES) {
    if (!rule.pattern.test(text)) continue;
    // 命中即计数，不论是否已提示过——误报调优要的是全量命中
    stats.hits[rule.id] = (stats.hits[rule.id] ?? 0) + 1;
    const digest = `${rule.id}@${file}`;
    if (shown.has(digest)) continue;
    hits.push({ rule, digest });
    if (hits.length >= MAX_WARNINGS) break;
  }
  if (hits.length === 0) {
    saveStats(sessionId, stats);
    return;
  }

  for (const h of hits) shown.add(h.digest);
  stats.shown = [...shown];
  saveStats(sessionId, stats);

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
