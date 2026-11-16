/**
 * git 分支探测：dev-flow 的分支规则要落地，先得能可靠读出分支状态。
 *
 * 只读，且失败一律返回空串——不在 git 仓库、git 缺失、detached HEAD
 * 都按「未知」处理，由调用方决定提示还是跳过，不抛异常打断主流程。
 */

import { execFileSync } from "node:child_process";

export function currentBranch(cwd: string): string {
  try {
    return execFileSync("git", ["branch", "--show-current"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/** 本地是否存在指定分支 */
export function hasLocalBranch(cwd: string, name: string): boolean {
  try {
    const out = execFileSync("git", ["branch", "--list", name], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    // --list 的输出是「  dev」或「* dev」，存在即非空
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/** 是否是受保护的主干分支（探索式改动不该直接落在这里） */
export function isTrunk(branch: string): boolean {
  return branch === "main" || branch === "master";
}

/**
 * 分支状态摘要。
 *
 * 三个字段都是给模型判断用的原始事实，不替它做决定：
 *   branch 为空表示读不到（不在仓库 / detached），此时不该瞎提示。
 */
export interface BranchState {
  branch: string;
  hasDev: boolean;
  trunk: boolean;
}

export function branchState(cwd: string): BranchState {
  const branch = currentBranch(cwd);
  return { branch, hasDev: hasLocalBranch(cwd, "dev"), trunk: isTrunk(branch) };
}
