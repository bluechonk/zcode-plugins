/**
 * 待办纪律核对：纯函数，只看「库里的旧清单」与「本次要写的清单」。
 *
 * 为什么要这一层：TodoWrite 是**整份替换**，不是增量补丁。模型若没先 TodoRead
 * 就凭记忆重写，库里那些它没想起来的条目会被静默抹掉——没有任何报错，事后也查不出来。
 * 这是唯一一处「模型自己看不见、原生也不会提醒」的缺口。
 *
 * 汉字的近似匹配都刻意不做：把「看起来像同一件事」的条目当成保留会让判据变得
 * 不可预测，宁可漏报。只报「内容原样消失」这一种能确证的情况。
 */

import type { TodoItem } from "./zcode-db";

export interface TodoWriteInput {
  /** 库里的旧清单（权威） */
  previous: TodoItem[];
  /** 本次要写的清单；解析失败时为 null */
  next: Array<{ content: string; status: string }> | null;
  /** 本轮是否先做过 TodoRead */
  readFirst: boolean;
}

/** 从 TodoWrite 的入参里解析出新清单；拿不到就返回 null */
export function parseTodos(toolInput: Record<string, unknown>): Array<{ content: string; status: string }> | null {
  const raw = toolInput["todos"];
  if (!Array.isArray(raw)) return null;
  const out: Array<{ content: string; status: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const rec = item as Record<string, unknown>;
    const content = typeof rec["content"] === "string" ? rec["content"] : "";
    if (!content) return null;
    out.push({ content, status: typeof rec["status"] === "string" ? rec["status"] : "pending" });
  }
  return out;
}

/**
 * 找出「被本次写入抹掉的未完成条目」。
 *
 * 只算未完成的：已完成的条目从清单里消失是正常收尾，不算丢失。
 */
export function droppedOpenTodos(input: TodoWriteInput): string[] {
  const { previous, next, readFirst } = input;
  if (readFirst) return []; // 先读过再写，抹掉也是有意为之
  if (next === null) return []; // 入参解析不出来，不做判断
  if (previous.length === 0) return []; // 库里本来就没有待办，第一次拆解

  const kept = new Set(next.map((t) => t.content));
  return previous.filter((t) => t.status !== "completed" && !kept.has(t.content)).map((t) => t.content);
}

/**
 * 本轮是否算「干了不少活却从没拆过待办」。
 *
 * 只在会话从未有过任何待办时才提醒：已经在用待办的会话不需要这条，
 * 反复提醒只会变成噪音（原生的「10 轮没写待办」提醒也是这个口径）。
 */
export function looksUndecomposed(input: {
  allTodos: TodoItem[];
  turnToolCalls: string[];
  minToolCalls: number;
  todoWriteSeen: boolean;
}): boolean {
  const { allTodos, turnToolCalls, minToolCalls, todoWriteSeen } = input;
  if (todoWriteSeen) return false;
  if (allTodos.length > 0) return false;
  return turnToolCalls.length >= minToolCalls;
}
