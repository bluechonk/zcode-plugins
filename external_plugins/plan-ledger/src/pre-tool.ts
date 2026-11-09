/**
 * PreToolUse：捕获 ExitPlanMode 提交的计划。
 *
 * 只做这一件事：plan 模式批准时，把计划正文里的阶段标题记进会话状态，
 * 供台账的「计划阶段」一栏使用。
 *
 * 刻意**不做规划门禁**。这里曾有一层「本轮没 TodoWrite 就拦下改状态的工具」，
 * 已删除，原因三条：
 *
 *   1. 判据错。那层用工具名白名单，只认识写死的十几个名字；ZCode 自己的 plan
 *      模式走权限层 checkPlanMode()，判据是工具元数据（readOnly / destructive /
 *      needsApproval），新工具自动正确。实测白名单漏掉 25 个工具，
 *      ReadSessionContext、CronList 与全部 MCP 只读查询都属于纯读，被误拦。
 *   2. 时机反。模型要先读代码才知道这任务该不该规划，而只读工具被拦，
 *      等于在摸清需求之前就逼它交计划。
 *   3. 职责重叠。ZCode 原生已有两层引导：EnterPlanMode 的 7 条触发条件
 *      （需用户审批），以及 TodoWrite 提醒（10 轮未写且距上次提醒 10 轮，
 *      措辞明确允许忽略）。插件再拦一次，只是更差的一遍。
 *
 * 规划引导交回原生；本插件专注做原生没有的台账。
 */

import { disabled, isSubagent, readHookInput, writeState } from "./lib/hook";
import { extractPhases } from "./lib/zcode-db";

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input || input.hook_event_name !== "PreToolUse") return;
  if (isSubagent(input)) return;

  const sessionId = input.session_id ?? "";
  if (!sessionId) return;
  if (input.tool_name !== "ExitPlanMode") return;

  // ExitPlanMode 的 plan 参数就是批准后的完整计划。
  // 阶段提取复用 lib 里的同一份实现——曾在这里复制过一份，加了过滤后忘了同步，
  // 导致捕获到的阶段把 Context / 验证 这类非实施小节也算进去。
  const plan = input.tool_input?.["plan"];
  if (typeof plan !== "string" || !plan.trim()) return;

  writeState(sessionId, "plan", {
    capturedAt: new Date().toISOString(),
    phases: extractPhases(plan),
    bytes: plan.length,
  });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
