#!/usr/bin/env node
/**
 * plan-gate：TodoWrite 硬门禁 + 进度落盘。
 *
 * 干什么：ZCode 内置的 TodoWrite 提醒只是「劝」，没有强制力。本 hook 在工具执行前检查
 *        本会话自最近一次真实用户提问以来是否调用过 TodoWrite，没有就 deny 改状态的工具；
 *        同时把每次 TodoWrite 的清单镜像到 ~/.zcode/progress/<session>.md，让进度在磁盘上可见。
 * 怎么跑：由 hooks/hooks.json 以 process 方式调用，stdin 是 ZCode 传入的 hook JSON
 *        （session_id / tool_name / tool_input / agent_type）。
 * 依赖：Node >= 22.5（内置 node:sqlite），只读打开 ~/.zcode/cli/db/db.sqlite。
 * 安全：任何异常一律放行（fail-open），门禁自身故障不得卡死会话。
 */

import { DatabaseSync } from "node:sqlite";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// observe：只记日志，从不拦截（用于验证插件 hook 是否真的被执行）
// enforce：按规则拦截并落盘
const MODE = "observe";

const DB_PATH = join(homedir(), ".zcode", "cli", "db", "db.sqlite");
const PROGRESS_DIR = join(homedir(), ".zcode", "progress");
const PROBE_LOG = join(homedir(), ".zcode", "plan-gate.log");

// 子代理由主代理派活、自带任务边界，不套主会话的规划门禁
const MAIN_AGENT = "zcode-agent";

// 规划前允许使用的只读 / 研究 / 元工具：先看清现状再拆任务，不必被门禁拦。
// Bash 放行：动手前先 git status / 跑测试摸现状是合理动作，不该被门禁挡住。
const ALWAYS_ALLOW = new Set([
  "TodoWrite",
  "TodoRead",
  "Read",
  "Grep",
  "Glob",
  "Bash",
  "WebSearch",
  "WebFetch",
  "ListModels",
  "AskUserQuestion",
  "Skill",
  "ToolSearch",
  "TaskOutput",
  "TaskStop",
  "SendMessage",
  "EnterPlanMode",
  "ExitPlanMode",
  "DeferredToolCall",
]);

// 距上次 TodoWrite 的工具调用数超过该值时，注入一条简短提醒让清单保持新鲜
const NUDGE_AFTER = 25;

const DENY_REASON =
  "本轮尚未规划：自上次用户提问以来没有 TodoWrite 记录。" +
  "请先调用 TodoWrite 写下任务拆解（步骤、顺序、验收标准），再执行该工具。" +
  "规划前可先用只读工具与 Bash 摸现状，但改代码类动作要先有规划。";

const PLAN_QUERY = `
SELECT
  EXISTS(
    SELECT 1 FROM part
    WHERE session_id = ?
      AND json_extract(data, '$.tool') = 'TodoWrite'
      AND time_created >= COALESCE(
        (SELECT MAX(time_created) FROM message
         WHERE session_id = ? AND json_extract(data, '$.semantics.kind') = 'user_prompt'),
        0)
  ) AS planned,
  (
    SELECT COUNT(*) FROM part
    WHERE session_id = ?
      AND json_extract(data, '$.type') = 'tool'
      AND time_created > COALESCE(
        (SELECT MAX(time_created) FROM part
         WHERE session_id = ? AND json_extract(data, '$.tool') = 'TodoWrite'),
        0)
  ) AS calls_since_todo
`;

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      try {
        resolve(data.trim() ? JSON.parse(data) : null);
      } catch {
        // 输入不是 JSON（手工测试或宿主异常）：放行，门禁不拦工具
        resolve(null);
      }
    });
    process.stdin.on("error", () => resolve(null));
  });
}

// 观察与排障用：记录每次触发的判定结果。写日志失败不影响门禁判定
function log(entry) {
  try {
    mkdirSync(homedir() + "/.zcode", { recursive: true });
    appendFileSync(
      PROBE_LOG,
      `${new Date().toISOString()} ${MODE} ${JSON.stringify(entry)}\n`,
      "utf8"
    );
  } catch {
    // 日志写不进去只损失可观测性，不影响放行判定
  }
}

// 读规划状态；任何异常返回 null 由调用方 fail-open
function readPlanState(sessionId) {
  try {
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      const row = db.prepare(PLAN_QUERY).get(sessionId, sessionId, sessionId, sessionId);
      return {
        plannedSincePrompt: Boolean(row?.planned),
        toolCallsSinceTodoWrite: Number(row?.calls_since_todo ?? 0),
      };
    } finally {
      db.close();
    }
  } catch {
    // 数据库不可读（锁定 / 损坏 / 路径变更）：当作已规划，放行
    return null;
  }
}

// 把 TodoWrite 清单镜像到磁盘，进度随时可查
function writeLedger(sessionId, input) {
  try {
    const todos = Array.isArray(input?.todos) ? input.todos : [];
    const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
    const lines = [
      "# 任务进度",
      "",
      `- session: ${sessionId || "unknown"}`,
      `- 更新: ${stamp}`,
      `- 待办数: ${todos.length}`,
      "",
      "## 待办清单",
      "",
    ];
    if (todos.length === 0) {
      lines.push("- （空）");
    }
    for (const [index, todo] of todos.entries()) {
      const mark = todo.status === "completed" ? "x" : todo.status === "in_progress" ? ">" : " ";
      lines.push(`${index + 1}. [${mark}] ${todo.content}  _(${todo.status} / ${todo.priority})_`);
    }
    lines.push("");
    const text = lines.join("\n");
    mkdirSync(PROGRESS_DIR, { recursive: true });
    writeFileSync(join(PROGRESS_DIR, `${sessionId || "unknown"}.md`), text, "utf8");
    writeFileSync(join(PROGRESS_DIR, "latest.md"), text, "utf8");
  } catch {
    // 落盘失败只影响可见性，不影响工具放行
  }
}

// ZCode 只认 hookSpecificOutput 里的 permissionDecision / additionalContext：
// 顶层 schema 非 strict，字段放错层级会被静默剥掉，门禁等于失效
function emitPermitOutput(inner) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", ...inner } })
  );
}

async function main() {
  // 逃生开关：需要临时绕过门禁时设 ZCODE_PLAN_GATE=off
  if (process.env.ZCODE_PLAN_GATE === "off") return;

  const payload = await readStdin();
  if (!payload || typeof payload !== "object") {
    log({ skip: "no-payload" });
    return;
  }

  const agent = payload.agent_type ?? payload.agentName ?? "";
  const sessionId = payload.session_id ?? payload.sessionId ?? "";
  const tool = payload.tool_name ?? payload.toolName ?? "";

  if (agent && agent !== MAIN_AGENT) {
    log({ skip: "subagent", agent, tool });
    return;
  }

  if (tool === "TodoWrite") {
    log({ action: "todo-write", sessionId });
    if (MODE === "enforce") writeLedger(sessionId, payload.tool_input ?? payload.toolInput);
    return;
  }

  // 未列出的一股脑管：会改状态的工具必须先有规划
  if (!tool || ALWAYS_ALLOW.has(tool) || !sessionId) {
    log({ skip: "allowlisted-or-unknown", tool, sessionId });
    return;
  }

  const plan = readPlanState(sessionId);
  if (!plan) {
    log({ action: "fail-open", tool, sessionId });
    return;
  }

  if (!plan.plannedSincePrompt) {
    log({ action: "deny", tool, sessionId, planned: false });
    if (MODE === "enforce") {
      emitPermitOutput({ permissionDecision: "deny", permissionDecisionReason: DENY_REASON });
    }
    return;
  }

  if (plan.toolCallsSinceTodoWrite >= NUDGE_AFTER) {
    log({ action: "nudge", tool, sessionId, calls: plan.toolCallsSinceTodoWrite });
    if (MODE === "enforce") {
      emitPermitOutput({
        additionalContext:
          `进度提醒：距上次 TodoWrite 已执行 ${plan.toolCallsSinceTodoWrite} 次工具调用，` +
          "待办清单可能已过时。请用 TodoWrite 更新进度（完成项标 completed，进行中项标 in_progress）。",
      });
    }
    return;
  }

  log({ skip: "planned", tool, sessionId });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
