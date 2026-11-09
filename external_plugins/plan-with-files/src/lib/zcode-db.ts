/**
 * 只读访问 ZCode 会话库：待办、会话目标（/goal）、计划文件。
 *
 * 为什么要读库而不是靠 hook 入参：库是权威持久态，模型侧可能拿到缓存或过期的
 * tool_response；而且 SessionStart / Stop 事件根本拿不到工具返回值。
 *
 * 关键事实（已核实）：
 *   - todo.session_id 与 session_target.session_id 都用会话原样 id，无格式转换
 *   - session_target 里 status ∈ active|paused|complete
 *   - 计划文件路径由 ZCode 决定：<workspaceRoot>/.zcode/plans/plan-<sessionId>.md
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// 允许用 PLAN_WITH_FILES_DB 指向副本库：便于在不动真库的前提下验证判定逻辑
const DB_PATH =
  process.env["PLAN_WITH_FILES_DB"] ?? join(homedir(), ".zcode", "cli", "db", "db.sqlite");

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
 * 找 ZCode 为本会话写的计划文件。
 * hook 只有 cwd，而 ZCode 用的是 workspaceRoot——两者未必相同，所以逐级向上找。
 */
export function findPlanFile(cwd: string, sessionId: string): string | null {
  const name = `plan-${sessionId.replace(/[^A-Za-z0-9._-]/g, "-")}.md`;
  let dir = cwd;
  for (let depth = 0; depth < 6; depth++) {
    const candidate = join(dir, ".zcode", "plans", name);
    if (existsSync(candidate)) return candidate;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * 从计划正文提取阶段标题，仅作导航用。
 *
 * 排除 Context / 验证 / 交付 这类「非实施步骤」的固定小节——ZCode 的 Phase 4 要求
 * 计划必须含这几节，把它们当阶段会让导航失真。只取 ### 三级标题，以及二级标题里
 * 明确是步骤的（含「方案 / 阶段 / 实施」）。
 */
const NON_STEP_HEADINGS = /^(context|背景|目标|验证|测试|交付|风险|回滚|备注|附录|summary|verification|delivery)/i;

export function extractPhases(planText: string): string[] {
  const out: string[] = [];
  for (const line of planText.split("\n")) {
    const m = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const level = (m[1] as string).length;
    const title = (m[2] as string).trim();
    if (!title || NON_STEP_HEADINGS.test(title)) continue;
    // 三级标题一律视为步骤；二级标题只收「方案 / 阶段 / 实施」这类
    if (level === 3 || /方案|阶段|实施|步骤/.test(title)) out.push(title);
    if (out.length >= 12) break;
  }
  return out;
}

export function readPlan(cwd: string, sessionId: string): { path: string; text: string; phases: string[] } | null {
  const path = findPlanFile(cwd, sessionId);
  if (!path) return null;
  try {
    const text = readFileSync(path, "utf8");
    return { path, text, phases: extractPhases(text) };
  } catch {
    return null;
  }
}

/** 同一 workspace 下还有哪些计划文件（用于多会话索引） */
export function listPlanFiles(cwd: string): string[] {
  const dir = join(cwd, ".zcode", "plans");
  try {
    return readdirSync(dir)
      .filter((f) => /^plan-.+\.md$/.test(f))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}
