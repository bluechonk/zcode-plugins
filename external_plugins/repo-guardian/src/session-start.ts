/**
 * SessionStart：仓库健康检测 + 注释规范卡。
 *
 * 健康检查只在会话启动时扫一次，把「机器可判定但模型不会主动去看」的仓库状态摆到台面上：
 * CI 有没有、.gitattributes 有没有、README 是不是中文。三项都干净就不注入这一段。
 *
 * 规范卡是给「机器判不了」的那部分规则留的位置：能不能写 why、算不算复述代码，
 * 只能靠模型自觉，PostToolUse 的检测覆盖不到。这几条原本常驻 AGENTS.md，
 * 现在跟着会话走，命中时还会被 PostToolUse 的具体行号提醒一次。
 */

import { disabled, emit, isSubagent, readHookInput } from "./lib/hook";
import { cwdOf } from "./lib/hook";
import { findRepoRoot, hasCI, hasGitattributes, readmeChineseRatio } from "./lib/detect";

/**
 * README 中文占比低于此值视为非中文文档。
 *
 * 阈值取 15% 而非更高：技术 README 天然含大量代码块、命令、路径与英文标识符，
 * 本仓库自己的 README 中文占比只有 28%——30% 会把正常的双语文档判成违规。
 * 全英文文档的占比接近 0，15% 足以区分。
 */
const MIN_CHINESE_RATIO = 0.15;

/**
 * 代码与注释规范卡。
 *
 * 卡里的内容与 AGENTS.md 里「代码与注释」一节等价，那份规则已从文档移出，这里是唯一载体。
 *
 * 分层说明写在第 0 条里，因为模型需要知道哪些会被机器核对、哪些只能靠自觉——
 * 否则会以为「没被提示就是合规」。
 */
const COMMENT_RULES = [
  "[repo-guardian] 代码与注释规范（写入后逐行核对，命中即时提示）：",
  "",
  "1. 注释一律中文、简洁、不复述代码；随代码改动一起更新，不留过时或误导性注释。",
  "2. 写 why 不写 what：回答「为什么这样写」（取舍、约束），不回答「做了什么」。",
  "3. 四类禁写：修订记录、作者署名与审批留痕、注释掉的代码、半吊子翻译与复述。",
  "   署名与修订历史的唯一事实源是 git blame 与 git log，注释里不重复。",
  "4. 日期绑在事实上必须写（「实测（2026-10-25）上游排队 290s」），绑在人身上的一律删。",
  "5. TODO / FIXME 写 `TODO(名字): 描述`，带清理条件，不带修订日期。",
  "6. 空 catch 只在块内写明「有意忽略」时才允许，否则记录日志、上报或转换后重抛；",
  "   `@deprecated` 必写替代方案与移除条件；`@ts-ignore` / `@ts-expect-error` 必须同行写明理由。",
  "7. 禁用 any 图省事；跨模块契约面的刻意宽松要写明设计理由。",
  "8. 文件写入只用项目封装的路径工具（paths.* / app.getPath()），不硬编码 Desktop、C:\\、",
  "   用户主目录拼接——这条会被机器核对。",
  "9. 运行时日志一律英文；面向用户的 CLI 报表与 UI 文案保持中文。",
  "   这条机器判不了（两者写法相同），靠自觉。",
].join("\n");

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input || input.hook_event_name !== "SessionStart") return;
  if (isSubagent(input)) return;

  const lines: string[] = [];

  const root = findRepoRoot(cwdOf(input));
  if (root) {
    const health: string[] = [];

    if (!hasCI(root)) {
      health.push(
        "缺少 CI：仓库没有 .github/workflows/。建议补一个最小 workflow，至少跑构建与测试。",
        "",
        "最小骨架（.github/workflows/ci.yml）：",
        "```yaml",
        "name: CI",
        "on:",
        "  push:",
        "    branches: [ main ]",
        "  pull_request:",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "        with:",
        "          node-version: \"22\"",
        "      - run: npm ci",
        "      - run: npm test",
        "```",
        ""
      );
    }

    if (!hasGitattributes(root)) {
      health.push("缺少 .gitattributes：按仓库规范必须存在，且至少包含 `* text=auto eol=lf`。", "");
    }

    const ratio = readmeChineseRatio(root);
    if (ratio !== null && ratio < MIN_CHINESE_RATIO) {
      health.push(`README.md 的中文占比仅 ${(ratio * 100).toFixed(0)}%：README 必须是全中文文档。`, "");
    }

    if (health.length > 0) {
      lines.push("[repo-guardian] 仓库健康检查结果：", "", ...health);
      lines.push("以上只是提示，不是阻塞。判断本仓库确实不需要某项时直接说明理由继续。");
    }
  }

  if (lines.length > 0) lines.push("");
  lines.push(COMMENT_RULES);

  emit("SessionStart", { additionalContext: lines.join("\n") });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
