/**
 * UserPromptSubmit：多步任务的规划模板注入。
 *
 * 背景：ZCode 内置 plan 模式产出的是「流程引导文档」，不是可执行状态，而且每次
 * 都要用户审批 ExitPlanMode。本插件改用 TodoWrite 当状态机——todo 表的
 * status（pending / in_progress / completed）+ position 天然可追踪，且不需要审批。
 *
 * 注入时机（三条同时满足才注入）：
 *   1. 本轮还没有 TodoWrite 记录（避免打断已在执行的任务）
 *   2. 用户提问看起来是多步任务（长度或关键词）
 *   3. 同一会话内未因同一问题重复注入过
 *
 * 节流：每个会话最多注入 3 次，避免变成噪音。
 */

import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

import { disabled, emit, isSubagent, readHookInput, readState, writeState } from "./lib/hook";

const DB_PATH = join(homedir(), ".zcode", "cli", "db", "db.sqlite");

/** 每个会话最多注入几次规划模板 */
const MAX_PROMPTS_PER_SESSION = 3;

/** 提问长度超过此值视为多步任务（中文字符数） */
const MULTI_STEP_LENGTH = 80;

/** 多步任务的特征词 */
const MULTI_STEP_HINTS =
  /实现|新增|添加|重构|改造|迁移|修复|排查|调研|设计|规划|优化|接入|替换|升级|实现一下|帮我做|做一个|写一个|整理|清理|拆分|合并/iu;

interface State {
  prompts: number;
}

function hasTodoThisTurn(sessionId: string): boolean {
  try {
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      const row = db
        .prepare(
          `SELECT EXISTS(
             SELECT 1 FROM part
             WHERE session_id = :sid
               AND json_extract(data, '$.tool') = 'TodoWrite'
               AND time_created >= COALESCE(
                 (SELECT MAX(time_created) FROM message
                  WHERE session_id = :sid AND json_extract(data, '$.semantics.kind') = 'user_prompt'),
                 0)
           ) AS has`
        )
        .get({ sid: sessionId }) as { has?: unknown } | undefined;
      return Boolean(row?.has);
    } finally {
      db.close();
    }
  } catch {
    return true; // 库读不到：当作已有待办，不打扰
  }
}

/** 从提问里判断是否多步任务 */
function looksMultiStep(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (text.length >= MULTI_STEP_LENGTH) return true;
  return MULTI_STEP_HINTS.test(text);
}

const TEMPLATE = [
  "[plan-ledger] 这看起来是多步任务。建议先用 TodoWrite 拆解，不需要进入 plan 模式：",
  "",
  "1. 每项写清「做什么 + 怎么算完成」——验收标准比动作描述更重要",
  "2. 按依赖顺序排 position，被依赖的在前",
  "3. 一次只留一个 in_progress，其余 pending",
  "4. 完成后立刻标 completed，不要攒到最后一起标",
  "",
  "示例：",
  "- [pending] 新增 repo-guardian 的 detect.ts：导出 hasCI / hasGitattributes / readmeChineseRatio，单测覆盖三种仓库状态",
  "- [in_progress] 写 pre-tool.ts：命中禁用命令即 deny，其余只提示，隔离测试验证不误伤",
  "",
  "待办会写进 .zcode/plans/progress-<sessionId>.md，随时可查当前进度。",
].join("\n");

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input || input.hook_event_name !== "UserPromptSubmit") return;
  if (isSubagent(input)) return;

  const sessionId = input.session_id ?? "";
  if (!sessionId) return;

  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  if (!looksMultiStep(prompt)) return;
  if (hasTodoThisTurn(sessionId)) return;

  const state = readState<State>(sessionId, "prompts", { prompts: 0 });
  if (state.prompts >= MAX_PROMPTS_PER_SESSION) return;

  writeState(sessionId, "prompts", { prompts: state.prompts + 1 });
  emit("UserPromptSubmit", { additionalContext: TEMPLATE });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
