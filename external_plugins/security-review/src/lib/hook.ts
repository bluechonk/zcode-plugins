/**
 * hook 通用设施：读 hook 入参、按 ZCode 规范回写结果、按会话读写状态。
 *
 * 约定：ZCode 只认 hookSpecificOutput 里的字段，放顶层会被非严格 schema 静默丢弃；
 *      任何异常由调用方兜住，这里只负责读写。
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
  agent_type?: string;
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

/** 每个 hook 脚本的入口都走它：解析 stdin，失败即静默退出 */
export async function readHookInput(): Promise<HookInput | null> {
  const raw = await readStdin();
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as HookInput;
  } catch {
    return null; // 入参不是 JSON：静默放行
  }
}

export function emit(hookEventName: string, inner: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, ...inner } }));
}

/** Stop 事件用顶层 decision 表达「继续」，hookSpecificOutput 里没有这个分支 */
export function emitStopBlock(reason: string): void {
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}

export function stateDir(): string {
  return (
    process.env["ZCODE_PLUGIN_DATA"] ??
    process.env["CLAUDE_PLUGIN_DATA"] ??
    join(homedir(), ".zcode", "security-review")
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
    // 落盘失败只影响下次判断，不影响本次结果
  }
}

export function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

export function disabled(): boolean {
  return process.env["SECURITY_REVIEW_DISABLE"] === "1";
}
