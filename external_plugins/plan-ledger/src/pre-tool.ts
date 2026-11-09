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

const DB_PATH = join(homedir(), ".zcode", "cli", "db", "db.sqlite");

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

const PLAN_QUERY = `
SELECT
  EXISTS(
    SELECT 1 FROM part
    WHERE session_id = ?
      AND json_extract(data, '$.tool') = 'TodoWrite'
      AND time_created >= COALESCE(
        (SELECT MAX(time_created) FROM message
         WHERE session_id = ? AND json_extract(data, '$.semantics.kind') = 'user_prompt'),
        0)
  ) AS planned,
  (
    SELECT COUNT(*) FROM part
    WHERE session_id = ?
      AND json_extract(data, '$.type') = 'tool'
      AND time_created > COALESCE(
        (SELECT MAX(time_created) FROM part
         WHERE session_id = ? AND json_extract(data, '$.tool') = 'TodoWrite'),
        0)
  ) AS calls_since_todo
`;

function readPlanState(sessionId: string): { planned: boolean; calls: number } | null {
  try {
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      const row = db.prepare(PLAN_QUERY).get(sessionId, sessionId, sessionId, sessionId) as
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
