/**
 * SessionStart：把「长跑命令必须可观测」这条规范注入系统提示。
 *
 * 为什么放在这里而不是只靠 PreToolUse：PreToolUse 只在命令真的要跑的那一刻说话，
 * 而模型规划一个任务时就已经决定了「我要怎么跑」。等到它敲命令时才提醒，
 * 它往往已经在脑子里把「跑完再看结果」这条路走定了。
 *
 * 这条规范的核心是用户提出的那句话：**Agent 能看到的，就是人能看到的东西**。
 * 脚本输出没返回，人看不到，Agent 的上下文里也没有——它只能靠猜，或者瞎编。
 */

import { disabled, emit, isSubagent, readHookInput } from "./lib/hook";

/**
 * 规范卡。
 *
 * 分三段：为什么、怎么做、什么时候不必。第三段是刻意留的——只讲「必须」的规范
 * 会被模型当成无差别教条，遇到秒级命令也硬套，反而拖慢工作。
 */
const RUN_RULES = [
  "[run-trace] 长跑命令的可观测性规范（决定怎么跑之前先看这段）：",
  "",
  "Agent 能看到的输出，就是用户能看到的输出。命令的输出没返回，两边的上下文里都没有——",
  "用户不知道它跑到哪、卡没卡死；你也只能靠猜。所以长跑命令必须同时满足三件事：",
  "",
  "1. 人看得见进度：输出实时到终端，不是攒到最后一次性出现。",
  "2. 盘上有日志：边跑边写文件。进程被杀、会话断掉时，已写的内容还在。",
  "3. 退出码是真的：命令失败就是失败，不被管道下游覆盖成成功。",
  "",
  "推荐做法——用 trace 运行器，它把三件事一次做全：",
  '  node "${ZCODE_PLUGIN_ROOT}/hooks/trace.mjs" --log .tmp/runs/<名字>.log -- <命令…>',
  "",
  "不要这样写（三者全丢）：",
  '  python train.py 2>&1 | grep -E \'"event"\'',
  "  实测：输出攒到第 8 秒才一次性出现；崩溃时退出码从 3 变成 0；stderr 里的报错完全消失。",
  "",
  "什么时候不必：秒级命令（git status / ls / node -v）、只看末尾几行且失败代价低的命令。",
  "判断确实不需要就说明理由继续，不必为了合规把简单命令包一层。",
].join("\n");

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input || input.hook_event_name !== "SessionStart") return;
  if (isSubagent(input)) return;

  emit("SessionStart", { additionalContext: RUN_RULES });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
