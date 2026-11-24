/**
 * Stop：对本轮 diff 做一次 LLM 安全审查，有问题就把模型叫回来。
 *
 * 终止性保证（不写清楚很容易变成死循环）：
 *   1. 判定阻塞之前，先把基线推进到当前工作树——模型若什么都不改，下次 Stop 的
 *      diff 为空，直接放行。
 *   2. 每轮最多阻塞 MAX_BLOCKS 次（默认 2），计数在 UserPromptSubmit 时清零。
 *   3. 配置读不到、请求失败、输出不是 JSON 一律放行——审查自身故障不阻断收尾。
 *
 * 审查请求**完全复用当前会话的模型配置**（provider / baseUrl / 密钥 / 模型 id，
 * 见 lib/review.ts 的 resolveSessionConfig）：插件不掌握任何默认接入点，
 * 读不到就跳过，绝不猜一个地址发出去。
 */

import { disabled, emit, emitStopBlock, envInt, readHookInput, readState, writeState } from "./lib/hook";
import { captureBaseline, diffSince } from "./lib/git";
import { readPrefs } from "./lib/prefs";
import { resolveSessionConfig, reviewDiff, type Finding } from "./lib/review";

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

  // 用户用 /security-review-off 关掉时不发请求。基线由 UserPromptSubmit 照常推进，
  // 所以重新打开后只审「重新打开之后」的改动，不会把关着那段日子的旧账翻出来
  if (!readPrefs().llmReview) return;

  const sessionId = input.session_id ?? "default";
  const base = readState<{ sha?: string; cwd?: string } | null>(sessionId, "baseline", null);
  if (!base?.sha || !base.cwd) return;

  const diff = diffSince(base.cwd, base.sha, envInt("SECURITY_REVIEW_MAX_DIFF_BYTES", 60_000));
  if (!diff.text.trim() || diff.files === 0) return;

  const config = resolveSessionConfig(sessionId);
  if (!config) {
    // 读不到会话的模型配置（会话库不可读 / 该 provider 没配接入点）就跳过。
    // 这里提示一次：Stop 时 assistant_response 一定已落库，读不到就是真读不到，
    // 不再是 UserPromptSubmit 那一刻的时序竞态。每会话只报一次，避免刷屏。
    const state = readState<{ configWarned?: boolean }>(sessionId, "config", {});
    if (!state.configWarned) {
      writeState(sessionId, "config", { ...state, configWarned: true });
      emit("Stop", {
        additionalContext:
          "[security-review] 读不到本会话的模型配置，本轮改动的安全审查已跳过。\n" +
          "需要会话库里有 providerId + modelId，且 ~/.zcode/v2/provider_config.json 里\n" +
          "配好该 provider 的 baseUrl 与 api-key。审查不发请求比发错请求好，但要知道它没跑。",
      });
    }
    return;
  }

  const outcome = await reviewDiff({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.modelId,
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
