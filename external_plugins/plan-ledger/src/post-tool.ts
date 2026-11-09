/**
 * PostToolUse：TodoWrite / TodoRead 之后刷新台账。
 *
 * 待办一律从会话库读，不解析 tool_response —— 库是权威持久态，
 * 而且 TodoRead 与 TodoWrite 走同一条读取路径，行为一致。
 */

import { disabled, isSubagent, readHookInput, readState, writeState } from "./lib/hook";
import { checkConsistency } from "./lib/consistency";
import { ledgerPath, renderLedger, writeLedger, type LedgerEvent } from "./lib/ledger";
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
  const content = renderLedger({
    sessionId,
    planPath: plan?.path ?? null,
    phases,
    goal,
    todos,
    events,
    consistency,
  });
  writeLedger(ledgerPath(cwd, sessionId, plan?.path ?? null), content);
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
