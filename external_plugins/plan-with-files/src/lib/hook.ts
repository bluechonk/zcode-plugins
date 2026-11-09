/**
 * hook 通用设施：读入参、按 ZCode 规范回写、按会话读写状态。
 *
 * 约定（均经源码或实测确认）：
 *   1. ZCode 只认 hookSpecificOutput 里的字段，放顶层会被非严格 schema 静默丢弃
 *   2. 入参里有 permission_mode，取值 plan|build|edit|yolo|guarded|auto
 *   3. PostToolUse 的 tool_response 不裁剪，另有 tool_result_preview 才是 4000 字符截断版
 *   4. 多个 hook 的 additionalContexts 全部累积，但 stopShouldContinue 是后者覆盖前者
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface HookInput {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  agent_type?: string;
  permission_mode?: string;
  mode?: string;
  /** Stop 事件：上一轮已经因为 Stop hook 继续过一次 */
  stop_hook_active?: boolean;
  /** UserPromptSubmit 事件：用户本轮提问的原文 */
  prompt?: string;
}

export function readStdin(): Promise<string> {
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

export async function readHookInput(): Promise<HookInput | null> {
  const raw = await readStdin();
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as HookInput;
  } catch {
    return null; // 入参不是 JSON：静默放行
  }
}

/** 子代理自带任务边界，不套主会话的台账与核对 */
export function isSubagent(input: HookInput): boolean {
  const agent = input.agent_type ?? "";
  return agent !== "" && agent !== "zcode-agent";
}

export function emit(hookEventName: string, inner: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, ...inner } }));
}

export function stateDir(): string {
  return (
    process.env["ZCODE_PLUGIN_DATA"] ??
    process.env["CLAUDE_PLUGIN_DATA"] ??
    join(homedir(), ".zcode", "plan-with-files")
  );
}

function statePath(sessionId: string, name: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9_.-]/g, "_") || "default";
  return join(stateDir(), `${safe}.${name}.json`);
}

export function readState<T>(sessionId: string, name: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(readFileSync(statePath(sessionId, name), "utf8"));
    return (parsed as T) ?? fallback;
  } catch {
    // 首次运行或文件损坏：用兜底值，重新走一遍是安全的
    return fallback;
  }
}

export function writeState(sessionId: string, name: string, value: unknown): void {
  try {
    const p = statePath(sessionId, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(value), "utf8");
  } catch {
    // 落盘失败只影响下次判断，不影响本次放行
  }
}

export function envFlag(name: string): boolean {
  return process.env[name] === "1";
}

export function disabled(): boolean {
  return envFlag("PLAN_WITH_FILES_DISABLE") || process.env["ZCODE_PLAN_GATE"] === "off";
}
