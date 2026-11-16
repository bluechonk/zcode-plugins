/**
 * SessionStart：报告分支状态。
 *
 * 只陈述事实，不推断意图——开局还不知道这次是不是探索式开发。
 * 三个事实：当前分支、本地有没有 dev、当前是不是主干。
 * 读不到 git（不在仓库 / detached）时完全静默，不制造噪音。
 */

import { disabled, emit, isSubagent, readHookInput, cwdOf } from "./lib/hook";
import { branchState } from "./lib/branch";

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input || input.hook_event_name !== "SessionStart") return;
  if (isSubagent(input)) return;

  const { branch, hasDev, trunk } = branchState(cwdOf(input));
  if (!branch) return; // 读不到分支：不在 git 仓库或 detached，没什么可报

  const lines: string[] = [`[dev-flow] 分支状态：当前 ${branch} · 本地 dev 分支${hasDev ? "已存在" : "不存在"}`];
  if (trunk) {
    lines.push(
      "当前在主干上。dev-flow 流程里，草稿式改动应先落 dev 分支（积累到一批再开整理会拆主题分支）；",
      "确定性任务走普通特性分支即可。"
    );
  } else if (branch === "dev") {
    lines.push("已在 dev 分支：适合继续积累草稿，或现在开整理会。");
  } else {
    lines.push(`当前在 ${branch}。若这轮是探索式改动，dev-flow 建议改到 dev 分支积累。`);
  }

  emit("SessionStart", { additionalContext: lines.join("\n") });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
