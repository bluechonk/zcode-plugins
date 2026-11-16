/**
 * 审查后端：复用「当前会话那套模型配置」做一次 diff 安全审查。
 *
 * 三个必须处理的现实：
 *   1. hook 入参里没有模型信息（ZCode 只注入 session_id / cwd / tool_* 等），
 *      所以配置只能从 ZCode 的会话库 + provider 配置里反查。
 *   2. 部分模型把输出写在 reasoning_content 而不是 content；只读 content 会
 *      永远拿到空串，表现为「审查没问题」——这是静默失效，最难发现。
 *   3. 模型名与接入点分属两个 provider（longcat 官方 / 本机网关）时，
 *      名字对不上就 400。所以 baseUrl 与密钥必须跟着会话的 provider 走，
 *      不允许插件自己拼默认值。
 */

import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

import { providerEndpoint } from "./providers";

export interface Finding {
  severity: string;
  file: string;
  issue: string;
  fix: string;
}

export interface ReviewOutcome {
  status: "ok" | "no-config" | "transport-error";
  findings: Finding[];
  note?: string;
}

const ZCODE_DB = join(homedir(), ".zcode", "cli", "db", "db.sqlite");

export interface SessionModelConfig {
  modelId: string;
  providerId: string;
  baseUrl: string;
  apiKey: string;
}

/**
 * 取当前会话在用的完整模型配置。
 *
 * 缺一环就返回 null，**不回落任何默认值**：模型名、providerId 从会话库读，
 * baseUrl 与 apiKey 从 ZCode 的 provider 配置读。读不到就不发这次审查——
 * 宁可跳过，也不把请求发到一个猜测的地址。
 */
export function resolveSessionConfig(sessionId: string): SessionModelConfig | null {
  let providerId = "";
  let modelId = "";
  try {
    const db = new DatabaseSync(ZCODE_DB, { readOnly: true });
    try {
      const last = db
        .prepare(
          `SELECT json_extract(data,'$.modelId') AS m, json_extract(data,'$.providerId') AS p
           FROM message
           WHERE session_id = ? AND json_extract(data,'$.semantics.kind') = 'assistant_response'
           ORDER BY sequence DESC LIMIT 1`
        )
        .get(sessionId) as { m?: string; p?: string } | undefined;
      if (last?.m) {
        modelId = last.m;
        providerId = last.p ?? "";
      } else {
        const asked = db
          .prepare(
            `SELECT json_extract(data,'$.modelSelection.modelId') AS m,
                    json_extract(data,'$.modelSelection.providerId') AS p
             FROM message
             WHERE session_id = ? AND json_extract(data,'$.semantics.kind') = 'user_prompt'
             ORDER BY sequence DESC LIMIT 1`
          )
          .get(sessionId) as { m?: string; p?: string } | undefined;
        modelId = asked?.m ?? "";
        providerId = asked?.p ?? "";
      }
    } finally {
      db.close();
    }
  } catch {
    return null; // 会话库不可读：跳过，不阻断 Stop
  }

  if (!modelId || !providerId) return null;
  const endpoint = providerEndpoint(providerId);
  if (!endpoint) return null;
  return { modelId, providerId, baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey };
}

const SYSTEM_PROMPT = [
  "你是安全审查员，只做只读分析。",
  "只报你在这段 diff 里能确证的真实漏洞，不要报风格问题、不要报占位符/示例/测试夹具。",
  "只审本轮新引入的改动：新增与修改的行。删除的行、以及 diff 里未改动的上下文行都不在本轮范围。",
  "拿不准就不要报——误报会让开发者付出比漏报更高的代价。",
  "",
  "只输出 JSON，不要任何解释文字：",
  '{"findings":[{"severity":"high|medium|low","file":"路径","issue":"问题","fix":"具体修法"}]}',
  "没有真实漏洞时输出 {\"findings\":[]}。",
].join("\n");

/** 从可能带前后文的文本里抠出 JSON */
function extractJson(text: string): unknown | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function toFindings(parsed: unknown): Finding[] {
  if (!parsed || typeof parsed !== "object") return [];
  const raw = (parsed as { findings?: unknown }).findings;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === "object")
    .map((f) => ({
      severity: String(f["severity"] ?? "low"),
      file: String(f["file"] ?? "?"),
      issue: String(f["issue"] ?? ""),
      fix: String(f["fix"] ?? ""),
    }))
    .filter((f) => f.issue.length > 0);
}

export async function reviewDiff(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  diff: string;
  timeoutMs: number;
}): Promise<ReviewOutcome> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/chat/completions`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // 用会话自己的密钥：接入点与凭据必须成套，换一个 provider 就换一套
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        stream: false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `本轮改动的 git diff：\n\n${opts.diff}` },
        ],
      }),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (e) {
    return { status: "transport-error", findings: [], note: e instanceof Error ? e.message : String(e) };
  }

  if (!res.ok) {
    return { status: "transport-error", findings: [], note: `HTTP ${res.status}` };
  }

  const body = (await res.json().catch(() => null)) as
    | { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> }
    | null;
  const msg = body?.choices?.[0]?.message;
  if (!msg) return { status: "transport-error", findings: [], note: "响应里没有 choices" };

  // 两个字段都试：有的模型把结论写在 reasoning_content，content 反而是空的
  const candidates = [msg.content ?? "", msg.reasoning_content ?? ""].filter((s) => s.trim().length > 0);
  for (const text of candidates) {
    const parsed = extractJson(text);
    if (parsed !== null) {
      const findings = toFindings(parsed);
      const note =
        !msg.content?.trim() && msg.reasoning_content?.trim()
          ? "结论取自 reasoning_content（content 为空）"
          : undefined;
      return { status: "ok", findings, ...(note ? { note } : {}) };
    }
  }

  // 输出不是 JSON：不下结论，避免把模型的自由发挥当成漏洞
  return { status: "ok", findings: [], note: "审查输出不是 JSON，已忽略" };
}
