/**
 * hook 通用设施：读入参、按 ZCode 规范回写、按会话读写状态。
 *
 * 与 plan-ledger 的同名文件同构，差别只在多了 readState/writeState 需要的状态目录。
 * 约定：ZCode 只认 hookSpecificOutput 里的字段；子代理自带任务边界，不套主会话的检测。
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
  stop_hook_active?: boolean;
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

/** 子代理自带任务边界，不套主会话的检测 */
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
    join(homedir(), ".zcode", "repo-guardian")
  );
}

export function statePath(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "_");
  return join(stateDir(), `${safe}.json`);
}

export function readState<T>(sessionId: string, fallback: T): T {
  try {
    const raw = readFileSync(statePath(sessionId), "utf8");
    return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    return fallback;
  }
}

export function writeState(sessionId: string, value: unknown): void {
  try {
    const p = statePath(sessionId);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(value), "utf8");
  } catch {
    // 状态落盘失败只影响下次检测，不影响本次
  }
}

export function envFlag(name: string): boolean {
  return process.env[name] === "1";
}

export function disabled(): boolean {
  return envFlag("REPO_GUARDIAN_DISABLE");
}

/** 把 hook 入参里的 cwd 规范化；读不到时退回进程 cwd */
export function cwdOf(input: HookInput): string {
  const cwd = input.cwd;
  return typeof cwd === "string" && cwd.trim() ? cwd : process.cwd();
}
