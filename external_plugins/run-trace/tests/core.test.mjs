// 干什么：验证 run-trace 的三件事——检测规则、trace 运行器（实时/落盘/退出码）、两个 hook 的注入
// 怎么跑：node .tmp/test-run-trace.mjs
// 依赖：无。用临时目录与临时脚本，不碰真实仓库。
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const HOOKS = join(
  "C:", "Users", "bluechonk", "Documents", "deepseek-harness", "default-workspace",
  "zcode-plugins", "external_plugins", "run-trace", "hooks",
);
const WORK = join(tmpdir(), "run-trace-probe");

let pass = 0;
let fail = 0;
function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`   ok  ${name}`);
  } else {
    fail++;
    console.error(`  FAIL ${name}${extra ? `：${extra}` : ""}`);
  }
}

function runHook(entry, input) {
  const r = spawnSync("node", [join(HOOKS, entry)], {
    input: JSON.stringify(input),
    encoding: "utf8",
    cwd: WORK,
    env: { ...process.env, ZCODE_PLUGIN_DATA: join(WORK, ".state") },
  });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

// ---------- 1. PreToolUse 检测 ----------
console.log("1) PreToolUse：拦会丢输出/丢退出码的写法");

function preBash(command) {
  return runHook("pre-tool.mjs", {
    hook_event_name: "PreToolUse",
    session_id: `s-${Math.random()}`,
    cwd: WORK,
    tool_name: "Bash",
    tool_input: { command },
  });
}

let out = preBash(`python train.py 2>&1 | grep -E '"event"'`);
check("长跑 + 过滤 + 无落盘：提示", out.includes("按块缓冲") && out.includes("没有落盘"), out);
check("提示里给出 tee 改法", out.includes("tee"), out);

out = preBash("python train.py --epochs 100");
check("长跑无落盘：提示", out.includes("没有把输出落到文件"), out);

out = preBash(`python train.py 2>&1 | tee .tmp/run.log | grep --line-buffered "loss"`);
check("已 tee 且 --line-buffered：不提示", out.trim() === "", out);

out = preBash("python train.py 2>&1 | tee .tmp/run.log");
check("只 tee 不筛：不提示", out.trim() === "", out);

out = preBash(`python train.py 2>&1 | grep -E "ok"`);
check("退出码被覆盖：提示", out.includes("退出码"), out);

out = preBash("python train.py 2> /dev/null");
check("丢弃 stderr：提示", out.includes("丢弃了 stderr"), out);

out = preBash("git status");
check("短命令：不提示", out.trim() === "", out);

out = preBash("ls -la && cat package.json");
check("纯查询：不提示", out.trim() === "", out);

out = preBash("npm test");
check("npm test 长跑无落盘：提示", out.includes("没有把输出落到文件"), out);

// 去重：同一命令第二次不再提示
const sameCmd = `python again.py 2>&1 | grep x`;
const sid = "s-dedup";
const first = runHook("pre-tool.mjs", {
  hook_event_name: "PreToolUse", session_id: sid, cwd: WORK,
  tool_name: "Bash", tool_input: { command: sameCmd },
});
const second = runHook("pre-tool.mjs", {
  hook_event_name: "PreToolUse", session_id: sid, cwd: WORK,
  tool_name: "Bash", tool_input: { command: sameCmd },
});
check("同命令第二次去重", first.trim() !== "" && second.trim() === "", `first=${first.slice(0, 40)} second=${second.slice(0, 40)}`);

// 语句链：长跑 + 纯查询混在一起，不应误报
out = preBash('node -e "console.log(1)" && grep -rn foo . --exclude-dir=.git | head -3');
check("长跑与 grep 查询分属两条语句：不误报", out.trim() === "", out);

out = preBash('grep -rn "plan-with-files" . | head');
check("纯 grep 查询：不误报", out.trim() === "", out);

// 同一条语句里的管道仍要报
out = preBash('python train.py | grep loss | head');
check("同语句内管道仍命中", out.includes("按块缓冲") || out.includes("没有落盘"), out);

// 回归：查询 + 长跑 组合，不能因为首段是查询就整条放过（安全审查指出）
out = preBash("grep -rn foo . && python train.py");
check("查询+长跑组合：仍报长跑风险", out.includes("没有把输出落到文件"), out);

out = preBash("find . -name x && python train.py");
check("find+长跑组合：仍报长跑风险", out.includes("没有把输出落到文件"), out);

out = preBash("ls && git status");
check("两段都是查询：不误报", out.trim() === "", out);

// ---------- 2. PostToolUse：Python 没 flush ----------
console.log("2) PostToolUse：脚本 print 没 flush");

const noFlush = [
  "import time",
  "for i in range(100):",
  '    print(f"step {i}")',
  "    time.sleep(1)",
  "print('done')",
].join("\n");
out = runHook("post-tool.mjs", {
  hook_event_name: "PostToolUse", session_id: "s2", cwd: WORK,
  tool_name: "Write", tool_input: { file_path: "train.py", content: noFlush },
});
check("多 print 无 flush：提示", out.includes("没开 flush"), out);

const withFlush = noFlush.replace(/print\(f"step \{i\}"\)/, 'print(f"step {i}", flush=True)')
  .replace("print('done')", "print('done', flush=True)");
out = runHook("post-tool.mjs", {
  hook_event_name: "PostToolUse", session_id: "s3", cwd: WORK,
  tool_name: "Write", tool_input: { file_path: "train.py", content: withFlush },
});
check("已 flush：不提示", out.trim() === "", out);

out = runHook("post-tool.mjs", {
  hook_event_name: "PostToolUse", session_id: "s4", cwd: WORK,
  tool_name: "Write", tool_input: { file_path: "x.ts", content: noFlush },
});
check("非 Python 文件：不提示", out.trim() === "", out);

// ---------- 3. trace 运行器 ----------
console.log("3) trace 运行器");

const TRACE = join(HOOKS, "trace.mjs");
const slowPy = join(WORK, "slow.py");
writeFileSync(slowPy, [
  "import time",
  "for i in range(4):",
  '    print(f"tick {i}", flush=True)',
  "    time.sleep(1)",
].join("\n"));

const crashPy = join(WORK, "crash.py");
writeFileSync(crashPy, [
  "import sys",
  'print("started", flush=True)',
  'sys.stderr.write("FATAL: out of memory\\n")',
  "sys.stderr.flush()",
  "sys.exit(7)",
].join("\n"));

function runTraceAsync(args) {
  return new Promise((resolve) => {
    const child = spawn("node", [TRACE, ...args], { cwd: WORK, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

// 3a. 正常结束
const logOk = join(WORK, "ok.log");
let r = await runTraceAsync(["--log", logOk, "--", `python "${slowPy}"`]);
let body = readFileSync(logOk, "utf8");
check("成功：退出码 0", r.code === 0, `code=${r.code} ${r.stderr.slice(0, 200)}`);
check("成功：日志有 RESULT success", body.includes("# RESULT: success"), body.slice(-200));
check("成功：日志有全部 4 行输出", (body.match(/tick \d/gu) ?? []).length === 4);
check("成功：每行带时间戳", /\[\d{2}:\d{2}:\d{2}\.\d{3}\] tick 0/u.test(body), body.slice(0, 300));
check("成功：终端也看得到输出", r.stdout.includes("tick 3"), r.stdout);

// 3b. 崩溃：退出码透传 + stderr 进日志
const logCrash = join(WORK, "crash.log");
r = await runTraceAsync(["--log", logCrash, `--`, `python "${crashPy}"`]);
body = readFileSync(logCrash, "utf8");
check("崩溃：退出码 7 透传", r.code === 7, `code=${r.code}`);
check("崩溃：日志含 stderr 内容", body.includes("FATAL: out of memory"), body);
check("崩溃：stderr 行有 E 标记", /\] E FATAL/u.test(body), body);
check("崩溃：RESULT failure", body.includes("# RESULT: failure"));

// 3c. 超时
const logTimeout = join(WORK, "timeout.log");
r = await runTraceAsync(["--log", logTimeout, "--timeout", "2", "--", `python "${slowPy}"`]);
body = readFileSync(logTimeout, "utf8");
check("超时：退出码 124", r.code === 124, `code=${r.code}`);
check("超时：日志标 TIMEOUT", body.includes("TIMEOUT"), body.slice(-300));
check("超时：RESULT timeout", body.includes("# RESULT: timeout"));

// 3d. 边跑边写：跑一半时文件已经有内容
const logLive = join(WORK, "live.log");
const live = spawn("node", [TRACE, "--log", logLive, "--", `python "${slowPy}"`], { cwd: WORK, env: process.env });
live.stdout.on("data", () => {});
live.stderr.on("data", () => {});
await new Promise((r2) => setTimeout(r2, 2500));
const midway = existsSync(logLive) ? readFileSync(logLive, "utf8") : "";
const midwayLines = midway.split("\n").filter((l) => /tick \d/u.test(l)).length;
check("边跑边写：2.5 秒时已有输出行", midwayLines >= 2, `lines=${midwayLines} content=${midway.slice(0, 200)}`);
check("边跑边写：此时还没结束标记", !midway.includes("# RESULT:"), midway.slice(-100));
live.kill("SIGKILL");
await new Promise((r2) => setTimeout(r2, 300));

// 3e. 强杀后：已有内容保留，且没有 RESULT 标记（这就是「被杀」的凭证）
body = readFileSync(logLive, "utf8");
check("被强杀：已有输出保留", /tick \d/u.test(body), body.slice(0, 200));
check("被强杀：无 RESULT 标记", !body.includes("# RESULT:"), body.slice(-150));

// 3f. 默认日志路径落在 .tmp/runs
const before = existsSync(join(WORK, ".tmp", "runs")) ? 1 : 0;
r = await runTraceAsync(["--", "node -e \"console.log('hi')\""]);
const runsDir = join(WORK, ".tmp", "runs");
check("默认落点 .tmp/runs", existsSync(runsDir), runsDir);
check("默认路径也写了日志", existsSync(runsDir) && readFileSync(join(runsDir, (await import("node:fs")).readdirSync(runsDir)[0]), "utf8").includes("hi"));

// 3g. 参数错误
r = await runTraceAsync([]);
check("无命令：退出码 2", r.code === 2, `code=${r.code}`);

// ---------- 3h. 回显节流 ----------
console.log("3h) 回显节流：日志全量、终端抽样");

const floodPy = join(WORK, "flood.py");
writeFileSync(floodPy, ["for i in range(300):", '    print(f"line {i}", flush=True)'].join("\n"));

const logFlood = join(WORK, "flood.log");
r = await runTraceAsync(["--log", logFlood, "--echo-rate", "10", "--", `python "${floodPy}"`]);
const floodBody = readFileSync(logFlood, "utf8");
const logLines = (floodBody.match(/line \d+/gu) ?? []).length;
const echoLines = (r.stdout.match(/line \d+/gu) ?? []).length;
check("节流：日志仍是全量 300 行", logLines === 300, `logLines=${logLines}`);
check("节流：终端回显被压缩", echoLines < logLines, `echo=${echoLines} log=${logLines}`);
check("节流：有省略提示", r.stdout.includes("已省略"), r.stdout.slice(0, 300));

// 不限速时全量回显
const logAll = join(WORK, "all.log");
r = await runTraceAsync(["--log", logAll, "--", `python "${floodPy}"`]);
const echoAll = (r.stdout.match(/line \d+/gu) ?? []).length;
check("默认不限速：终端全量", echoAll === 300, `echo=${echoAll}`);

// ---------- 3i. 跨 shell：pwsh 与 git bash ----------
console.log("3i) 跨 shell 支持");

out = preBash('pwsh -NoProfile -File "./scripts/bench.ps1"');
check("pwsh -File 识别为长跑", out.includes("没有把输出落到文件"), out);

out = preBash('powershell.exe -File "C:/x.ps1"');
check("powershell.exe -File 识别为长跑", out.includes("没有把输出落到文件"), out);

out = preBash("dotnet build --configuration Release");
check("dotnet build 识别为长跑", out.includes("没有把输出落到文件"), out);

out = preBash("uv sync");
check("uv sync 识别为长跑", out.includes("没有把输出落到文件"), out);

out = preBash("git clone https://github.com/x/y.git");
check("git clone 识别为长跑", out.includes("没有把输出落到文件"), out);

// ---------- 3j. SessionStart / UserPromptSubmit ----------
console.log("3j) 提示注入");

const ss = runHook("session-start.mjs", {
  hook_event_name: "SessionStart", session_id: "s-ss", cwd: WORK,
});
check("SessionStart 注入规范卡", ss.includes("可观测性规范"), ss.slice(0, 200));
check("规范卡讲明「Agent 能看到的=人能看到的」", ss.includes("Agent 能看到的输出"), ss);
check("规范卡给出 trace 用法", ss.includes("trace.mjs"), ss);
check("规范卡留了「什么时候不必」", ss.includes("什么时候不必"), ss);

const ups1 = runHook("user-prompt-submit.mjs", {
  hook_event_name: "UserPromptSubmit", session_id: "s-ups", cwd: WORK,
});
check("首轮重申出提醒", ups1.includes("run-trace"), ups1.slice(0, 150));
let upsMid = "";
for (let i = 2; i <= 11; i += 1) {
  upsMid += runHook("user-prompt-submit.mjs", {
    hook_event_name: "UserPromptSubmit", session_id: "s-ups", cwd: WORK,
  });
}
check("第 2-11 轮被节流", upsMid.trim() === "", upsMid.slice(0, 150));

// ---------- 4. 关键回归：trace 不吞退出码 ----------
console.log("4) 关键回归：对比 shell 管道与 trace");
const pipeRun = spawnSync("bash", ["-c", `python "${crashPy}" 2>&1 | grep -E "started"`], { cwd: WORK, encoding: "utf8" });
check("对照：shell 管道把退出码吞成 0", pipeRun.status === 0, `status=${pipeRun.status}`);
const traceRun = spawnSync("node", [TRACE, "--log", join(WORK, "reg.log"), "--", `python "${crashPy}"`], { cwd: WORK, encoding: "utf8" });
check("trace 保住真实退出码 7", traceRun.status === 7, `status=${traceRun.status}`);

rmSync(WORK, { recursive: true, force: true });
console.log(`\n${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
