/**
 * 把仓库里的插件同步到本机 ZCode 的 marketplace 副本与插件缓存。
 *
 * 干什么：ZCode 从 GitHub 拉 marketplace，合并 PR 后才拿得到新版本。开发时想立刻
 *        在下一个会话里验证改动，就得先把本地这两处换掉——否则会话跑的还是旧产物。
 *
 * 怎么跑：node scripts/sync-local-marketplace.mjs             同步并校验
 *        node scripts/sync-local-marketplace.mjs --dry-run   只报告差异，不写盘
 *        node scripts/sync-local-marketplace.mjs --marketplace-only  只同步副本，不动缓存
 *        node scripts/sync-local-marketplace.mjs --prune     删除缓存里的其他版本目录
 * 依赖：无（只用 node 内置模块）。
 *
 * 为什么不去改 installed_plugins.json：那是 ZCode 自己的状态文件，它在会话启动时
 * 会自行刷新（实测 lastUpdated 与 installedAt 都落在会话启动时刻）。这里越权写入
 * 只会和它的刷新逻辑打架。脚本只读它、报告版本是否对得上，对不上就提示。
 *
 * 为什么默认不删旧版本目录：删错了会让已安装的插件指向一个不存在的路径。要清理
 * 必须显式给 --prune。
 */

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const DRY_RUN = process.argv.includes("--dry-run");
const MARKETPLACE_ONLY = process.argv.includes("--marketplace-only");
const PRUNE = process.argv.includes("--prune");

// 这些目录属于本地开发产物，同步进 marketplace 副本只会污染它
const EXCLUDED = new Set([".git", "node_modules", ".tmp", ".zcode", "dist"]);

/** ZCode 的插件根目录。允许用环境变量覆盖，便于在别的机器上跑。 */
function pluginRoot() {
  return process.env["ZCODE_PLUGIN_ROOT_DIR"] ?? join(homedir(), ".zcode", "cli", "plugins");
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** 递归列出相对路径（文件），用于比对目录是否一致。EXCLUDED 下的内容不参与比对。 */
function listFiles(dir, base = dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full, base));
    } else if (entry.isFile()) {
      out.push(relative(base, full).replace(/\\/g, "/"));
    }
  }
  return out.sort();
}

/** 两个目录的差异：只在源、只在目标、内容不同 */
function diffDirs(srcDir, dstDir) {
  const src = new Set(listFiles(srcDir));
  const dst = new Set(listFiles(dstDir));
  const onlySrc = [...src].filter((f) => !dst.has(f));
  const onlyDst = [...dst].filter((f) => !src.has(f));
  const changed = [...src].filter(
    (f) => dst.has(f) && sha256(join(srcDir, f)) !== sha256(join(dstDir, f))
  );
  return { onlySrc, onlyDst, changed, same: src.size - onlySrc.length - changed.length };
}

function summarize(label, diff) {
  const parts = [];
  if (diff.changed.length) parts.push(`${diff.changed.length} 个内容不同`);
  if (diff.onlySrc.length) parts.push(`${diff.onlySrc.length} 个待新增`);
  if (diff.onlyDst.length) parts.push(`${diff.onlyDst.length} 个多余`);
  return parts.length === 0
    ? `${label}: 已一致（${diff.same} 个文件）`
    : `${label}: ${parts.join("，")}`;
}

/** 复制目录，跳过 EXCLUDED。dst 会被整体替换，调用方负责先备份。 */
function syncTree(srcDir, dstDir) {
  rmSync(dstDir, { recursive: true, force: true });
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name)) continue;
    const src = join(srcDir, entry.name);
    const dst = join(dstDir, entry.name);
    if (entry.isDirectory()) {
      syncTree(src, dst);
    } else if (entry.isFile()) {
      cpSync(src, dst);
    }
    // 符号链接一律跳过：marketplace 会被整体打包发布，链接会让发布内容不可控
  }
}

/**
 * 备份目录名带上序号后缀：同一秒内的多次运行（实测连跑两次就会发生）
 * 会互相覆盖备份，而备份的意义正是「覆盖前那一版还在」。
 */
function backupDir(stamp) {
  const base = join(ROOT, ".tmp", `sync-backup-${stamp}`);
  let dir = base;
  for (let i = 2; existsSync(dir); i++) {
    dir = `${base}-${i}`;
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

function backup(dstDir, stamp) {
  if (!existsSync(dstDir)) return null;
  const name = dstDir.split(/[\\/]/).pop();
  const dir = backupDir(stamp);
  cpSync(dstDir, join(dir, name), { recursive: true });
  return join(dir, name);
}

const marketplaceManifest = readJson(join(ROOT, "marketplace.json"));
if (!marketplaceManifest) {
  console.error("✗ 读不到 marketplace.json");
  process.exit(1);
}

const mktName = marketplaceManifest.name;
const plugins = marketplaceManifest.plugins ?? [];
const root = pluginRoot();
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");

console.log(`仓库:        ${ROOT}`);
console.log(`插件根:      ${root}`);
console.log(`marketplace: ${mktName}（${plugins.length} 个插件）`);
console.log(`模式:        ${DRY_RUN ? "只报告（--dry-run）" : "写盘"}${MARKETPLACE_ONLY ? " · 仅副本" : ""}`);
console.log();

// --- 1. marketplace 副本 ---
const mktDst = join(root, "marketplaces", mktName);
console.log("=== 1. marketplace 副本 ===");
if (!existsSync(mktDst)) {
  console.log(`  ${mktDst} 不存在——本机还没添加过这个 marketplace，请先在 ZCode 里添加。`);
  process.exit(1);
}

const mktDiff = diffDirs(ROOT, mktDst);
console.log("  " + summarize("仓库 → 副本", mktDiff));

if (DRY_RUN) {
  for (const f of mktDiff.changed.slice(0, 10)) console.log(`    内容不同: ${f}`);
  for (const f of mktDiff.onlySrc.slice(0, 10)) console.log(`    待新增:   ${f}`);
  for (const f of mktDiff.onlyDst.slice(0, 10)) console.log(`    多余:     ${f}`);
  if (mktDiff.changed.length + mktDiff.onlySrc.length + mktDiff.onlyDst.length > 20) {
    console.log("    …（列表已截断）");
  }
} else {
  const backupPath = backup(mktDst, stamp);
  if (backupPath) console.log(`  已备份旧副本 → ${relative(ROOT, backupPath)}`);
  syncTree(ROOT, mktDst);
  console.log("  已覆盖");
}

// --- 2. 插件缓存 ---
const installed = readJson(join(root, "installed_plugins.json")) ?? { plugins: [] };
const cacheRoot = join(root, "cache", mktName);

if (!MARKETPLACE_ONLY) {
  console.log();
  console.log("=== 2. 插件缓存 ===");

  for (const entry of plugins) {
    const { name, version } = entry;
    const srcDir = join(ROOT, "external_plugins", name);
    if (!existsSync(srcDir)) {
      console.log(`  ${name}: ✗ 仓库里没有 external_plugins/${name}`);
      continue;
    }

    const pluginCacheDir = join(cacheRoot, name);
    const dstDir = join(pluginCacheDir, version);
    const record = installed.plugins?.find((p) => p.id === `${name}@${mktName}`);

    const diff = diffDirs(srcDir, dstDir);
    console.log(`  ${name}@${version}: ${summarize("缓存", diff).split(": ")[1]}`);

    if (DRY_RUN) continue;

    syncTree(srcDir, dstDir);

    // 旧版本目录不自动删——删错会让安装记录指向不存在的路径
    const others = existsSync(pluginCacheDir)
      ? readdirSync(pluginCacheDir).filter((d) => d !== version)
      : [];
    if (others.length > 0) {
      if (PRUNE) {
        for (const old of others) {
          rmSync(join(pluginCacheDir, old), { recursive: true, force: true });
          console.log(`    已删除旧版本 ${old}（--prune）`);
        }
      } else {
        console.log(`    保留旧版本: ${others.join(", ")}（要清理加 --prune）`);
      }
    }

    // 安装记录只读不写：ZCode 会话启动时自己刷新，越权写会与它打架
    if (!record) {
      console.log(`    ⚠ installed_plugins.json 里没有 ${name}@${mktName}，ZCode 里可能未安装`);
    } else if (record.version !== version) {
      console.log(
        `    ⚠ 安装记录仍是 ${record.version}，缓存已是 ${version}。` +
          `重开一个会话让 ZCode 刷新，或在 ZCode 里更新该插件。`
      );
    }
  }
}

// --- 3. 校验 ---
console.log();
console.log("=== 3. 校验 ===");
let failed = 0;

const verifyDiff = diffDirs(ROOT, mktDst);
if (verifyDiff.changed.length || verifyDiff.onlySrc.length) {
  console.error(`  ✗ marketplace 副本仍与仓库不一致`);
  failed++;
} else {
  console.log(`  ✓ marketplace 副本与仓库一致（${verifyDiff.same} 个文件）`);
}

if (!MARKETPLACE_ONLY) {
  for (const entry of plugins) {
    const srcDir = join(ROOT, "external_plugins", entry.name);
    const dstDir = join(cacheRoot, entry.name, entry.version);
    if (!existsSync(dstDir)) {
      console.error(`  ✗ ${entry.name}@${entry.version} 缓存缺失`);
      failed++;
      continue;
    }
    const d = diffDirs(srcDir, dstDir);
    if (d.changed.length || d.onlySrc.length) {
      console.error(`  ✗ ${entry.name}@${entry.version} 缓存与源码不一致`);
      failed++;
    } else {
      console.log(`  ✓ ${entry.name}@${entry.version} 缓存与源码一致`);
    }
  }
}

console.log();
if (failed > 0) {
  console.error(`失败：${failed} 项不一致`);
  process.exit(1);
}
console.log("完成。hook 在会话创建时注册，新改动需重开一个会话才生效。");
