/**
 * PreToolUse：待办纪律核对。
 *
 * 只做两件事，都是原生不会做的：
 *   1. TodoWrite 之前核对「有没有先 TodoRead」——TodoWrite 是整份替换，
 *      没先读就凭记忆重写会静默抹掉库里的条目（见 lib/todo-discipline.ts 的 droppedOpenTodos）
 *   2. ExitPlanMode 提交计划时提示标题带上主题——侧边栏用第一个标题当计划名
 *
 * 刻意**不拦任何工具**。本插件曾是 plan 模式的接管者（拦下 EnterPlanMode），
 * 现在定位改为辅助原生 plan：只提示，不阻断。
 */

import { disabled, emit, isSubagent, readHookInput, readState, writeState } from "./lib/hook";
import { droppedOpenTodos, parseTodos } from "./lib/todo-discipline";
import { readTodos, usedToolThisTurn } from "./lib/zcode-db";

/**
 * 计划标题是否只有「Context」这类通用词。
 *
 * ZCode 的侧边栏「计划」面板显示每份计划的第一个标题。plan 模式规范要求正文
 * 以 `## Context` 开头，于是每次提交的计划在侧边栏都叫「Context」——多次规划后
 * 完全分不清哪份是哪份。这里检测裸标题并提示带上主题。
 */
const GENERIC_TITLE = /^#{1,3}\s+(context|背景|概述|概要|说明)\s*$/iu;

function genericTitleOf(plan: string): string | null {
  for (const line of plan.split("\n")) {
    const m = /^(#{1,3})\s+(.+?)\s*$/u.exec(line);
    if (!m) continue;
    return GENERIC_TITLE.test(line) ? (m[2] as string) : null;
  }
  return null;
}

interface State {
  /** 上一个被提示过覆盖问题的清单指纹，避免同一条反复报 */
  lastDropSignature?: string;
}

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input || input.hook_event_name !== "PreToolUse") return;
  if (isSubagent(input)) return;

  const sessionId = input.session_id ?? "";
  if (!sessionId) return;

  const tool = input.tool_name ?? "";
  const toolInput = input.tool_input ?? {};

  if (tool === "TodoWrite") {
    const dropped = droppedOpenTodos({
      previous: readTodos(sessionId),
      next: parseTodos(toolInput),
      readFirst: usedToolThisTurn(sessionId, "TodoRead"),
    });
    if (dropped.length === 0) return;

    // 同一份清单反复写（模型先写错再改正）时只提示一次
    const signature = dropped.join("|");
    const state = readState<State>(sessionId, "discipline", {});
    if (state.lastDropSignature === signature) return;
    writeState(sessionId, "discipline", { ...state, lastDropSignature: signature });

    emit("PreToolUse", {
      additionalContext:
        `[todo-guard] 本次 TodoWrite 会让 ${dropped.length} 项未完成待办从清单里消失：\n` +
        dropped.map((c) => `- ${c}`).join("\n") +
        "\nTodoWrite 是整份替换，不是增量。确实做完了就标 completed 而不是删掉；" +
        "只是没想起来的话，先 TodoRead 取回完整清单再改。",
    });
    return;
  }

  if (tool !== "ExitPlanMode") return;

  // ExitPlanMode 的 plan 参数就是批准后的完整计划
  const plan = typeof toolInput["plan"] === "string" ? (toolInput["plan"] as string) : "";
  if (!plan) return;
  const generic = genericTitleOf(plan);
  if (!generic) return;

  emit("PreToolUse", {
    additionalContext:
      `[todo-guard] 计划标题「${generic}」太通用：ZCode 侧边栏用第一个标题当计划名，` +
      "多次规划后会全显示成同一个词，分不清哪份是哪份。改成带主题的写法，" +
      "例如 `## Context：<这次要做什么>`。",
  });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
