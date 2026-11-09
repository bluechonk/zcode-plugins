/**
 * Stop：三方一致性核对。
 *
 * 刻意**不用 block**，只用 additionalContext：
 *   1. 多个 Stop hook 的 stopShouldContinue 是「后者覆盖前者」，返回 continue:false
 *      会静默废掉 security-review 的阻塞
 *   2. ZCode 侧续接总次数上限 3，且用户一发新消息就作废，抢这个额度不划算
 * 所以这里只提醒，不改变收尾行为。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { disabled, emit, isSubagent, readHookInput } from "./lib/hook";
import { checkConsistency } from "./lib/consistency";
import { readGoal, readPlan, readTodos } from "./lib/zcode-db";

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input) return;

  const event = input.hook_event_name;
  if (event !== "Stop" && event !== "SubagentStop") return;
  if (isSubagent(input)) return;

  const sessionId = input.session_id ?? "";
  const cwd = input.cwd ?? process.cwd();
  if (!sessionId) return;

  const todos = readTodos(sessionId);
  const goal = readGoal(sessionId);
  const plan = readPlan(cwd, sessionId);

  const issues = checkConsistency({
    goal,
    todos,
    planPath: plan?.path ?? null,
    phases: plan?.phases ?? [],
  });

  // findings.md 仍是空骨架时提醒一次：那是三个文件里唯一模型要维护的，
  // 也是唯一数据库里没有的信息——不记就随上下文压缩一起消失
  const findingsNote = emptyFindings(cwd) ? FINDINGS_REMINDER : null;

  if (issues.length === 0 && !findingsNote) return;

  const lines: string[] = [];
  if (issues.length > 0) {
    lines.push("[plan-with-files] 计划 / 目标 / 待办之间存在不一致：", "", ...issues);
  }
  if (findingsNote) {
    if (lines.length > 0) lines.push("");
    lines.push(findingsNote);
  }

  emit("Stop", { additionalContext: lines.join("\n") });
}

const FINDINGS_REMINDER =
  "[plan-with-files] findings.md 还是空骨架。如果本轮做过调研、技术选型或踩过坑，" +
  "把结论记进去——那是唯一不由插件生成的文件，上下文压缩后就没了。";

/** findings.md 存在但没有实际内容（只有骨架与空表格） */
function emptyFindings(cwd: string): boolean {
  const p = join(cwd, "findings.md");
  if (!existsSync(p)) return false; // 没建过就不提，说明还没进入需要调研的阶段
  try {
    const text = readFileSync(p, "utf8");
    // 只看正文：去掉标题、引用、表格行、列表标记与骨架里的占位说明。
    // 判据是「有没有非占位内容」，不是字数——18 字的真实结论也是结论。
    const body = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !l.startsWith(">") && !l.startsWith("|") && !l.startsWith("-"))
      .filter((l) => !/^（.*）$/u.test(l)) // 骨架里的（占位说明）
      .join("")
      .replace(/\s+/g, "");
    return body.length === 0;
  } catch {
    return false;
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
