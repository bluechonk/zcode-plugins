/**
 * PreToolUse：本机规则检测。
 *
 * 硬规则（AGENTS.md 明写禁用）走 deny：powershell.exe / cmd / pip install / poetry / conda。
 * 软规则只注入提示：emoji、临时脚本落点、bash 内建中文输出、仓库卫生相关动作。
 *
 * 为什么 deny 只给硬规则：这些是「用了就明确违规」的命令，重写代价低；
 * 而软规则容易误报，只提示不阻断。仓库卫生的四条全部按软规则处理——
 * 「这次先不补 .gitattributes」是合理决定，硬拦只会逼模型为了过检改坏内容。
 */

import { disabled, emit, isSubagent, readHookInput } from "./lib/hook";
import { addedText, filePathOf } from "./lib/comments";
import {
  analyzeGitCommand,
  bashChineseStdout,
  containsEmoji,
  findForbiddenCommand,
  isArtifactPath,
  isCredentialPath,
  tempScriptOutsideTmp,
} from "./lib/detect";
import { REQUIRED_GITATTRIBUTES_LINE } from "./lib/hygiene";

/** 提交前自查清单：规则第 3 条，只在模型真的要提交时才说 */
const COMMIT_CHECKLIST = [
  "[repo-guardian] 提交前自查（仓库卫生第 3 条）：",
  "1. `git status` —— 有没有该忽略却没忽略的文件、有没有临时产物跟着进来。",
  "2. `git diff --cached` —— 逐条看过要提交的内容，确认没有凭据、密钥、真实 token。",
  "3. 敏感词扫描 —— 在暂存内容里搜 apikey / accesskey / secret / token / password /",
  "   private key / BEGIN .* PRIVATE KEY / AKIA / 数据库连接串。",
  "4. 一个 commit = 一件完整的逻辑：同一件事的多次返工合成一条，不同的事别混提。",
  "",
  "误提交了凭据：撤销提交 → 轮换凭据 → 清理历史。只删文件不算处理完，",
  "凭据留在历史里就等于还在被人能拉到。",
].join("\n");

/** 改写历史：清除误提交凭据的标准处置 */
const HISTORY_REWRITE_HINT =
  "[repo-guardian] 这条命令在改写 git 历史。若目的是清除误提交的凭据：" +
  "先轮换凭据，再改写历史，最后 force push——历史里的密钥一旦被拉到，删除只是补救，不是撤销。";

/** force push 单独提醒：它常常是掩盖误提交的最后一步 */
const FORCE_PUSH_HINT =
  "[repo-guardian] force push 会重写远端历史。确认这不是在掩盖一次凭据泄露：凭据必须先轮换。";

/** git add -f 把被忽略的东西强行入库 */
const FORCE_ADD_HINT =
  "[repo-guardian] `git add -f` 会把 .gitignore 覆盖的文件强行入库。" +
  "如果目标是 dist/、node_modules/ 或凭据文件，这正是规范禁止的动作。";

function hintBlock(hints: string[]): void {
  emit("PreToolUse", {
    additionalContext: `${hints.join("\n\n")}\n\n误报就直接说明理由并继续，不必为了消提示改坏代码。`,
  });
}

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input || input.hook_event_name !== "PreToolUse") return;
  if (isSubagent(input)) return;

  const tool = input.tool_name ?? "";
  const toolInput = input.tool_input ?? {};

  // --- Bash：硬规则 deny，其余按意图给提示 ---
  if (tool === "Bash") {
    const command = typeof toolInput["command"] === "string" ? (toolInput["command"] as string) : "";
    if (!command) return;

    const forbidden = findForbiddenCommand(command);
    if (forbidden) {
      emit("PreToolUse", {
        permissionDecision: "deny",
        permissionDecisionReason: `[repo-guardian] ${forbidden.message}`,
      });
      return;
    }

    const hints: string[] = [];

    // bash 内建输出中文会被按 GBK 解码（见 lib/detect.ts 的 bashChineseStdout）
    if (bashChineseStdout(command)) {
      hints.push(
        "[repo-guardian] 编码提示：这条命令用 bash 内建（echo / printf）输出中文。\n" +
          "ZCode 按系统代码页（本机 936/GBK）解码 Bash 输出，而 bash 内建输出 UTF-8 字节——中文会乱码。\n" +
          "把中文输出包一层：`echo \"…\" | iconv -f UTF-8 -t GBK`；或把中文交给外部程序（curl -w 等按代码页输出）。\n" +
          "pwsh 与外部程序不受影响。"
      );
    }

    const git = analyzeGitCommand(command);
    if (git.intent === "commit") hints.push(COMMIT_CHECKLIST);
    if (git.forceAdd) hints.push(FORCE_ADD_HINT);
    if (git.forcePush) hints.push(FORCE_PUSH_HINT);
    if (git.historyRewrite) hints.push(HISTORY_REWRITE_HINT);

    for (const target of git.addTargets) {
      if (isCredentialPath(target)) {
        hints.push(
          `[repo-guardian] git add 了凭据形态的文件（${target}）：含真实凭据的 .env / .pem / .key 一律不入库。` +
            "改走环境变量或密钥管理服务，并把它加进 .gitignore。"
        );
      } else if (isArtifactPath(target)) {
        hints.push(
          `[repo-guardian] git add 了构建产物路径（${target}）：dist/、node_modules/、运行时数据不入库。`
        );
      }
    }

    if (hints.length > 0) hintBlock(hints);
    return; // Bash 不查 emoji——命令里的 emoji 多半是输出内容
  }

  if (tool !== "Write" && tool !== "Edit" && tool !== "MultiEdit") return;

  // --- 写入：软规则提示 ---
  const path = filePathOf(toolInput);
  const text = addedText(tool, toolInput);
  const hits: string[] = [];

  if (text && containsEmoji(text)) {
    hits.push("本次写入含 emoji：仓库规范禁止 emoji（文档与持久记录一律纯文本）。");
  }

  if (path && tempScriptOutsideTmp(path)) {
    hits.push(
      `脚本写到 .tmp/ 之外（${path}）：按规范 .ps1 与临时脚本必须落在项目根的 .tmp/。`
    );
  }

  // 凭据形态的文件：内容是不是真凭机器判不了（交给 security-review），
  // 但「这类文件本来就不该入库」这件事在写入当下就该说一次
  if (path && isCredentialPath(path)) {
    hits.push(
      `正在写入凭据形态的文件（${path}）：真实凭据不入库，走环境变量或密钥管理服务；` +
        "入库的只能是占位符模板（.env.example 之类）。确认它已被 .gitignore 覆盖。"
    );
  }

  // 换行符：规则要求仓库内文本一律 LF，工作树里写进 CRLF 是违规的直接来源
  if (text && /\r\n/u.test(text)) {
    hits.push(
      "本次写入的内容含 CRLF 换行：仓库内文本文件一律 LF。改成 LF 再写，" +
        `并确认 .gitattributes 里有 \`${REQUIRED_GITATTRIBUTES_LINE}\`。`
    );
  }

  // 补 .gitattributes 这件事本身也要达标，否则等于白补
  if (path && /(?:^|\/)\.gitattributes$/u.test(path.replace(/\\/gu, "/")) && text && !text.includes(REQUIRED_GITATTRIBUTES_LINE)) {
    hits.push(
      `.gitattributes 缺少 \`${REQUIRED_GITATTRIBUTES_LINE}\`：这一行是仓库规范的硬指标，只有别的属性不算补齐。`
    );
  }

  if (hits.length === 0) return;

  hintBlock(hits);
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
