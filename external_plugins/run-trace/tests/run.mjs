#!/usr/bin/env node
/**
 * 跑 run-trace 的两套测试。
 *
 *   node tests/run.mjs           # 两套都跑
 *   node tests/run.mjs core      # 只跑核心行为
 *   node tests/run.mjs boundary  # 只跑边界与回归
 *
 * 退出码：全部通过 0，有失败 1。
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const suites = [
  ["core", "核心行为（检测规则 / trace 运行器 / hook 注入）"],
  ["boundary", "边界与回归（前缀包装器 / 输出形态 / 协议健壮性 / 真实场景）"],
];

const only = process.argv[2];
for (const [name, title] of suites) {
  if (only && only !== name) continue;
  console.log(`\n=== ${name}：${title} ===`);
  const r = spawnSync("node", [join(HERE, `${name}.test.mjs`)], {
    stdio: "inherit",
    encoding: "utf8",
  });
  if (r.status !== 0) process.exitCode = 1;
}
