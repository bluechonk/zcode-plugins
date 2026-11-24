// 干什么：run-trace 的扩展用例集——由 LongCat-2.5 分组设计、逐条实测后固化
// 怎么跑：node .tmp/test-run-trace-ext.mjs
// 依赖：无。临时目录隔离，不碰真实仓库。
//
// 与 test-run-trace.mjs 的分工：那份是核心行为（约 56 条），这份是边界与回归
// （前缀包装器、输出形态、规则边界、hook 协议、真实场景）。两个文件互不依赖。
//
// 标注约定：
//   [已修] 曾是真 bug，已修复，这里锁住不回退
//   [设计] 实测后确认是刻意行为，用例固化「当前口径」
//   [漏报] 已知盲区，用例文档化现状，修的时候把断言反过来
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const HOOKS = join(
  "C:", "Users", "bluechonk", "Documents", "deepseek-harness", "default-workspace",
  "zcode-plugins", "external_plugins", "run-trace", "hooks",
);
const WORK = join(tmpdir(), "run-trace-ext");

let pass = 0;
let fail = 0;
let known = 0;
function check(name, cond, extra = "") {
  if (cond) {
    pass += 1;
    console.log(`   ok  ${name}`);
  } else {
    fail += 1;
    console.error(`  FAIL ${name}${extra ? `：${extra}` : ""}`);
  }
}
/** 已知盲区：断言「当前确实不报」，用于锁定现状；修好后这条会失败，提醒改断言 */
function knownGap(name, cond, extra = "") {
  known += 1;
  check(`${name}（已知盲区）`, cond, extra);
}

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

function hook(entry, input, env = {}) {
  const r = spawnSync("node", [join(HOOKS, entry)], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    cwd: WORK,
    env: { ...process.env, ZCODE_PLUGIN_DATA: join(WORK, ".state"), ...env },
  });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

let seq = 0;
function bashHit(cmd) {
  seq += 1;
  return hook("pre-tool.mjs", {
    hook_event_name: "PreToolUse", session_id: `x-${seq}`, cwd: WORK,
    tool_name: "Bash", tool_input: { command: cmd },
  }).out.trim() !== "";
}
function flushHit(filePath, content) {
  seq += 1;
  return hook("post-tool.mjs", {
    hook_event_name: "PostToolUse", session_id: `f-${seq}`, cwd: WORK,
    tool_name: "Write", tool_input: { file_path: filePath, content },
  }).out.trim() !== "";
}
function runTrace(args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn("node", [join(HOOKS, "trace.mjs"), ...args], { cwd: WORK, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, ms: Date.now() - t0 });
    });
  });
}

// ===================================================================
// 1. 长跑识别：正向（该报的）
// ===================================================================
console.log("1) 长跑识别：该报的");

for (const [label, cmd] of [
  ["npm run build", "npm run build"],
  ["pnpm build", "pnpm build"],
  ["yarn build", "yarn build"],
  ["pytest", "pytest -x tests/"],
  ["uv run", "uv run pytest"],
  ["uv sync", "uv sync"],
  ["cargo build", "cargo build --release"],
  ["go test", "go test -race ./..."],
  ["dotnet build", "dotnet build -c Release"],
  ["docker build", "docker build -t app:ci ."],
  ["make", "make all"],
  ["git clone", "git clone https://github.com/x/y.git"],
  ["git submodule", "git submodule update --init --recursive"],
  ["pwsh -File", 'pwsh -NoProfile -File "./deploy.ps1"'],
  ["powershell -File", 'powershell.exe -File "C:/x.ps1"'],
  ["相对路径 python", "./venv/bin/python train.py"],
]) {
  check(`${label} 命中长跑`, bashHit(cmd), cmd);
}

// 真实开发场景（LongCat 组 6，15 条该报）
for (const [label, cmd] of [
  ["torchrun 多卡", 'torchrun --nproc_per_node=8 train.py --epochs 200 2>&1 | grep -E \'"event"|ERROR\''],
  ["ETL 日常", "python etl_daily.py --date 2026-11-20 2>&1 | grep -E 'ERROR|rows'"],
  ["ffmpeg 批量", 'for f in *.mp4; do ffmpeg -i "$f" -c:v libx265 "out/$f"; done 2>&1 | grep -E "Error|time="'],
  ["alembic 迁移", "alembic upgrade head 2>&1 | grep -E 'Running upgrade|ERROR'"],
  ["prisma 迁移", "npx prisma migrate deploy 2>&1 | tail -5"],
  ["pnpm build 过滤", "pnpm build 2>&1 | grep -E 'error|built in'"],
  ["webpack watch", "webpack --watch 2>&1 | grep -vE 'asset|Entrypoint'"],
  ["pytest -x tail", "pytest -x tests/ 2>&1 | tail -20"],
  ["jest watch", "jest --watch 2>&1 | grep -E 'FAIL'"],
  ["playwright", "playwright test --reporter=list 2>&1 | grep -E 'passed|failed'"],
  ["go test race", "go test -race ./... 2>&1 | grep -E 'DATA RACE|ok '"],
  ["docker build 过滤", "docker build -t app:ci . 2>&1 | grep -E 'ERROR|DONE'"],
  ["kubectl rollout", "kubectl rollout status deploy/api --timeout=10m 2>&1 | grep -E 'successfully|error'"],
  ["terraform apply", "terraform apply -auto-approve 2>&1 | grep -E 'Error|Apply complete'"],
  ["pwsh 部署", "pwsh -NoProfile -File deploy.ps1 2>&1 | grep -E 'SUCCESS|Exception'"],
]) {
  check(`场景 ${label} 命中`, bashHit(cmd), cmd);
}

// ===================================================================
// 2. 长跑识别：反向（不该报的）
// ===================================================================
console.log("\n2) 长跑识别：不该报的");

for (const [label, cmd] of [
  ["node -v", "node -v"],
  ["npm -v", "npm -v"],
  ["python -c", 'python -c "print(1)"'],
  ["node -e", 'node -e "console.log(1)"'],
  ["git status", "git status"],
  ["ls", "ls -la"],
  ["cat", "cat package.json"],
  ["grep 查询", 'grep -rn "foo" .'],
  ["find 查询", "find . -name '*.log'"],
  ["纯查询组合", "ls && git status"],
  ["grep 管道查询", "git log --oneline | head -3"],
  ["已有落盘", "npm run build > build.log 2>&1"],
  ["已有 tee", "make 2>&1 | tee make.log"],
  ["mkdir 组合", "mkdir -p x && cd x"],
  ["长跑词在参数位", 'echo python train.py'],
  ["长跑词在字符串", 'grep -r "make build" .'],
]) {
  check(`${label} 不报`, !bashHit(cmd), cmd);
}

// 已知盲区：段首锚点吃不到前缀（实测确认，锁定现状）
console.log("   -- 已知盲区（修好后这些会失败，届时反转断言）");
for (const [label, cmd] of [
  ["time 前缀", "time python train.py"],
  ["stdbuf 前缀", "stdbuf -oL -eL python train.py"],
  ["xvfb-run 前缀", "xvfb-run -a python render.py"],
  ["watch 前缀", "watch -n 2 python poll.py"],
  ["find -exec", "find . -name '*.log' -exec python parse.py {} +"],
  ["xargs 包装", "printf '%s\\n' a.py | xargs -n1 python"],
  ["Windows 盘符", "C:\\Users\\me\\venv\\Scripts\\python.exe train.py"],
  ["家目录缩写", "~/venv/bin/python train.py"],
  ["sudo 前缀", "sudo docker compose up -d"],
  ["nohup 前缀", "nohup python train.py &"],
  ["env 前缀", "env CUDA_VISIBLE_DEVICES=0 python train.py"],
  ["nice 前缀", "nice -n 10 python train.py"],
]) {
  knownGap(label, !bashHit(cmd), cmd);
}

// 已修：环境变量前缀曾漏报，现已命中（见 risks.ts 的前缀剥离）
// 环境变量前缀：实测仍漏报（已知盲区），无管道时完全静默
knownGap("环境变量前缀", !bashHit('FOO=bar python train.py'), 'FOO=bar python train.py');

// 引号路径：实测仍未命中，属已知盲区（LongCat 指出，字符类不含引号）
knownGap("引号绝对路径", !bashHit('"/c/Program Files/Python311/python" main.py'), "引号路径");

// ===================================================================
// 3. masked-exit-code 规则边界
// ===================================================================
console.log("\n3) masked-exit-code 边界");

check("多级管道命中", bashHit("python x.py | grep a | head"));
check("tee 后接 grep 命中", bashHit("python x.py | tee log | grep a"));
check("过滤器作为上游不报", !bashHit("grep a file | head"));
check("cat|grep|sort 不报（无长跑）", !bashHit("cat f | grep x | sort"));
check("引号内竖线不误判", !bashHit('echo "a|grep b"'));
check("过滤器后重定向仍报", bashHit("python x.py | grep a > out.txt"));
check("引号带空格参数仍报", bashHit('python x.py | grep "a b"'));
check("-E 引号内竖线仍报", bashHit('python x.py | grep -E "foo|bar"'));

// ===================================================================
// 4. missingFlush 规则边界
// ===================================================================
console.log("\n4) missingFlush 边界");

const pyLoop = (prints, tail = "") =>
  `import time\nfor i in range(10):\n${prints}\n    time.sleep(1)\n${tail}`;

check("2 处 print 命中", flushHit("train.py", pyLoop("    print(i)\n    print(i*2)")));
check("1 处 print 不报", !flushHit("train.py", pyLoop("    print(i)")));
check("3 处 print 命中", flushHit("train.py", pyLoop("    print(i)\n    print(i)\n    print(i)")));
check("print() 空参计入", flushHit("train.py", pyLoop("    print()\n    print(1)")));
check("pprint 不误报", !flushHit("train.py", pyLoop("    pprint(x)\n    pprint.pprint(y)")));
check("f-string 内 print 字样不误报", !flushHit("train.py", pyLoop('    print(f"print {i}")')));
check("flush = True 带空格豁免", !flushHit("train.py", pyLoop("    print(i, flush = True)\n    print(i, flush = True)")));
check("[已修] 注释里的 flush=True 不豁免", flushHit("train.py", pyLoop("    print(i)\n    print(i)", "# print(x, flush=True)")));
check("happy.txt 不报", !flushHit("happy.txt", pyLoop("    print(i)\n    print(i)")));
check(".pyi 命中", flushHit("stub.pyi", pyLoop("    print(i)\n    print(i)")));
check("无扩展名不报", !flushHit("train", pyLoop("    print(i)\n    print(i)")));
check("有 for 无 sleep 命中", flushHit("train.py", "for i in range(3):\n    print(i)\n    print(i*2)\n"));
check("有 sleep 无 for 命中", flushHit("train.py", "print(1)\nprint(2)\ntime.sleep(1)\n"));
check("只有 requests 命中", flushHit("train.py", "print(1)\nprint(2)\nrequests.get('x')\n"));
check("无特征词不报", !flushHit("train.py", "print(1)\nprint(2)\n"));

// ===================================================================
// 5. hook 协议健壮性
// ===================================================================
console.log("\n5) hook 协议健壮性");

check("空 stdin 不崩", hook("pre-tool.mjs", "").code === 0);
check("非 JSON 不崩", hook("pre-tool.mjs", "not json").code === 0);
check("BOM 开头不崩", hook("pre-tool.mjs", "\uFEFF" + JSON.stringify({
  hook_event_name: "PreToolUse", session_id: "bom", tool_name: "Bash",
  tool_input: { command: "python train.py" },
})).code === 0);
check("session_id 数字不崩", hook("pre-tool.mjs", JSON.stringify({
  hook_event_name: "PreToolUse", session_id: 12345, tool_name: "Bash",
  tool_input: { command: "python train.py" },
})).code === 0);
check("session_id 空串不崩", hook("user-prompt-submit.mjs", JSON.stringify({
  hook_event_name: "UserPromptSubmit", session_id: "",
})).code === 0);

{
  const before = existsSync(join(WORK, "state")) ? readdirSync(join(WORK, "state")) : [];
  hook("user-prompt-submit.mjs", JSON.stringify({
    hook_event_name: "UserPromptSubmit", session_id: "../../evil",
  }));
  const escaped = existsSync(join(WORK, "evil.json"));
  const after = existsSync(join(WORK, "state")) ? readdirSync(join(WORK, "state")) : [];
  check("路径穿越不逃逸出状态目录", !escaped, `新增: ${after.filter((f) => !before.includes(f)).join(",")}`);
}

{
  mkdirSync(join(WORK, "state"), { recursive: true });
  writeFileSync(join(WORK, "state", "corrupt.json"), '{"lastPromptedTurn":', "utf8");
  check("状态文件损坏不崩", hook("user-prompt-submit.mjs", JSON.stringify({
    hook_event_name: "UserPromptSubmit", session_id: "corrupt",
  })).code === 0);
}

{
  const r = hook("pre-tool.mjs", JSON.stringify({
    hook_event_name: "PreToolUse", session_id: `pure-${Date.now()}`, cwd: WORK,
    tool_name: "Bash", tool_input: { command: "python train.py" },
  }));
  const lines = r.out.split("\n").filter((l) => l.length > 0);
  let valid = false;
  try {
    valid = Boolean(JSON.parse(lines[0] ?? "").hookSpecificOutput?.additionalContext);
  } catch {
    valid = false;
  }
  check("stdout 恰好一行合法 JSON", lines.length === 1 && valid, `lines=${lines.length}`);
}

check("子代理静默", hook("pre-tool.mjs", JSON.stringify({
  hook_event_name: "PreToolUse", session_id: "sub", agent_type: "pua-verifier",
  tool_name: "Bash", tool_input: { command: "python train.py" },
})).out.trim() === "");

check("tool_name 不匹配静默", hook("pre-tool.mjs", JSON.stringify({
  hook_event_name: "PreToolUse", session_id: "grep-tool", tool_name: "Grep",
  tool_input: { pattern: "x" },
})).out.trim() === "");

check("事件名不匹配静默", hook("pre-tool.mjs", JSON.stringify({
  hook_event_name: "Stop", session_id: "wrong-ev", tool_name: "Bash",
  tool_input: { command: "python train.py" },
})).out.trim() === "");

// RUN_TRACE_DISABLE 真值语义：只有 "1" 生效
for (const [v, expectSilent] of [["1", true], ["0", false], ["true", false], ["", false]]) {
  const r = hook("pre-tool.mjs", JSON.stringify({
    hook_event_name: "PreToolUse", session_id: `dis-${v || "empty"}-${Date.now()}`,
    tool_name: "Bash", tool_input: { command: "python train.py" },
  }), { RUN_TRACE_DISABLE: v });
  check(`RUN_TRACE_DISABLE='${v}' ${expectSilent ? "静默" : "仍提示"}`, (r.out.trim() === "") === expectSilent);
}

// ===================================================================
// 6. trace 运行器：进程与 IO
// ===================================================================
console.log("\n6) trace 运行器");

{
  const p = join(WORK, "empty.log");
  const r = await runTrace(["--log", p, "--", 'node -e "0"']);
  const body = readFileSync(p, "utf8");
  const tsLines = body.split("\n").filter((l) => /^\[[\d:.]+\]/.test(l));
  check("空输出：无时间戳行但有 RESULT", tsLines.length === 0 && body.includes("# RESULT: success"));
  check("空输出退出码 0", r.code === 0);
}

{
  const p = join(WORK, "bracket.log");
  await runTrace(["--log", p, "--", `node -e "console.log('[warn] prefix-like')"`]);
  const body = readFileSync(p, "utf8");
  const line = body.split("\n").find((l) => /^\[[\d:.]+\]/.test(l) && l.includes("warn"));
  check("内容以 [ 开头与时间戳前缀可区分", /^\[[\d:.]+\] \[warn\]/.test(line ?? ""), JSON.stringify(line));
}

{
  const p = join(WORK, "mono.log");
  await runTrace(["--log", p, "--", 'node -e "for(let i=0;i<50;i++)console.log(i)"']);
  const stamps = readFileSync(p, "utf8").split("\n")
    .map((l) => /^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]/.exec(l)).filter(Boolean)
    .map((m) => Number(m[1]) * 3600000 + Number(m[2]) * 60000 + Number(m[3]) * 1000 + Number(m[4]));
  check("时间戳单调不回退", stamps.every((v, i) => i === 0 || v >= stamps[i - 1]), `n=${stamps.length}`);
}

{
  const p = join(WORK, "crlf.log");
  await runTrace(["--log", p, "--", `node -e "process.stdout.write('a\\r\\nb\\r\\n')"`]);
  check("CRLF：日志保留 \\r", readFileSync(p, "utf8").includes("\r"));
}

{
  const p = join(WORK, "nul.log");
  const r = await runTrace(["--log", p, "--", `node -e "process.stdout.write('a\\u0000b\\n')"`]);
  check("NUL 不崩且落盘", readFileSync(p, "utf8").includes("# RESULT:"), `exit=${r.code}`);
}

{
  const p = join(WORK, "progress.log");
  await runTrace(["--log", p, "--", `node -e "for(let i=1;i<=3;i++)process.stdout.write('\\r'+i*10+'%'); process.stdout.write('\\n')"`]);
  const lines = readFileSync(p, "utf8").split("\n").filter((l) => /^\[[\d:.]+\]/.test(l) && l.includes("%"));
  check("进度条 \\r 攒成一行", lines.length === 1, `行数=${lines.length}`);
}

{
  const p = join(WORK, "emoji.log");
  const rocket = String.fromCodePoint(0x1f680);
  await runTrace(["--log", p, "--", `node -e "console.log(String.fromCodePoint(0x1f680) + ' 中文')"`]);
  check("emoji 与中文不损坏", readFileSync(p, "utf8").includes(rocket));
}

{
  const p = join(WORK, "ansi.log");
  await runTrace(["--log", p, "--", `node -e "console.log('\\u001b[31mERR\\u001b[0m')"`]);
  check("ANSI 转义原样保留", readFileSync(p, "utf8").includes("\u001b[31m"));
}

{
  const p = join(WORK, "nonl.log");
  await runTrace(["--log", p, "--", `node -e "process.stdout.write('no-newline')"`]);
  const body = readFileSync(p, "utf8");
  check("末行无换行也落盘", body.includes("no-newline") && body.includes("# RESULT:"));
}

{
  const p = join(WORK, "rate0.log");
  const r = await runTrace(["--log", p, "--echo-rate", "0", "--", `node -e "for(let i=0;i<100;i++)console.log('L'+i)"`]);
  check("--echo-rate 0 = 不限速", (r.stdout.match(/L\d+/g) ?? []).length === 100);
}

{
  const p = join(WORK, "rate05.log");
  const r = await runTrace(["--log", p, "--echo-rate", "0.5", "--", `node -e "for(let i=0;i<10;i++)console.log('M'+i)"`]);
  const echoed = (r.stdout.match(/M\d+/g) ?? []).length;
  check("--echo-rate 0.5 每秒放行 1 行", echoed >= 1 && echoed < 10, `echoed=${echoed}`);
}

{
  const p = join(WORK, "twice.log");
  await runTrace(["--log", p, "--", 'node -e "console.log(1)"']);
  await runTrace(["--log", p, "--", 'node -e "console.log(2)"']);
  const headers = (readFileSync(p, "utf8").match(/# run-trace/g) ?? []).length;
  check("同一日志追加而非覆盖", headers === 2, `headers=${headers}`);
}

{
  // [已修] 孙进程持有管道：曾经挂满子进程时长，现在 500ms 宽限期后收尾
  const r = await runTrace(["--log", join(WORK, "bg.log"), "--", 'bash -c "sleep 8 & exit 0"'], 30000);
  check("[已修] 孙进程不导致挂起", r.ms < 3000, `耗时=${r.ms}ms`);
  check("[已修] 孙进程场景仍正常收尾", r.code === 0);
}

{
  // [已修] --log 指向目录：曾经 spawn 后异步崩，命令在跑但日志空
  const dirAsLog = join(WORK, "logdir");
  mkdirSync(dirAsLog, { recursive: true });
  const r = await runTrace(["--log", dirAsLog, "--", 'node -e "console.log(\'RAN\')"']);
  check("[已修] --log 指向目录被拒绝", r.code === 2, `code=${r.code}`);
  check("[已修] --log 指向目录时子进程不启动", !r.stdout.includes("RAN"));
}

check("无命令退出码 2", (await runTrace([])).code === 2);
check("--timeout -1 拒绝", (await runTrace(["--log", join(WORK, "bad.log"), "--timeout", "-1", "--", 'node -e "0"'])).code === 2);
check("--timeout abc 拒绝", (await runTrace(["--log", join(WORK, "bad2.log"), "--timeout", "abc", "--", 'node -e "0"'])).code === 2);

{
  const r = await runTrace(["--log", join(WORK, "t0.log"), "--timeout", "0", "--", 'node -e "setTimeout(()=>{},1200)"'], 20000);
  check("--timeout 0 = 永不超时", r.code === 0 && r.ms >= 1000, `code=${r.code} ms=${r.ms}`);
}

{
  const r = await runTrace(["--log", join(WORK, "crash.log"), "--", 'node -e "process.exit(9)"']);
  const body = readFileSync(join(WORK, "crash.log"), "utf8");
  check("崩溃退出码透传", r.code === 9, `code=${r.code}`);
  check("崩溃写 RESULT: failure", body.includes("# RESULT: failure"));
}

{
  const r = await runTrace(["--log", join(WORK, "to.log"), "--timeout", "2", "--", 'node -e "setTimeout(()=>{},10000)"'], 20000);
  const body = readFileSync(join(WORK, "to.log"), "utf8");
  check("超时退出码 124", r.code === 124, `code=${r.code}`);
  check("超时写 RESULT: timeout", body.includes("# RESULT: timeout"));
  check("超时有 END 收尾行", /# \[[\d:.]+\] END /.test(body));
}

// ===================================================================
// 7. 提示注入
// ===================================================================
console.log("\n7) 提示注入");

{
  const ss = hook("session-start.mjs", { hook_event_name: "SessionStart", session_id: "ss-x", cwd: WORK });
  check("SessionStart 注入规范卡", ss.out.includes("可观测性规范"));
  check("规范卡讲明 Agent=人 的可见性", ss.out.includes("Agent 能看到的输出"));
  check("规范卡给出 trace 用法", ss.out.includes("trace.mjs"));
  check("规范卡留了「什么时候不必」", ss.out.includes("什么时候不必"));
}

{
  const sid = `ups-${Date.now()}`;
  const first = hook("user-prompt-submit.mjs", { hook_event_name: "UserPromptSubmit", session_id: sid, cwd: WORK });
  check("首轮重申必说", first.out.includes("run-trace"));
  let mid = "";
  for (let i = 2; i <= 11; i += 1) {
    mid += hook("user-prompt-submit.mjs", { hook_event_name: "UserPromptSubmit", session_id: sid, cwd: WORK }).out;
  }
  check("第 2-11 轮节流静默", mid.trim() === "");
  const twelfth = hook("user-prompt-submit.mjs", { hook_event_name: "UserPromptSubmit", session_id: sid, cwd: WORK });
  check("第 12 轮重申", twelfth.out.includes("run-trace"));
}

// ===================================================================
// 8. 关键回归：shell 管道 vs trace
// ===================================================================
console.log("\n8) 关键回归");

{
  // 用 `| cat` 做对照：cat 恒返回 0，最能体现「上游失败被下游抹平」
  const pipe = spawnSync("bash", ["-c", 'node -e "process.exit(7)" 2>&1 | cat'], {
    cwd: WORK, encoding: "utf8",
  });
  check("对照：shell 管道把退出码吞成 0", pipe.status === 0, `status=${pipe.status}`);
  const tr = await runTrace(["--log", join(WORK, "reg.log"), "--", 'node -e "process.exit(7)"']);
  check("trace 保住真实退出码 7", tr.code === 7, `code=${tr.code}`);
}

rmSync(WORK, { recursive: true, force: true });
console.log(`\n${pass} 通过，${fail} 失败（其中已知盲区 ${known} 条）`);
process.exit(fail === 0 ? 0 : 1);
