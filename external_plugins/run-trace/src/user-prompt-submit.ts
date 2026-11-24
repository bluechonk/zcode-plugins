/**
 * UserPromptSubmit：长跑规范的低频重申。
 *
 * SessionStart 说过一次，但长会话里模型会忘；而它忘掉的代价是「命令跑一半没动静」。
 * 这里按轮次节流重申，且只在真有问题时才说——用与 PreToolUse 同一套判据
 * 扫最近的命令，没有问题就完全不开口。
 *
 * 为什么判「最近的命令」而不是每轮都说：模型不需要每轮被告知同一条规范，
 * 只需要在它即将重复同一类错误时被提醒一次。
 */

import { disabled, emit, isSubagent, readHookInput, readState, writeState } from "./lib/hook";

/** 距上次提示超过这么多轮才重申 */
const EVERY_N_TURNS = 12;

interface State {
  lastPromptedTurn: number;
}

/** 与 SessionStart 的规范卡同源，但只留最短的可执行部分 */
const REMINDER = [
  "[run-trace] 提醒：长跑命令（训练 / 基准 / 构建 / 测试套件 / 迁移）要能看见进度、能事后追溯。",
  '不要用 `… 2>&1 | grep …` 这种写法：输出会攒到结束才出现，退出码会被吞，stderr 会消失。',
  '改用 `node "${ZCODE_PLUGIN_ROOT}/hooks/trace.mjs" --log .tmp/runs/<名字>.log -- <命令…>`，',
  "它边跑边回显、边跑边落盘，结尾写 RESULT 标记。",
].join("\n");

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input || input.hook_event_name !== "UserPromptSubmit") return;
  if (isSubagent(input)) return;

  const sessionId = input.session_id ?? "";
  if (!sessionId) return;

  // 先过节流再决定要不要说：这是每轮都跑的热路径，别做多余的事
  const state = readState<State>(sessionId, { lastPromptedTurn: 0 });
  const turn = state.lastPromptedTurn + 1;
  writeState(sessionId, { lastPromptedTurn: turn });
  if (turn !== 1 && turn % EVERY_N_TURNS !== 0) return;

  emit("UserPromptSubmit", { additionalContext: REMINDER });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
