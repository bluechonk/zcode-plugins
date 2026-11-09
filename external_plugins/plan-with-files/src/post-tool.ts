/**
 * PostToolUse：TodoWrite / TodoRead 之后刷新规划文件。
 *
 * 待办一律从会话库读，不解析 tool_response —— 库是权威持久态，
 * 而且 TodoRead 与 TodoWrite 走同一条读取路径，行为一致。
 *
 * 写三个文件（与 planning-with-files 形态对齐，但职责不同）：
 *   task_plan.md  插件派生（目标 / 下一步 / 阶段状态）
 *   progress.md   插件派生（活动线 + 待办快照）
 *   findings.md   模型维护，只在缺失时写骨架
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { disabled, isSubagent, readHookInput, readState, writeState } from "./lib/hook";
import { checkConsistency } from "./lib/consistency";
import {
  findingsSkeleton,
  planFilePaths,
  renderProgress,
  renderTaskPlan,
  writeIfChanged,
} from "./lib/files";
import { ledgerPath, pruneLedgers, type LedgerEvent } from "./lib/ledger";
import { readGoal, readPlan, readTodos } from "./lib/zcode-db";

function stamp(): string {
  return new Date().toISOString().slice(11, 16);
}

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input || input.hook_event_name !== "PostToolUse") return;
  if (isSubagent(input)) return;

  const tool = input.tool_name ?? "";
  if (tool !== "TodoWrite" && tool !== "TodoRead") return;

  const sessionId = input.session_id ?? "";
  const cwd = input.cwd ?? process.cwd();
  if (!sessionId) return;

  const todos = readTodos(sessionId);
  const goal = readGoal(sessionId);
  const plan = readPlan(cwd, sessionId);
  const captured = readState<{ phases?: string[] } | null>(sessionId, "plan", null);
  const phases = plan?.phases ?? captured?.phases ?? [];

  const prev = readState<{ events?: LedgerEvent[]; todoSig?: string }>(sessionId, "ledger", {});
  const events = prev.events ?? [];

  const sig = todos.map((t) => `${t.status}:${t.content}`).join("|");
  const detail =
    tool === "TodoRead"
      ? "读取清单（无变化）"
      : sig === prev.todoSig
        ? "写入相同清单（无变化）"
        : `待办更新为 ${todos.length} 项`;

  events.push({ at: stamp(), event: tool, detail });
  writeState(sessionId, "ledger", { events: events.slice(-40), todoSig: sig });

  const consistency = checkConsistency({ goal, todos, planPath: plan?.path ?? null, phases });
  const payload = {
    sessionId,
    cwd,
    goal,
    todos,
    phases,
    planPath: plan?.path ?? null,
    events,
    consistency,
  };

  // 三个文件落在项目根，人能直接看到，也能提交入库
  const paths = planFilePaths(cwd);
  writeIfChanged(paths.plan, renderTaskPlan(payload));
  writeIfChanged(paths.progress, renderProgress(payload));
  if (!existsSync(paths.findings)) writeIfChanged(paths.findings, findingsSkeleton());

  // 旧台账保留：它是 .zcode/plans/ 下的派生物，与项目根的三个文件内容重叠，
  // 但落点不同（一个跟计划文件并列，一个在项目根），各自服务不同场景
  const ledger = ledgerPath(cwd, sessionId, plan?.path ?? null);
  pruneLedgers(join(ledger, ".."));
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
