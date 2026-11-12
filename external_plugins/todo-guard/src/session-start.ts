/**
 * SessionStart：待办纪律卡。
 *
 * 这一版不再产生任何文件。上一版的 task_plan / progress / findings 三个文件已删除：
 * 它们与 ZCode 原生的待办机制重复，模型既要维护文件又要维护 todo 表，反而更容易脱节。
 * 现在插件只辅助原生 plan——核对待办有没有真的被用起来、更新时有没有先读后写。
 */

import { disabled, emit, isSubagent, readHookInput } from "./lib/hook";

/**
 * 纪律卡。
 *
 * 只在会话开头说一遍：这几条是「模型自己能遵守但容易忘」的；
 * 具体时机的核对交给 pre-tool 与 stop，在动作发生时就事论事地提示。
 */
const DISCIPLINE = [
  "[todo-guard] 待办纪律（插件只在动作发生时就事论事地核对，不产任何文件）：",
  "",
  "1. 多步任务先用 TodoWrite 拆解：每项写「做什么 + 怎么算完成」，一次只留一个 in_progress。",
  "2. 待办是给执行用的，不是给汇报用的：完成一项立刻标 completed，别攒到最后一起标。",
  "3. 改清单前先 TodoRead：TodoWrite 是整份替换，凭记忆重写会把没想起来的条目静默抹掉。",
  "4. 目标（/goal）与待办一起收尾：待办全完成了目标还在 active，就该 /goal clear。",
].join("\n");

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input || input.hook_event_name !== "SessionStart") return;
  if (isSubagent(input)) return;

  emit("SessionStart", { additionalContext: DISCIPLINE });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
