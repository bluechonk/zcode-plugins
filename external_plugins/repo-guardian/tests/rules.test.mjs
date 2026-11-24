// 干什么：验证 repo-guardian 的检测纯函数与 hook 注入——命令意图、凭据/产物路径、写入规范
// 怎么跑：node external_plugins/repo-guardian/tests/rules.test.mjs
// 依赖：无。只喂 hook 入参，不碰真实仓库。
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(HERE, "..", "hooks");
const CWD = join(HERE, "..", "..", "..");

let pass = 0;
let fail = 0;
function check(name, cond, extra = "") {
  if (cond) {
    pass += 1;
    console.log(`   ok  ${name}`);
  } else {
    fail += 1;
    console.error(`  FAIL ${name}${extra ? `：${extra}` : ""}`);
  }
}

function runHook(entry, input) {
  const r = spawnSync(process.execPath, [join(HOOKS, entry)], {
    input: JSON.stringify({ cwd: CWD, ...input }),
    encoding: "utf8",
    timeout: 20000,
  });
  return (r.stdout ?? "").trim();
}

// 每次运行换会话号：插件按「会话 + 规则 + 文件」去重，复用同一批 id 会被上一次结果吞掉
const RUN = Date.now();
let seq = 0;
function bash(command) {
  seq += 1;
  return runHook("pre-tool.mjs", {
    hook_event_name: "PreToolUse",
    session_id: `rg-test-${RUN}-${seq}`,
    tool_name: "Bash",
    tool_input: { command },
  });
}
// emoji / .ps1 / 凭据路径这类「写入前」软规则在 PreToolUse；注释与代码风格在 PostToolUse
function writePre(file, content) {
  seq += 1;
  return runHook("pre-tool.mjs", {
    hook_event_name: "PreToolUse",
    session_id: `rg-test-${RUN}-p${seq}`,
    tool_name: "Write",
    tool_input: { file_path: `C:/tmp/${file}`, content },
  });
}
function write(file, content) {
  seq += 1;
  return runHook("post-tool.mjs", {
    hook_event_name: "PostToolUse",
    session_id: `rg-test-${RUN}-w${seq}`,
    tool_name: "Write",
    tool_input: { file_path: `C:/tmp/${file}`, content },
  });
}

console.log("命令意图");
check("commit 触发提交前自查", bash('git commit --dry-run -m x').includes("提交前自查"));
check(
  "commit 在链尾也优先于 add",
  bash("git add --dry-run .env && git commit --dry-run -m x").includes("提交前自查"),
  "意图识别按优先级而非出现顺序");
check("add 凭据文件", bash("git add --dry-run .env").includes("凭据形态的文件"));
check("add .pem", bash("git add --dry-run secrets/server.pem").includes("凭据形态的文件"));
check("add id_rsa", bash("git add --dry-run id_rsa").includes("凭据形态的文件"));
check("add id_ed25519", bash("git add --dry-run .ssh/id_ed25519").includes("凭据形态的文件"));
check(".env.example 是模板，不报", !bash("git add --dry-run .env.example").includes("凭据形态的文件"));
check("add dist/", bash("git add --dry-run dist/bundle.js").includes("构建产物路径"));
check("git add -f", bash("git add -f --dry-run dist/").includes("`git add -f`"));
check("force push", bash("git push --force --dry-run origin main").includes("force push"));
check("普通 push 不报 force", !bash("git push --dry-run origin main").includes("force push"));
check("filter-branch", bash("git filter-branch --help").includes("改写 git 历史"));
check("echo 中文", bash('echo "中文"').includes("编码提示"));
check(
  "普通查询静默",
  !bash("git status --short").includes("提交前自查") && !bash("ls -la").includes("编码提示"),
);
check("powershell.exe 被 deny", bash("powershell.exe -Version").includes('"permissionDecision":"deny"'));
check("pwsh 不被 deny", !bash('pwsh -NoProfile -Command "Get-Date"').includes('"permissionDecision":"deny"'));

console.log("写入规范");
check("emoji 命中", writePre("a.md", "# 标题\n\n🚀 发布\n").includes("含 emoji"));
check("ps1 落 .tmp 外命中", writePre("script.ps1", "Write-Host hi\n").includes("脚本写到 .tmp/ 之外"));
check(".env 写入命中", writePre(".env", "A=1\n").includes("正在写入凭据形态的文件"));
check(".tmp 内的 ps1 豁免", !writePre(".tmp/script.ps1", "Write-Host hi\n").includes("脚本写到 .tmp/ 之外"));
check("作者留痕命中", write("b.js", "// author: zhangsan\n").includes("注释里写了作者或审批留痕"));
check("TODO 格式命中", write("c.js", "// TODO: 以后修\n").includes("TODO / FIXME 格式不合规"));
check("空 catch 命中", write("d.js", "try { f(); } catch (e) {}\n").includes("空 catch 吞掉了异常"));
check(
  "path.js 是路径工具，豁免绝对路径规则",
  !write("path.js", 'const p = "C:\\Users\\x\\Desktop\\y";\n').includes("写死了绝对路径"),
  "文件名 path.js/paths.ts 按设计豁免");
check(
  "普通文件仍报绝对路径",
  write("hardcoded.js", 'const p = "C:\\Users\\x\\Desktop\\y";\n').includes("写死了绝对路径"),
);
check("干净写入静默", !write("clean.js", "// 计算总数\nexport const total = (a) => a;\n").includes("不符合规范"));

console.log(`\n${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
