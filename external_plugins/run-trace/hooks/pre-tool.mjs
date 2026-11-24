// 本文件由 scripts/build.mjs 从 external_plugins/run-trace/src/pre-tool.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/run-trace/src/lib/hook.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      data += c;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}
async function readHookInput() {
  const raw = await readStdin();
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function isSubagent(input) {
  const agent = input.agent_type ?? "";
  return agent !== "" && agent !== "zcode-agent";
}
function emit(hookEventName, inner) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, ...inner } }));
}
function stateDir() {
  return process.env["ZCODE_PLUGIN_DATA"] ?? process.env["CLAUDE_PLUGIN_DATA"] ?? join(homedir(), ".zcode", "run-trace");
}
function statePath(sessionId) {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "_") || "default";
  return join(stateDir(), `${safe}.json`);
}
function readState(sessionId, fallback) {
  try {
    return JSON.parse(readFileSync(statePath(sessionId), "utf8")) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeState(sessionId, value) {
  try {
    const p = statePath(sessionId);
    let current = {};
    if (value && typeof value === "object") current = readState(sessionId, {});
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ ...current, ...value }), "utf8");
  } catch {
  }
}
function disabled() {
  return process.env["RUN_TRACE_DISABLE"] === "1";
}

// external_plugins/run-trace/src/lib/risks.ts
var LONG_RUNNING = /(?:^|[;&|]\s*|\bthen\s+|\bdo\s+)(?:\.\/)?(?:[\w./\\-]*[\\/])?(?:python3?(?:\.exe)?|py\.exe|node|npm|npx|pnpm|yarn|bun|deno|pytest|uv\s+(?:run|sync|pip)|pip3?|poetry|cargo|go\s+(?:run|test|build|generate)|dotnet|java|mvn|gradlew?|gradle|docker\s+(?:build|run|compose)|make|cmake|ninja|tsc|vite|webpack|next|nuxt|ollama|nvidia-smi\s+-l|git\s+clone|git\s+submodule|(?:pwsh|powershell)(?:\.exe)?\s+(?:-\w+\s+)*(?:-File|-Command))\b/iu;
var FILTERING_TAIL = /\|\s*(?:grep|egrep|fgrep|rg|ag|ack|awk|sed|head|tail|sort|uniq|jq|cut|wc)\b/iu;
var MASKS_EXIT_CODE = /\|\s*(?:grep|egrep|fgrep|rg|ag|ack|awk|sed|head|tail|sort|uniq|jq|cut|wc)\b[^|]*$/iu;
var HAS_TEE = /\|\s*tee\b/iu;
var HAS_LINE_BUFFERED = /--line-buffered\b/iu;
var HAS_REDIRECT = />{1,2}\s*(?!&)\S/u;
var looksShortLived = (command) => {
  const trimmed = command.trim();
  if (trimmed.length > 400) return false;
  return /^(?:git\s+(?:status|log|diff|show|branch|remote|rev-parse)|ls|cat|head|tail|echo|printf|which|where|node\s+-v|npm\s+-v|python3?\s+--version|pwd|cd|mkdir|rm|cp|mv|touch)\b/u.test(
    trimmed
  );
};
function traceRisks(command) {
  if (!command.trim()) return [];
  if (looksShortLived(command)) return [];
  const hits = [];
  const longRunning = LONG_RUNNING.test(command);
  const hasFilter = FILTERING_TAIL.test(command);
  const persisted = HAS_TEE.test(command) || HAS_REDIRECT.test(command);
  if (longRunning && hasFilter && !persisted) {
    hits.push({
      rule: "no-trace-long-run",
      message: "\u957F\u8DD1\u547D\u4EE4\u7684\u8F93\u51FA\u7ECF\u8FC7\u8FC7\u6EE4\u5668\u4E14\u6CA1\u6709\u843D\u76D8\uFF1A\u975E tty \u4E0B grep \u4F1A\u6309\u5757\u7F13\u51B2\uFF0C\u4E2D\u9014\u4F60\u53EF\u80FD\u4E00\u884C\u90FD\u770B\u4E0D\u5230\uFF1B\u8FDB\u7A0B\u82E5\u5D29\u6389\uFF0C\u73B0\u573A\u4E5F\u968F\u7BA1\u9053\u6D88\u5931\u3002\n   \u6539\u6CD5\uFF1A`\u2026 2>&1 | tee .tmp/run.log | grep --line-buffered <\u6A21\u5F0F>`\uFF08tee \u5148\u843D\u76D8\uFF0C--line-buffered \u4FDD\u4F4F\u5B9E\u65F6\u6027\uFF09\uFF0C\u6216\u76F4\u63A5 `\u2026 2>&1 | tee .tmp/run.log` \u4E0D\u7B5B\u3002"
    });
  }
  if (longRunning && !persisted && !hasFilter) {
    hits.push({
      rule: "no-log-long-run",
      message: "\u957F\u8DD1\u547D\u4EE4\u6CA1\u6709\u628A\u8F93\u51FA\u843D\u5230\u6587\u4EF6\uFF1A\u80FD\u770B\u5230\u6EDA\u52A8\uFF0C\u4F46\u8FDB\u7A0B\u4E00\u5D29\u3001\u4F1A\u8BDD\u4E00\u65AD\uFF0C\u73B0\u573A\u5C31\u6CA1\u4E86\u3002\n   \u6539\u6CD5\uFF1A\u52A0 `2>&1 | tee .tmp/<\u540D\u5B57>.log`\uFF1B\u9700\u8981\u7B5B\u9009\u65F6\u5728\u540E\u9762\u518D\u63A5 `| grep --line-buffered <\u6A21\u5F0F>`\u3002"
    });
  }
  if (MASKS_EXIT_CODE.test(command) && !HAS_LINE_BUFFERED.test(command)) {
    hits.push({
      rule: "masked-exit-code",
      message: "\u7BA1\u9053\u6700\u540E\u4E00\u6BB5\u662F\u8FC7\u6EE4\u5668\uFF0C`$?` \u4F1A\u53D8\u6210\u8FC7\u6EE4\u5668\u7684\u9000\u51FA\u7801\u2014\u2014\u4E0A\u6E38\u5D29\u4E86\u4E5F\u53EF\u80FD\u663E\u793A\u6210\u529F\uFF08\u5B9E\u6D4B\uFF1A\u5D29\u6E83\u7684 python \u7ECF `| grep` \u540E\u9000\u51FA\u7801\u4ECE 3 \u53D8\u6210 0\uFF09\u3002\n   \u6539\u6CD5\uFF1A`set -o pipefail` \u540E\u63A5\u7BA1\u9053\uFF0C\u6216\u5148 `\u2026 > .tmp/run.log 2>&1` \u518D\u5355\u72EC\u68C0\u67E5 `$?`\u3002"
    });
  }
  if (/\b2>\s*\/dev\/null\b/u.test(command) && longRunning) {
    hits.push({
      rule: "stderr-discarded",
      message: "\u957F\u8DD1\u547D\u4EE4\u4E22\u5F03\u4E86 stderr\uFF08`2> /dev/null`\uFF09\uFF1A\u62A5\u9519\u4E0E\u8B66\u544A\u5168\u90E8\u6D88\u5931\uFF0C\u5931\u8D25\u65F6\u65E0\u4ECE\u8FFD\u67E5\u3002\n   \u6539\u6CD5\uFF1A`2>&1 | tee .tmp/run.log`\uFF0C\u628A stderr \u4E5F\u7559\u4E0B\u3002"
    });
  }
  return hits;
}

// external_plugins/run-trace/src/pre-tool.ts
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input || input.hook_event_name !== "PreToolUse") return;
  if (isSubagent(input)) return;
  if ((input.tool_name ?? "") !== "Bash") return;
  const command = input.tool_input?.["command"];
  if (typeof command !== "string") return;
  const risks = traceRisks(command);
  if (risks.length === 0) return;
  const sessionId = input.session_id ?? "";
  if (!sessionId) {
    emit("PreToolUse", { additionalContext: format(risks) });
    return;
  }
  const state = readState(sessionId, { seen: [] });
  const seen = new Set(state.seen ?? []);
  const fresh = risks.filter((r) => !seen.has(`${r.rule}	${command}`));
  if (fresh.length === 0) return;
  for (const r of fresh) seen.add(`${r.rule}	${command}`);
  writeState(sessionId, { seen: [...seen] });
  emit("PreToolUse", { additionalContext: format(fresh) });
}
function format(risks) {
  const lines = [
    `[run-trace] \u8FD9\u6761\u547D\u4EE4\u6709 ${risks.length} \u5904\u4F1A\u8BA9\u8FD0\u884C\u8FC7\u7A0B\u300C\u770B\u4E0D\u89C1\u300D\u6216\u300C\u4E8B\u540E\u67E5\u4E0D\u5230\u300D\uFF1A`,
    "",
    ...risks.map((r, i) => `${i + 1}. ${r.message}`),
    "",
    "\u5224\u65AD\u8FD9\u91CC\u786E\u5B9E\u4E0D\u9700\u8981\uFF08\u6BD4\u5982\u9A6C\u4E0A\u91CD\u8DD1\u3001\u6216\u53EA\u5173\u5FC3\u672B\u5C3E\u7ED3\u679C\uFF09\u5C31\u8BF4\u660E\u7406\u7531\u7EE7\u7EED\u3002"
  ];
  return lines.join("\n");
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
