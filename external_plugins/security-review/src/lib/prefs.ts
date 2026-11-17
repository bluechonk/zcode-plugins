/**
 * 插件级偏好：跨会话、跨轮次生效的开关，与按会话存放的 baseline / 阻塞计数分开。
 *
 * 为什么单独一个文件：开关是「用户对这个插件的态度」，不属于任何一个会话。
 * 混进会话状态会导致换会话就失效，而开关恰恰要求换会话、重启后都保持。
 *
 * 默认开着：读不到偏好文件时返回开。审查是安全网，默认关掉等于默认没有。
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Prefs {
  /** 收尾模型审查总开关，默认开；关掉后只保留正则模式层 */
  llmReview: boolean;
}

const DEFAULT_PREFS: Prefs = { llmReview: true };

/**
 * 插件数据目录。
 *
 * hook 由 ZCode 注入 ZCODE_PLUGIN_DATA；开关命令是模型经 Bash 调起的，
 * 拿不到这个变量，只能按 ZCode 的目录约定反查——数据目录名带 marketplace
 * 前缀（security-review@bluechonk-plugins），装到别处前缀就变了，所以按前缀匹配。
 */
export function prefsDir(): string {
  const fromEnv = process.env["ZCODE_PLUGIN_DATA"] ?? process.env["CLAUDE_PLUGIN_DATA"];
  if (fromEnv) return fromEnv;

  const base = join(homedir(), ".zcode", "cli", "plugins", "data");
  try {
    const hit = readdirSync(base).find((d) => d.startsWith("security-review@"));
    if (hit) return join(base, hit);
  } catch {
    // 数据根不存在：落到约定路径，写入时再建
  }
  return join(base, "security-review@bluechonk-plugins");
}

export function prefsPath(): string {
  return join(prefsDir(), "prefs.json");
}

export function readPrefs(): Prefs {
  try {
    const parsed = JSON.parse(readFileSync(prefsPath(), "utf8")) as Partial<Prefs>;
    return { llmReview: parsed.llmReview !== false };
  } catch {
    // 首次运行或文件损坏：回到默认（开），不因为读不到就静默关掉审查
    return { ...DEFAULT_PREFS };
  }
}

export function writePrefs(prefs: Prefs): void {
  try {
    mkdirSync(prefsDir(), { recursive: true });
    writeFileSync(prefsPath(), JSON.stringify(prefs), "utf8");
  } catch {
    // 落盘失败：开关保持原样，不阻断调用方
  }
}
