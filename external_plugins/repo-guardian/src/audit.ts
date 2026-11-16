/**
 * 仓库卫生审计命令行：把四条规则一次性核完并给出处置动作。
 *
 * 为什么要单独一个入口：hook 只在「动作发生的那一刻」说话，而存量仓库的欠账
 * （已入库的凭据、CRLF、产物）需要一次全量盘点才知道有多少。skill 与
 * /repo_hygiene 命令都调它，避免把同一套判据在提示词里重写一遍。
 *
 * 用法：node hooks/audit.mjs [--json] [仓库路径]
 * 退出码：0 = 全部通过；1 = 有未通过项；2 = 参数或环境错误。
 */

import { cwdOf } from "./lib/hook";
import { findRepoRoot, hasCI } from "./lib/detect";
import {
  REQUIRED_GITATTRIBUTES_LINE,
  REQUIRED_IGNORE_ENTRIES,
  hygieneFindings,
  hygieneReport,
  type HygieneFinding,
} from "./lib/hygiene";

/** 报表面向人，一律中文；运行时日志若将来加进来要保持英文，两者不混 */
interface Section {
  title: string;
  ok: boolean;
  lines: string[];
}

const RULE_TITLES: Record<HygieneFinding["rule"], string> = {
  credentials: "规则 2｜凭据不入库",
  eol: "规则 1｜换行符与 .gitattributes",
  artifacts: "规则 4｜构建产物与运行时数据",
};

/** 规则 3 是每次提交的动作，不是仓库状态，审计里固定列出清单 */
const PRECHECK: Section = {
  title: "规则 3｜提交前自查",
  ok: true,
  lines: [
    "每次 `git commit` 前跑：",
    "  1. git status —— 有没有该忽略却没忽略的文件、有没有临时产物跟着进来",
    "  2. git diff --cached —— 逐条看过要提交的内容",
    "  3. 敏感词扫描 —— apikey / accesskey / secret / token / password / private key / AKIA / 连接串",
    "  4. 一个 commit = 一件完整的逻辑",
    "误提交凭据：撤销提交 → 轮换凭据 → 清理历史。只删文件不算处理完。",
  ],
};

function buildSections(root: string): Section[] {
  const report = hygieneReport(root);
  const findings = hygieneFindings(report);
  const byRule = new Map(findings.map((f) => [f.rule, f]));

  const sections: Section[] = [
    {
      title: RULE_TITLES.eol,
      ok: !byRule.has("eol"),
      lines: byRule.get("eol")?.lines ?? [
        `通过：.gitattributes 含 \`${REQUIRED_GITATTRIBUTES_LINE}\`，已入库文本没有 CRLF。`,
      ],
    },
    {
      title: RULE_TITLES.credentials,
      ok: !byRule.has("credentials"),
      lines: byRule.get("credentials")?.lines ?? ["通过：没有凭据形态的文件入库或裸奔。"],
    },
    PRECHECK,
    {
      title: RULE_TITLES.artifacts,
      ok: !byRule.has("artifacts"),
      lines: byRule.get("artifacts")?.lines ?? [
        `通过：没有构建产物入库，.gitignore 覆盖了 ${REQUIRED_IGNORE_ENTRIES.join("、")}。`,
      ],
    },
    {
      title: "附｜CI 存在性",
      ok: hasCI(root),
      lines: hasCI(root)
        ? ["通过：.github/workflows/ 下有 workflow。"]
        : ["未通过：仓库没有 CI。建议补一个最小 workflow，至少跑构建与测试。"],
    },
  ];

  return sections;
}

function main(): void {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const target = args.find((a) => !a.startsWith("--"));

  if (args.some((a) => a === "-h" || a === "--help")) {
    process.stdout.write("用法：node audit.mjs [--json] [仓库路径]\n");
    return;
  }

  const root = findRepoRoot(target ?? cwdOf({}));
  if (!root) {
    process.stderr.write("不在 git 仓库内，无法审计。\n");
    process.exitCode = 2;
    return;
  }

  const sections = buildSections(root);
  const failed = sections.filter((s) => !s.ok);

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ root, ok: failed.length === 0, sections }, null, 2)}\n`);
    process.exitCode = failed.length === 0 ? 0 : 1;
    return;
  }

  process.stdout.write(`仓库卫生审计：${root}\n\n`);
  for (const s of sections) {
    process.stdout.write(`${s.ok ? "[通过]   " : "[未通过] "}${s.title}\n`);
    for (const line of s.lines) process.stdout.write(`  ${line}\n`);
    process.stdout.write("\n");
  }
  process.stdout.write(
    failed.length === 0
      ? "全部通过。\n"
      : `合计 ${failed.length} 项未通过：${failed.map((f) => f.title).join("、")}\n`
  );
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main();
