/**
 * UserPromptSubmit：多步任务的拆解建议。
 *
 * 只在「看着像多步任务、且本轮还没写过待办」时注入，每个会话上限 3 次。
 * 不重复原生提醒：ZCode 自带「10 轮没写待办」的注入，那条是轮次触发的；
 * 这条是提问触发的，在任务开始前给，时机不同。
 */

import { disabled, emit, isSubagent, readHookInput, readState, writeState } from "./lib/hook";
import { usedToolThisTurn } from "./lib/zcode-db";

/** 每个会话最多注入几次 */
const MAX_PROMPTS_PER_SESSION = 3;

/** 提问长度超过此值视为多步任务（字符数） */
const MULTI_STEP_LENGTH = 80;

/** 多步任务的特征词 */
const MULTI_STEP_HINTS =
  /实现|新增|添加|重构|改造|迁移|修复|排查|调研|设计|规划|优化|接入|替换|升级|帮我做|做一个|写一个|整理|清理|拆分|合并/iu;

const TEMPLATE = [
  "[todo-guard] 这看起来是多步任务。建议先用 TodoWrite 拆解：",
  "",
  "1. 每项写清「做什么 + 怎么算完成」——验收标准比动作描述更重要",
  "2. 按依赖顺序排列，被依赖的在前",
  "3. 一次只留一个 in_progress，其余 pending",
  "4. 完成后立刻标 completed，不要攒到最后一起标",
].join("\n");

interface State {
  prompts: number;
}

function looksMultiStep(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (text.length >= MULTI_STEP_LENGTH) return true;
  return MULTI_STEP_HINTS.test(text);
}

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input || input.hook_event_name !== "UserPromptSubmit") return;
  if (isSubagent(input)) return;

  const sessionId = input.session_id ?? "";
  if (!sessionId) return;

  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  if (!looksMultiStep(prompt)) return;
  if (usedToolThisTurn(sessionId, "TodoWrite")) return; // 已经在用待办，不打扰

  const state = readState<State>(sessionId, "prompts", { prompts: 0 });
  if (state.prompts >= MAX_PROMPTS_PER_SESSION) return;

  writeState(sessionId, "prompts", { prompts: state.prompts + 1 });
  emit("UserPromptSubmit", { additionalContext: TEMPLATE });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
