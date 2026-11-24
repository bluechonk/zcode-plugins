// 本文件由 scripts/build.mjs 从 external_plugins/run-trace/src/session-start.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/run-trace/src/lib/hook.ts
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
function disabled() {
  return process.env["RUN_TRACE_DISABLE"] === "1";
}

// external_plugins/run-trace/src/session-start.ts
var RUN_RULES = [
  "[run-trace] \u957F\u8DD1\u547D\u4EE4\u7684\u53EF\u89C2\u6D4B\u6027\u89C4\u8303\uFF08\u51B3\u5B9A\u600E\u4E48\u8DD1\u4E4B\u524D\u5148\u770B\u8FD9\u6BB5\uFF09\uFF1A",
  "",
  "Agent \u80FD\u770B\u5230\u7684\u8F93\u51FA\uFF0C\u5C31\u662F\u7528\u6237\u80FD\u770B\u5230\u7684\u8F93\u51FA\u3002\u547D\u4EE4\u7684\u8F93\u51FA\u6CA1\u8FD4\u56DE\uFF0C\u4E24\u8FB9\u7684\u4E0A\u4E0B\u6587\u91CC\u90FD\u6CA1\u6709\u2014\u2014",
  "\u7528\u6237\u4E0D\u77E5\u9053\u5B83\u8DD1\u5230\u54EA\u3001\u5361\u6CA1\u5361\u6B7B\uFF1B\u4F60\u4E5F\u53EA\u80FD\u9760\u731C\u3002\u6240\u4EE5\u957F\u8DD1\u547D\u4EE4\u5FC5\u987B\u540C\u65F6\u6EE1\u8DB3\u4E09\u4EF6\u4E8B\uFF1A",
  "",
  "1. \u4EBA\u770B\u5F97\u89C1\u8FDB\u5EA6\uFF1A\u8F93\u51FA\u5B9E\u65F6\u5230\u7EC8\u7AEF\uFF0C\u4E0D\u662F\u6512\u5230\u6700\u540E\u4E00\u6B21\u6027\u51FA\u73B0\u3002",
  "2. \u76D8\u4E0A\u6709\u65E5\u5FD7\uFF1A\u8FB9\u8DD1\u8FB9\u5199\u6587\u4EF6\u3002\u8FDB\u7A0B\u88AB\u6740\u3001\u4F1A\u8BDD\u65AD\u6389\u65F6\uFF0C\u5DF2\u5199\u7684\u5185\u5BB9\u8FD8\u5728\u3002",
  "3. \u9000\u51FA\u7801\u662F\u771F\u7684\uFF1A\u547D\u4EE4\u5931\u8D25\u5C31\u662F\u5931\u8D25\uFF0C\u4E0D\u88AB\u7BA1\u9053\u4E0B\u6E38\u8986\u76D6\u6210\u6210\u529F\u3002",
  "",
  "\u63A8\u8350\u505A\u6CD5\u2014\u2014\u7528 trace \u8FD0\u884C\u5668\uFF0C\u5B83\u628A\u4E09\u4EF6\u4E8B\u4E00\u6B21\u505A\u5168\uFF1A",
  '  node "${ZCODE_PLUGIN_ROOT}/hooks/trace.mjs" --log .tmp/runs/<\u540D\u5B57>.log -- <\u547D\u4EE4\u2026>',
  "",
  "\u4E0D\u8981\u8FD9\u6837\u5199\uFF08\u4E09\u8005\u5168\u4E22\uFF09\uFF1A",
  `  python train.py 2>&1 | grep -E '"event"'`,
  "  \u5B9E\u6D4B\uFF1A\u8F93\u51FA\u6512\u5230\u7B2C 8 \u79D2\u624D\u4E00\u6B21\u6027\u51FA\u73B0\uFF1B\u5D29\u6E83\u65F6\u9000\u51FA\u7801\u4ECE 3 \u53D8\u6210 0\uFF1Bstderr \u91CC\u7684\u62A5\u9519\u5B8C\u5168\u6D88\u5931\u3002",
  "",
  "\u4EC0\u4E48\u65F6\u5019\u4E0D\u5FC5\uFF1A\u79D2\u7EA7\u547D\u4EE4\uFF08git status / ls / node -v\uFF09\u3001\u53EA\u770B\u672B\u5C3E\u51E0\u884C\u4E14\u5931\u8D25\u4EE3\u4EF7\u4F4E\u7684\u547D\u4EE4\u3002",
  "\u5224\u65AD\u786E\u5B9E\u4E0D\u9700\u8981\u5C31\u8BF4\u660E\u7406\u7531\u7EE7\u7EED\uFF0C\u4E0D\u5FC5\u4E3A\u4E86\u5408\u89C4\u628A\u7B80\u5355\u547D\u4EE4\u5305\u4E00\u5C42\u3002"
].join("\n");
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input || input.hook_event_name !== "SessionStart") return;
  if (isSubagent(input)) return;
  emit("SessionStart", { additionalContext: RUN_RULES });
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
