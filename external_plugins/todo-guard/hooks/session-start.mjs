// 本文件由 scripts/build.mjs 从 external_plugins/todo-guard/src/session-start.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/todo-guard/src/lib/hook.ts
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
function envFlag(name) {
  return process.env[name] === "1";
}
function disabled() {
  return envFlag("TODO_GUARD_DISABLE");
}

// external_plugins/todo-guard/src/session-start.ts
var DISCIPLINE = [
  "[todo-guard] \u5F85\u529E\u7EAA\u5F8B\uFF08\u63D2\u4EF6\u53EA\u5728\u52A8\u4F5C\u53D1\u751F\u65F6\u5C31\u4E8B\u8BBA\u4E8B\u5730\u6838\u5BF9\uFF0C\u4E0D\u4EA7\u4EFB\u4F55\u6587\u4EF6\uFF09\uFF1A",
  "",
  "1. \u591A\u6B65\u4EFB\u52A1\u5148\u7528 TodoWrite \u62C6\u89E3\uFF1A\u6BCF\u9879\u5199\u300C\u505A\u4EC0\u4E48 + \u600E\u4E48\u7B97\u5B8C\u6210\u300D\uFF0C\u4E00\u6B21\u53EA\u7559\u4E00\u4E2A in_progress\u3002",
  "2. \u5F85\u529E\u662F\u7ED9\u6267\u884C\u7528\u7684\uFF0C\u4E0D\u662F\u7ED9\u6C47\u62A5\u7528\u7684\uFF1A\u5B8C\u6210\u4E00\u9879\u7ACB\u523B\u6807 completed\uFF0C\u522B\u6512\u5230\u6700\u540E\u4E00\u8D77\u6807\u3002",
  "3. \u6539\u6E05\u5355\u524D\u5148 TodoRead\uFF1ATodoWrite \u662F\u6574\u4EFD\u66FF\u6362\uFF0C\u51ED\u8BB0\u5FC6\u91CD\u5199\u4F1A\u628A\u6CA1\u60F3\u8D77\u6765\u7684\u6761\u76EE\u9759\u9ED8\u62B9\u6389\u3002",
  "4. \u76EE\u6807\uFF08/goal\uFF09\u4E0E\u5F85\u529E\u4E00\u8D77\u6536\u5C3E\uFF1A\u5F85\u529E\u5168\u5B8C\u6210\u4E86\u76EE\u6807\u8FD8\u5728 active\uFF0C\u5C31\u8BE5 /goal clear\u3002"
].join("\n");
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input || input.hook_event_name !== "SessionStart") return;
  if (isSubagent(input)) return;
  emit("SessionStart", { additionalContext: DISCIPLINE });
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
