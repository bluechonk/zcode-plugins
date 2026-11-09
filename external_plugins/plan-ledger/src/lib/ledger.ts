/**
 * 台账文件：把「计划 / 目标 / 待办」三方状态写成一份人可读的 markdown。
 *
 * 落点与 ZCode 的计划文件并列（.zcode/plans/），但**绝不改写计划文件本身**——
 * 那是 ZCode 的内置产物，动它会与内置行为打架。
 *
 * 设计原则：台账是**派生物**，任何时候都能由三方状态重建；模型不需要维护它，
 * 也就不存在「模型忘了更新导致台账腐烂」的问题。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GoalInfo, TodoItem } from "./zcode-db";

export interface LedgerEvent {
  at: string;
  event: string;
  detail: string;
}

export interface LedgerInput {
  sessionId: string;
  planPath: string | null;
  phases: string[];
  goal: GoalInfo | null;
  todos: TodoItem[];
  events: LedgerEvent[];
  consistency: string[];
}

const STATUS_MARK: Record<string, string> = {
  completed: "x",
  in_progress: ">",
  pending: " ",
};

function short(text: string, n: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= n ? one : `${one.slice(0, n)}…`;
}

export function renderLedger(input: LedgerInput): string {
  const { todos } = input;
  const done = todos.filter((t) => t.status === "completed").length;
  const doing = todos.filter((t) => t.status === "in_progress").length;
  const todo = todos.filter((t) => t.status === "pending").length;
  const now = new Date().toISOString().replace("T", " ").slice(0, 16);

  const lines: string[] = ["# 计划进度", ""];
  lines.push(`- 会话: ${input.sessionId}`);
  lines.push(`- 计划: ${input.planPath ?? "（本会话没有计划文件）"}`);

  if (input.goal) {
    const g = input.goal;
    lines.push(
      `- 目标: ${g.status} · ${short(g.objective, 60)} · 已用 ${g.tokensUsed.toLocaleString("en-US")} tokens`
    );
  } else {
    lines.push("- 目标: 无（未设置 /goal）");
  }
  lines.push(`- 更新: ${now}`, "");

  lines.push("## 当前待办", "");
  if (todos.length === 0) {
    lines.push("- （本会话还没有待办）");
  } else {
    for (const t of todos) {
      lines.push(`- [${STATUS_MARK[t.status] ?? " "}] ${t.content}`);
    }
    lines.push("", `统计：${todos.length} 项 · 完成 ${done} · 进行中 ${doing} · 未开始 ${todo}`);
  }
  lines.push("");

  lines.push("## 计划阶段", "");
  if (input.phases.length === 0) {
    lines.push("- （无计划文件或未提取到阶段标题）");
  } else {
    input.phases.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
  }
  lines.push("", "> 阶段仅作导航；完成度以「当前待办」为准，目标层以 /goal 为准。", "");

  if (input.consistency.length > 0) {
    lines.push("## 一致性", "");
    for (const c of input.consistency) lines.push(`- ${c}`);
    lines.push("");
  }

  if (input.events.length > 0) {
    lines.push("## 活动线", "", "| 时间 | 事件 | 变化 |", "| --- | --- | --- |");
    for (const e of input.events.slice(-15)) {
      lines.push(`| ${e.at} | ${e.event} | ${e.detail} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** 台账落点：与计划文件同目录；找不到计划目录时退回插件数据目录 */
export function ledgerPath(cwd: string, sessionId: string, planPath: string | null): string {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "_");
  if (planPath) return join(planPath, "..", `progress-${safe}.md`);
  return join(cwd, ".zcode", "plans", `progress-${safe}.md`);
}

export function writeLedger(path: string, content: string): void {
  try {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf8");
  } catch {
    // 台账写不进去只影响可读性，不影响任何门禁判定
  }
}
