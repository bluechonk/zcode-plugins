// PUA 钩子的 ZCode 入口：按 hook_event_name 分派到 hooks/pua/ 下的 shell 脚本。
//
// 为什么需要这一层：PUA 的脚本按 Claude Code 的命令钩子契约写（type:"command"
// + sh *.sh），ZCode 只认 process 钩子，直接配 sh 要么不被识别、要么调用失败。
// 这里用 ZCode 原生的 process 钩子包一层，stdin 原样转发、stdout 原样透出，
// 输出契约（hookSpecificOutput）保持不变。
//
// 脚本 vendor 在 hooks/pua/，自包含、不依赖 CLAUDE_PLUGIN_ROOT。
//
// 事件映射与 Claude Code 侧一一对应，覆盖全部 10 个脚本：
//   SessionStart        session-restore.sh     注入风味/协议，恢复上次检查点
//   UserPromptSubmit    frustration-trigger.sh 识别用户不满，切换风味
//   PreToolUse          integrity-guard.sh     改测试/CI/状态前的边界提醒
//   PostToolUse         failure-detector.sh    累计工具失败观察
//   PostToolUseFailure  failure-detector.sh    同上（失败专用事件）
//   Stop                pua-loop-hook.sh        loop 状态机
//                       stop-feedback.sh        收尾反馈
//   SubagentStop        subagent-teardown.sh    子代理会计
//   PreCompact          checkpoint-save.sh     压缩前存数值检查点

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** 事件 → 依次执行的脚本。未列出的事件直接放行（exit 0，不注入任何内容）。 */
const SCRIPTS = {
  SessionStart: ["session-restore.sh"],
  UserPromptSubmit: ["frustration-trigger.sh"],
  PreToolUse: ["integrity-guard.sh"],
  PostToolUse: ["failure-detector.sh"],
  PostToolUseFailure: ["failure-detector.sh"],
  Stop: ["pua-loop-hook.sh", "stop-feedback.sh"],
  SubagentStop: ["subagent-teardown.sh"],
  PreCompact: ["checkpoint-save.sh"],
};

async function readStdin() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

function runScript(script, input) {
  return new Promise((resolve) => {
    const child = spawn("sh", [join(here, "pua", script)], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => {
      out += c;
    });
    child.stderr.on("data", (c) => {
      err += c;
    });
    // 起不来（没有 sh）也不能让宿主流程卡住：按放行处理
    child.on("error", () => resolve({ code: 0, out: "", err: "" }));
    child.on("close", (code) => resolve({ code: code ?? 0, out, err }));
    child.stdin.end(input);
  });
}

async function main() {
  const raw = await readStdin();
  let event = "";
  try {
    event = JSON.parse(raw).hook_event_name ?? "";
  } catch {
    // 输入不是 JSON：放行，不影响主流程
  }
  const scripts = SCRIPTS[event];
  if (!scripts) return;

  let lastOut = "";
  let lastCode = 0;

  // 每个脚本都拿原始入参：上一个脚本的输出是给宿主机的 hook 响应（JSON），
  // 不是 hook 入参，喂给下一个脚本只会让它解析失败。
  for (const script of scripts) {
    const r = await runScript(script, raw);
    if (r.err.trim()) process.stderr.write(r.err);
    lastOut = r.out;
    lastCode = r.code;
  }

  // 只透出最后一个脚本的输出：宿主机只认一份 hook 响应 JSON，
  // 多个脚本的响应拼在一起就是非法 JSON。同事件多脚本时后者优先。
  if (lastOut.trim()) process.stdout.write(lastOut);
  process.exit(lastCode);
}

await main();
