/**
 * 开关命令行的落盘端，给 /security-review-on 与 /security-review-off 用。
 *
 * 为什么要有这段代码：命令正文只是提示词，模型可以「读一下就不管」。开关要真的生效，
 * 必须有一次确定性的写盘，否则关没关掉全看模型心情。
 *
 * 用法：node hooks/toggle.mjs <on|off|status>
 */

import { join } from "node:path";

import { prefsDir, readPrefs, writePrefs } from "./lib/prefs";

function main(): void {
  const arg = process.argv[2];
  const prefs = readPrefs();

  if (arg === "on") {
    prefs.llmReview = true;
  } else if (arg === "off") {
    prefs.llmReview = false;
  } else if (arg !== "status") {
    console.error("用法：node toggle.mjs <on|off|status>");
    process.exitCode = 2;
    return;
  }

  // status 只读，不写盘：查询不该有副作用
  if (arg !== "status") writePrefs(prefs);

  console.log(`收尾模型审查：${prefs.llmReview ? "开" : "关"}（正则模式层不受影响）`);
  console.log(`偏好文件：${join(prefsDir(), "prefs.json")}`);
}

main();
