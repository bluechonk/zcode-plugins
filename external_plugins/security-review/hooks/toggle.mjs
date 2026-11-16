// 本文件由 scripts/build.mjs 从 external_plugins/security-review/src/toggle.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/security-review/src/toggle.ts
import { join as join2 } from "node:path";

// external_plugins/security-review/src/lib/prefs.ts
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var DEFAULT_PREFS = { llmReview: true };
function prefsDir() {
  const fromEnv = process.env["ZCODE_PLUGIN_DATA"] ?? process.env["CLAUDE_PLUGIN_DATA"];
  if (fromEnv) return fromEnv;
  const base = join(homedir(), ".zcode", "cli", "plugins", "data");
  try {
    const hit = readdirSync(base).find((d) => d.startsWith("security-review@"));
    if (hit) return join(base, hit);
  } catch {
  }
  return join(base, "security-review@bluechonk-plugins");
}
function prefsPath() {
  return join(prefsDir(), "prefs.json");
}
function readPrefs() {
  try {
    const parsed = JSON.parse(readFileSync(prefsPath(), "utf8"));
    return { llmReview: parsed.llmReview !== false };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}
function writePrefs(prefs) {
  try {
    mkdirSync(prefsDir(), { recursive: true });
    writeFileSync(prefsPath(), JSON.stringify(prefs), "utf8");
  } catch {
  }
}

// external_plugins/security-review/src/toggle.ts
function main() {
  const arg = process.argv[2];
  const prefs = readPrefs();
  if (arg === "on") {
    prefs.llmReview = true;
  } else if (arg === "off") {
    prefs.llmReview = false;
  } else if (arg !== "status") {
    console.error("\u7528\u6CD5\uFF1Anode toggle.mjs <on|off|status>");
    process.exitCode = 2;
    return;
  }
  if (arg !== "status") writePrefs(prefs);
  console.log(`\u6536\u5C3E\u6A21\u578B\u5BA1\u67E5\uFF1A${prefs.llmReview ? "\u5F00" : "\u5173"}\uFF08\u6B63\u5219\u6A21\u5F0F\u5C42\u4E0D\u53D7\u5F71\u54CD\uFF09`);
  console.log(`\u504F\u597D\u6587\u4EF6\uFF1A${join2(prefsDir(), "prefs.json")}`);
}
main();
