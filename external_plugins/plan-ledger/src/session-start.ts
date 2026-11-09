/**
 * SessionStart：注入三方状态摘要。
 *
 * 节流参照 ZCode 自己的做法：完整摘要不是每轮都给，避免变成背景噪音。
 * 这里按「距上次注入的人话轮数」判断，超过阈值才给完整版。
 */

import { disabled, emit, readHookInput, readState, writeState } from "./lib/hook";
import { readGoal, readPlan, readTodos } from "./lib/zcode-db";

/** 距上次注入超过这么多轮才给完整摘要 */
const FULL_EVERY = 5;

function short(text: string, n: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= n ? one : `${one.slice(0, n)}…`;
}

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input || input.hook_event_name !== "SessionStart") return;

  const sessionId = input.session_id ?? "";
  const cwd = input.cwd ?? process.cwd();
  if (!sessionId) return;

  const todos = readTodos(sessionId);
  const goal = readGoal(sessionId);
  const plan = readPlan(cwd, sessionId);
  const captured = readState<{ phases?: string[] } | null>(sessionId, "plan", null);
  const phases = plan?.phases ?? captured?.phases ?? [];

  // 三方都没有：没什么可说的，保持静默
  if (todos.length === 0 && !goal && !plan) return;

  const state = readState<{ turns: number }>(sessionId, "sessionstart", { turns: 0 });
  const turns = state.turns + 1;
  const full = turns % FULL_EVERY === 0 || turns === 1;
  writeState(sessionId, "sessionstart", { turns });

  const open = todos.filter((t) => t.status !== "completed");
  const lines: string[] = ["[plan-ledger] 当前任务状态（自动汇总，非指令）：", ""];

  if (goal) {
    lines.push(`目标：${goal.status} · ${short(goal.objective, 80)}`);
  } else {
    lines.push("目标：未设置");
  }
  lines.push(`计划：${plan ? plan.path : "无计划文件"}`);

  if (todos.length > 0) {
    lines.push(
      `待办：${todos.length} 项，未完成 ${open.length} 项` +
        (open.length > 0 ? `（${open.slice(0, 3).map((t) => short(t.content, 24)).join(" / ")}${open.length > 3 ? " …" : ""}）` : "")
    );
  } else {
    lines.push("待办：无");
  }

  if (full && phases.length > 0) {
    lines.push("", "计划阶段：");
    phases.forEach((p, i) => lines.push(`${i + 1}. ${short(p, 60)}`));
  }

  if (open.length > 0) {
    lines.push("", "未完成项优先；已完成的部分不要重做。");
  }

  emit("SessionStart", { additionalContext: lines.join("\n") });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
