/**
 * SessionStart：仓库健康检测。
 *
 * 只在会话启动时扫一次，把「机器可判定但模型不会主动去看」的仓库状态摆到台面上：
 * CI 有没有、.gitattributes 有没有、README 是不是中文。三项都干净就完全静默。
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

async function main(): Promise<void> {
  if (disabled()) return;

  const input = await readHookInput();
  if (!input || input.hook_event_name !== "SessionStart") return;
  if (isSubagent(input)) return;

  const root = findRepoRoot(cwdOf(input));
  if (!root) return; // 不在 git 仓库里：没什么可查的

  const lines: string[] = ["[repo-guardian] 仓库健康检查结果：", ""];

  if (!hasCI(root)) {
    lines.push(
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
    lines.push(
      "缺少 .gitattributes：按仓库规范必须存在，且至少包含 `* text=auto eol=lf`。",
      ""
    );
  }

  const ratio = readmeChineseRatio(root);
  if (ratio !== null && ratio < MIN_CHINESE_RATIO) {
    lines.push(
      `README.md 的中文占比仅 ${(ratio * 100).toFixed(0)}%（要求 30%）：README 必须是全中文文档。`,
      ""
    );
  }

  if (lines.length === 2) return; // 三项都干净，保持静默

  lines.push("以上只是提示，不是阻塞。判断本仓库确实不需要某项时直接说明理由继续。");

  emit("SessionStart", { additionalContext: lines.join("\n") });
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
