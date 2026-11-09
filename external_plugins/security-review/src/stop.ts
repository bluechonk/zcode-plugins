/**
 * Stop：对本轮 diff 做一次 LLM 安全审查，有问题就把模型叫回来。
 *
 * 终止性保证（不写清楚很容易变成死循环）：
 *   1. 判定阻塞之前，先把基线推进到当前工作树——模型若什么都不改，下次 Stop 的
 *      diff 为空，直接放行。
 *   2. 每轮最多阻塞 MAX_BLOCKS 次（默认 2），计数在 UserPromptSubmit 时清零。
 *   3. 网关报错、模型解析不到、输出不是 JSON 一律放行——审查自身故障不阻断收尾。
 */

import { disabled, emitStopBlock, envInt, readHookInput, readState, writeState } from "./lib/hook";
import { captureBaseline, diffSince } from "./lib/git";
import { resolveModel, reviewDiff, type Finding } from "./lib/review";

const DEFAULT_BASE_URL = "http://127.0.0.1:4412/v1";

const SEVERITY_LABEL: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

function formatFindings(findings: Finding[]): string {
  const lines = [
    `[security-review] 本轮改动通过安全审查发现 ${findings.length} 处问题，请逐条判断并处理：`,
    "",
  ];
  findings.forEach((f, i) => {
    lines.push(`${i + 1}. [${SEVERITY_LABEL[f.severity] ?? f.severity}] ${f.file}`);
    lines.push(`   问题：${f.issue}`);
    if (f.fix) lines.push(`   修法：${f.fix}`);
  });
  lines.push("");
  lines.push("确认为误报就直接说明理由，不必为了消警告改坏代码；处理完再收尾。");
  return lines.join("\n");
}

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input) return;

  const event = input.hook_event_name;
  if (event !== "Stop" && event !== "SubagentStop") return;

  // 子代理自带任务边界，不套主会话的审查
  const agent = input.agent_type ?? "";
  if (agent && agent !== "zcode-agent") return;

  const sessionId = input.session_id ?? "default";
  const base = readState<{ sha?: string; cwd?: string } | null>(sessionId, "baseline", null);
  if (!base?.sha || !base.cwd) return;

  const diff = diffSince(base.cwd, base.sha, envInt("SECURITY_REVIEW_MAX_DIFF_BYTES", 60_000));
  if (!diff.text.trim() || diff.files === 0) return;

  const model = resolveModel(sessionId);
  if (!model) {
    // 解析不到模型就跳过；不提示，避免每轮都往上下文里塞一行噪音
    return;
  }

  const outcome = await reviewDiff({
    baseUrl: process.env["SECURITY_REVIEW_BASE_URL"] ?? DEFAULT_BASE_URL,
    model,
    diff: diff.text,
    timeoutMs: envInt("SECURITY_REVIEW_TIMEOUT_MS", 120_000),
  });

  // 先推进基线：即使下面决定阻塞，也要保证「模型不改 → 下轮 diff 为空 → 放行」
  const next = captureBaseline(base.cwd);
  if (next) writeState(sessionId, "baseline", { sha: next, cwd: base.cwd, at: new Date().toISOString() });

  if (outcome.status !== "ok" || outcome.findings.length === 0) return;

  const state = readState<{ blocks: number }>(sessionId, "stop", { blocks: 0 });
  if (state.blocks >= envInt("SECURITY_REVIEW_MAX_BLOCKS", 2)) return;
  writeState(sessionId, "stop", { blocks: state.blocks + 1 });

  emitStopBlock(formatFindings(outcome.findings));
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
