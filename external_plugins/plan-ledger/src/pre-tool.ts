/**
 * PreToolUse：规划门禁 + 捕获计划。
 *
 * 两件事：
 *   1. 本轮（自最近一次用户提问起）没有 TodoWrite 记录时，拦下会改状态的工具
 *   2. ExitPlanMode 提交计划时，记下计划路径与阶段标题，供台账使用
 *
 * 必须让路的三种情况（漏掉任何一个都会产生误导）：
 *   - plan 模式：ZCode 自己就拒绝写工具，再拦一次会把「你在 plan 模式」掩盖成「你没规划」
 *   - 子代理：自带任务边界
 *   - 已有 active 目标（/goal）：目标本身就是规划，不该再要求 TodoWrite
 */

import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { disabled, emit, inPlanMode, isSubagent, readHookInput, readState, writeState } from "./lib/hook";
import { readGoal } from "./lib/zcode-db";

// 允许用 PLAN_LEDGER_DB 指向副本库：便于在不动真库的前提下验证判定逻辑
const DB_PATH = process.env["PLAN_LEDGER_DB"] ?? join(homedir(), ".zcode", "cli", "db", "db.sqlite");

/** 规划前允许使用的只读 / 研究 / 元工具 */
const ALWAYS_ALLOW = new Set([
  "TodoWrite",
  "TodoRead",
  "Read",
  "Grep",
  "Glob",
  "Bash",
  "WebSearch",
  "WebFetch",
  "ListModels",
  "AskUserQuestion",
  "Skill",
  "ToolSearch",
  "TaskOutput",
  "TaskStop",
  "SendMessage",
  "EnterPlanMode",
  "ExitPlanMode",
  "DeferredToolCall",
]);

const NUDGE_AFTER = 25;

const DENY_REASON =
  "本轮尚未规划：自上次用户提问以来没有 TodoWrite 记录。" +
  "请先调用 TodoWrite 写下任务拆解（步骤、顺序、验收标准），再执行该工具。" +
  "规划前可先用只读工具与 Bash 摸现状，但改代码类动作要先有规划。";

/**
 * 规划判定：三条任一成立即算「本轮已规划」。
 *
 * 为什么不只看 part 表里的 TodoWrite：TodoWrite 常经 DeferredToolCall 转发，
 * 而该转发在入参 JSON 解析失败时会把 input 兜底成 {}、工具根本没执行（实测全库
 * 282 条转发零成功）。只认单一证据会让门禁在转发坏掉时永久锁死——模型既规划不了
 * 也写不了文件。所以改认「规划这个事实」，而不是「某一种调用方式」：
 *
 *   A. part 表里有 TodoWrite 记录（直接调用，全库 1677 条）
 *   B. todo 表在本轮之后被写过（转发成功、或任何写入了待办的路径）
 *   C. 本轮之后有 ExitPlanMode（走 plan 模式，计划本身就是规划）
 */
const PLAN_QUERY = `
SELECT
  EXISTS(
    SELECT 1 FROM part
    WHERE session_id = :sid
      AND json_extract(data, '$.tool') IN ('TodoWrite', 'ExitPlanMode')
      AND time_created >= COALESCE(
        (SELECT MAX(time_created) FROM message
         WHERE session_id = :sid AND json_extract(data, '$.semantics.kind') = 'user_prompt'),
        0)
  )
  OR EXISTS(
    SELECT 1 FROM todo
    WHERE session_id = :sid
      AND time_updated >= COALESCE(
        (SELECT MAX(time_created) FROM message
         WHERE session_id = :sid AND json_extract(data, '$.semantics.kind') = 'user_prompt'),
        0)
  ) AS planned,
  (
    SELECT COUNT(*) FROM part
    WHERE session_id = :sid
      AND json_extract(data, '$.type') = 'tool'
      AND time_created > COALESCE(
        (SELECT MAX(time_created) FROM part
         WHERE session_id = :sid AND json_extract(data, '$.tool') IN ('TodoWrite', 'ExitPlanMode')),
        0)
  ) AS calls_since_todo
`;

function readPlanState(sessionId: string): { planned: boolean; calls: number } | null {
  try {
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      const row = db.prepare(PLAN_QUERY).get({ sid: sessionId }) as
        | { planned?: unknown; calls_since_todo?: unknown }
        | undefined;
      return {
        planned: Boolean(row?.planned),
        calls: Number(row?.calls_since_todo ?? 0),
      };
    } finally {
      db.close();
    }
  } catch {
    return null; // 库读不到：当作已规划，放行
  }
}

/**
 * 规划工具本身是否已经坏掉：本轮出现过失败的 DeferredToolCall，且没有任何成功的规划。
 *
 * 用来防死锁——门禁的解锁路径不能依赖一个会失败的工具。
 */
function plannerBroken(sessionId: string): boolean {
  try {
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS c FROM part
           WHERE session_id = :sid
             AND json_extract(data, '$.tool') = 'DeferredToolCall'
             AND json_extract(data, '$.state.status') = 'error'
             AND time_created >= COALESCE(
               (SELECT MAX(time_created) FROM message
                WHERE session_id = :sid AND json_extract(data, '$.semantics.kind') = 'user_prompt'),
               0)`
        )
        .get({ sid: sessionId }) as { c?: number } | undefined;
      return Number(row?.c ?? 0) > 0;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input || input.hook_event_name !== "PreToolUse") return;
  if (isSubagent(input)) return;

  const sessionId = input.session_id ?? "";
  const tool = input.tool_name ?? "";
  if (!sessionId) return;

  // 捕获计划：ExitPlanMode 的 plan 参数就是批准后的完整计划
  if (tool === "ExitPlanMode") {
    const plan = input.tool_input?.["plan"];
    if (typeof plan === "string" && plan.trim()) {
      const phases = plan
        .split("\n")
        .map((l) => /^#{2,3}\s+(.+?)\s*$/.exec(l)?.[1])
        .filter((x): x is string => Boolean(x))
        .slice(0, 12);
      writeState(sessionId, "plan", {
        capturedAt: new Date().toISOString(),
        phases,
        bytes: plan.length,
      });
    }
    return;
  }

  if (!tool || ALWAYS_ALLOW.has(tool)) return;

  // plan 模式：ZCode 自己会拒绝写工具，这里再拦会把真实原因掩盖掉
  if (inPlanMode(input)) return;

  // 有 active 目标时目标本身就是规划，不要求 TodoWrite
  const goal = readGoal(sessionId);
  if (goal?.status === "active") return;

  const state = readPlanState(sessionId);
  if (!state) return;

  if (!state.planned) {
    // 死锁保护：模型已经试过规划但工具本身失败时，放行而不是锁死。
    // 依据实测——DeferredToolCall 在入参 JSON 解析失败时会把 input 兜底成 {}，
    // 工具根本没执行（全库 282 条转发零成功）。此时若仍拒绝，模型既规划不了
    // 也写不了文件，会话彻底卡住。
    if (plannerBroken(sessionId)) return;

    emit("PreToolUse", {
      permissionDecision: "deny",
      permissionDecisionReason: DENY_REASON,
    });
    return;
  }

  if (state.calls >= NUDGE_AFTER) {
    emit("PreToolUse", {
      additionalContext:
        `进度提醒：距上次 TodoWrite 已执行 ${state.calls} 次工具调用，` +
        "待办清单可能已过时。请用 TodoWrite 更新进度（完成项标 completed，进行中项标 in_progress）。",
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
