/**
 * 三个规划文件的渲染与落点。
 *
 * 与 planning-with-files 的形态对齐，但职责不同：task_plan 与 progress 由插件
 * 从数据库派生（模型零负担），findings 由模型手写（那是数据库里没有的东西）。
 *
 * 为什么不把三个都交给模型写：planning-with-files 自己承认「计划被工具结果、
 * 协作者或 bug 静默改写」，于是需要 SHA-256 attestation、parallel-write guard
 * 来补救。派生出来的文件不会有这个问题——它们永远与库一致。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { GoalInfo, TodoItem } from "./zcode-db";
import type { LedgerEvent } from "./ledger";

export interface PlanFilesInput {
  sessionId: string;
  cwd: string;
  goal: GoalInfo | null;
  todos: TodoItem[];
  phases: string[];
  planPath: string | null;
  events: LedgerEvent[];
  consistency: string[];
}

function short(text: string, n: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= n ? one : `${one.slice(0, n)}…`;
}

/** 从待办推断阶段状态：阶段名与待办内容有词重叠时，按待办状态映射 */
function phaseStatus(phase: string, todos: TodoItem[]): "pending" | "in_progress" | "complete" | null {
  const key = short(phase, 12);
  const related = todos.filter((t) => t.content.includes(key) || key.includes(short(t.content, 12)));
  if (related.length === 0) return null;
  if (related.every((t) => t.status === "completed")) return "complete";
  if (related.some((t) => t.status === "in_progress")) return "in_progress";
  return "pending";
}

/** task_plan.md：目标 + 下一步 + 阶段列表。阶段状态从待办推断，推不出就标 pending */
export function renderTaskPlan(input: PlanFilesInput): string {
  const open = input.todos.filter((t) => t.status !== "completed");
  const doing = input.todos.find((t) => t.status === "in_progress");
  const next = doing?.content ?? open[0]?.content ?? "（无待办，任务可能已收尾）";

  const lines: string[] = ["# 任务计划", ""];
  lines.push(`- 会话：${input.sessionId}`);
  lines.push(`- 更新：${new Date().toISOString().replace("T", " ").slice(0, 16)}`);
  lines.push("");

  lines.push("## 目标", "");
  lines.push(input.goal ? short(input.goal.objective, 200) : "（未设置 /goal）");
  lines.push("");

  lines.push("## 下一步", "");
  lines.push(short(next, 160));
  lines.push("");

  lines.push("## 阶段", "");
  if (input.phases.length === 0) {
    lines.push("（无计划文件，或未提取到阶段标题）");
  } else {
    for (const [i, phase] of input.phases.entries()) {
      const status = phaseStatus(phase, input.todos) ?? "pending";
      lines.push(`### 阶段 ${i + 1}：${phase}`);
      lines.push(`- **状态**：${status}`);
      lines.push("");
    }
  }

  if (input.consistency.length > 0) {
    lines.push("## 一致性检查", "");
    for (const c of input.consistency) lines.push(`- ${c}`);
    lines.push("");
  }

  lines.push("> 本文件由插件从会话库派生，不要手改——改了下次会被覆盖。");
  return `${lines.join("\n")}\n`;
}

/** progress.md：按时间的活动线与当前待办快照 */
export function renderProgress(input: PlanFilesInput): string {
  const done = input.todos.filter((t) => t.status === "completed").length;
  const lines: string[] = ["# 进度日志", ""];
  lines.push(`- 会话：${input.sessionId}`);
  lines.push(`- 更新：${new Date().toISOString().replace("T", " ").slice(0, 16)}`);
  lines.push("");

  lines.push("## 当前待办", "");
  if (input.todos.length === 0) {
    lines.push("（还没有待办）");
  } else {
    for (const t of input.todos) {
      const mark = t.status === "completed" ? "x" : t.status === "in_progress" ? ">" : " ";
      lines.push(`- [${mark}] ${t.content}`);
    }
    lines.push("", `完成 ${done} / ${input.todos.length}`);
  }
  lines.push("");

  lines.push("## 活动线", "");
  if (input.events.length === 0) {
    lines.push("（暂无记录）");
  } else {
    lines.push("| 时间 | 事件 | 变化 |", "| --- | --- | --- |");
    for (const e of input.events.slice(-40)) {
      lines.push(`| ${e.at} | ${e.event} | ${e.detail} |`);
    }
  }
  lines.push("");
  lines.push("> 本文件由插件从会话库派生，不要手改——改了下次会被覆盖。");
  return `${lines.join("\n")}\n`;
}

/** findings.md 的初始骨架：只在文件不存在时写，之后交给模型维护 */
export function findingsSkeleton(): string {
  return [
    "# 调研与决策",
    "",
    "> 本文件由你维护：记录调研结果、技术决策与理由、遇到的问题。",
    "> 这是三个规划文件里唯一不由插件生成的——数据库里没有这些信息，压缩后就丢了。",
    "",
    "## 需求",
    "",
    "（用户要什么，具体到可验收）",
    "",
    "## 调研结果",
    "",
    "（查到了什么，带来源）",
    "",
    "## 技术决策",
    "",
    "| 决策 | 理由 |",
    "| --- | --- |",
    "|  |  |",
    "",
    "## 遇到的问题",
    "",
    "| 问题 | 处理 |",
    "| --- | --- |",
    "|  |  |",
    "",
  ].join("\n");
}

export function planFilePaths(cwd: string): { plan: string; findings: string; progress: string } {
  return {
    plan: join(cwd, "task_plan.md"),
    findings: join(cwd, "findings.md"),
    progress: join(cwd, "progress.md"),
  };
}

export function writeIfChanged(path: string, content: string): void {
  try {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf8");
  } catch {
    // 写不进去只影响可读性，不影响任何判定
  }
}
