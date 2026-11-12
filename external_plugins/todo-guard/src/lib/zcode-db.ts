/**
 * 只读访问 ZCode 会话库：待办、会话目标（/goal）、本轮的工具调用。
 *
 * 为什么要读库而不是靠 hook 入参：库是权威持久态，模型侧可能拿到缓存或过期的
 * tool_response；而且 SessionStart / Stop 事件根本拿不到工具返回值。
 *
 * 关键事实（已核实）：
 *   - todo.session_id 与 session_target.session_id 都用会话原样 id，无格式转换
 *   - session_target 里 status ∈ active|paused|complete
 *   - part.data 里的 $.tool 是工具名，message.data 里的 $.semantics.kind === 'user_prompt'
 *     标记用户提问；两者相减就得到「本轮用过哪些工具」
 */

import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

// 允许用 TODO_GUARD_DB 指向副本库：便于在不动真库的前提下验证判定逻辑
const DB_PATH = process.env["TODO_GUARD_DB"] ?? join(homedir(), ".zcode", "cli", "db", "db.sqlite");

export interface TodoItem {
  content: string;
  status: string;
  priority: string;
  position: number;
  /** 最近一次更新时间（Unix 毫秒）；用于判断待办是否长期无进展 */
  timeUpdated: number;
}

export interface GoalInfo {
  objective: string;
  status: string;
  tokensUsed: number;
  timeUsedSeconds: number;
  summaryTitle: string | null;
}

function withDb<T>(fn: (db: DatabaseSync) => T, fallback: T): T {
  try {
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      return fn(db);
    } finally {
      db.close();
    }
  } catch {
    // 库不可读（锁定/损坏/路径变更）：返回兜底，调用方按「无数据」处理
    return fallback;
  }
}

export function readTodos(sessionId: string): TodoItem[] {
  return withDb((db) => {
    const rows = db
      .prepare(
        `SELECT content, status, priority, position, time_updated FROM todo
         WHERE session_id = ? ORDER BY position ASC`
      )
      .all(sessionId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      content: String(r["content"] ?? ""),
      status: String(r["status"] ?? "pending"),
      priority: String(r["priority"] ?? "medium"),
      position: Number(r["position"] ?? 0),
      timeUpdated: Number(r["time_updated"] ?? 0),
    }));
  }, []);
}

export function readGoal(sessionId: string): GoalInfo | null {
  return withDb((db) => {
    const row = db
      .prepare(
        `SELECT objective, status, tokens_used, time_used_seconds, summary_title
         FROM session_target WHERE session_id = ?`
      )
      .get(sessionId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      objective: String(row["objective"] ?? ""),
      status: String(row["status"] ?? ""),
      tokensUsed: Number(row["tokens_used"] ?? 0),
      timeUsedSeconds: Number(row["time_used_seconds"] ?? 0),
      summaryTitle: row["summary_title"] == null ? null : String(row["summary_title"]),
    };
  }, null);
}

/**
 * 本轮（自最近一次用户提问起）调过的工具名。
 *
 * 读不到库时返回 null，调用方据此跳过判定——不能把「读不到」当成「没调过」，
 * 那会把库锁定之类的瞬时故障变成误报。
 */
export function toolCallsThisTurn(sessionId: string): string[] | null {
  return withDb((db) => {
    const rows = db
      .prepare(
        `SELECT json_extract(data, '$.tool') AS tool FROM part
         WHERE session_id = :sid
           AND json_extract(data, '$.tool') IS NOT NULL
           AND time_created >= COALESCE(
             (SELECT MAX(time_created) FROM message
              WHERE session_id = :sid AND json_extract(data, '$.semantics.kind') = 'user_prompt'),
             0)`
      )
      .all({ sid: sessionId }) as Array<Record<string, unknown>>;
    return rows.map((r) => String(r["tool"] ?? "")).filter((t) => t !== "");
  }, null);
}

/** 本轮是否调用过某个工具；读不到库时返回 true（不判定，避免误报） */
export function usedToolThisTurn(sessionId: string, tool: string): boolean {
  const calls = toolCallsThisTurn(sessionId);
  return calls === null ? true : calls.includes(tool);
}
