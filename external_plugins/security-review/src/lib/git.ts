/**
 * git 基线：用「提问时的快照」把审查范围收敛到本轮改动。
 *
 * 为什么不用 HEAD：会话中途可能提交，以 HEAD 为基线会把已提交的改动重复送审，
 * 或者把上一轮的问题反复报出来。`git stash create` 给出的是「HEAD + 未提交改动」的
 * 快照对象，用它做基线，diff 出来正好是这一轮新增的东西。
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export interface GitResult {
  ok: boolean;
  out: string;
}

export function git(cwd: string, args: string[]): GitResult {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 20_000,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { ok: r.status === 0, out: r.stdout ?? "" };
}

export function isRepo(cwd: string): boolean {
  return git(cwd, ["rev-parse", "--is-inside-work-tree"]).out.trim() === "true";
}

/** 取本轮基线；工作树无改动时退回 HEAD；两者都拿不到则返回 null（调用方跳过） */
export function captureBaseline(cwd: string): string | null {
  const stash = git(cwd, ["stash", "create"]);
  if (stash.ok && stash.out.trim()) return stash.out.trim();
  const head = git(cwd, ["rev-parse", "HEAD"]);
  return head.ok && head.out.trim() ? head.out.trim() : null;
}

/** 只审源码类文件；文档、锁文件、构建产物里的命中基本都是噪音 */
const SOURCE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|php|cs|c|h|cpp|swift|sh|bash|sql|yml|yaml|toml)$/i;

function looksLikeSource(path: string): boolean {
  return SOURCE_EXT.test(path);
}

export interface DiffResult {
  text: string;
  files: number;
  truncated: boolean;
}

/**
 * 取基线以来的改动。跟踪文件走 `git diff`，未跟踪文件按「整份新增」补进去——
 * 新文件恰恰是漏洞高发处，只审 diff 会漏掉它们。
 */
export function diffSince(cwd: string, baseline: string, maxBytes: number): DiffResult {
  const tracked = git(cwd, ["diff", "--no-color", "--unified=3", baseline]);
  const parts: string[] = [];
  let bytes = 0;
  let files = 0;
  let truncated = false;

  const push = (chunk: string): void => {
    if (bytes >= maxBytes) {
      truncated = true;
      return;
    }
    const room = maxBytes - bytes;
    parts.push(chunk.length > room ? chunk.slice(0, room) : chunk);
    bytes += Math.min(chunk.length, room);
  };

  if (tracked.ok && tracked.out.trim()) {
    // 按文件切块再按扩展名过滤，避免整段丢掉合法内容
    const chunks = tracked.out.split(/^diff --git /m).filter(Boolean);
    for (const chunk of chunks) {
      const header = chunk.slice(0, chunk.indexOf("\n"));
      const m = /b\/(\S+)/.exec(header);
      const path = m?.[1] ?? "";
      if (path && !looksLikeSource(path)) continue;
      push(`diff --git ${chunk}`);
      files++;
    }
  }

  const untracked = git(cwd, ["ls-files", "--others", "--exclude-standard"]);
  if (untracked.ok) {
    for (const path of untracked.out.split("\n").map((l) => l.trim()).filter(Boolean)) {
      if (!looksLikeSource(path)) continue;
      if (files >= 20) {
        truncated = true;
        break;
      }
      let body: string;
      try {
        body = readFileSync(`${cwd}/${path}`, "utf8");
      } catch {
        continue; // 二进制或读不到：跳过
      }
      const lines = body.split("\n").slice(0, 400);
      push(`\n### 新文件 ${path}\n${lines.map((l) => `+${l}`).join("\n")}`);
      files++;
    }
  }

  return { text: parts.join(""), files, truncated };
}
