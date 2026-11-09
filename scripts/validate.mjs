#!/usr/bin/env node
/**
 * 校验 marketplace.json 与插件清单。
 *
 * 移植自 zai-org/zcode-plugins 的 scripts/validate.py（Apache-2.0），
 * 原文件见 THIRD-PARTY-NOTICES.md。移植时逐条对齐校验行为，
 * 输出格式与退出码保持一致，便于 CI 直接替换。
 *
 * 校验内容：
 *   - marketplace.json 必填字段与 i18n
 *   - 每个条目指向 ./plugins/<name> 或 ./external_plugins/<name>
 *   - 插件名 kebab-case 且唯一
 *   - 插件目录有清单，且 name/version/description_i18n 与 marketplace 一致
 *     查找顺序与 ZCode 客户端一致：.zcode-plugin/plugin.json 优先，兼容 .claude-plugin/
 *   - 两个插件根下的目录都已登记或显式 unlisted（TEMPLATE_DIRS 除外）
 *   - 符号链接与体积上限
 *
 * 零依赖，只用 node 内置模块。退出码 0 = 通过，1 = 失败。
 */

import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOTS = ["plugins", "external_plugins"];
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/u;

// 插件目录下的内容会被原样打包发布到公开 CDN，符号链接会让发布任务
// 读到（并发布）它指向的任何东西，所以直接拒绝而非跳过。体积上限防止
// 单个条目把产物构建变成磁盘填满练习。上限针对单个可发布单元
// （一个插件，或共享 assets），不针对整个插件根。
const MAX_PLUGIN_FILES = 5000;
const MAX_PLUGIN_BYTES = 256 * 1024 * 1024;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/u;
const LOCALE = /^[a-z]{2}(-[A-Za-z0-9]+)*$/u;
const CATEGORIES = new Set([
  "游戏/3D",
  "developer-tools",
  "productivity",
  "utilities",
  "guides",
  "finance",
  "template",
  "other",
]);

// 模板插件源留在仓库里作为复制起点，但故意不登记进 marketplace.json，
// 所以登记校验跳过它们。
const TEMPLATE_DIRS = new Set(["example-plugin"]);

const errors = [];

function err(msg) {
  errors.push(msg);
}

function toPosix(p) {
  return p.split("\\").join("/");
}

function relativeToRoot(p) {
  const rel = relative(ROOT, p);
  return toPosix(rel);
}

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      err(`${relativeToRoot(path)}: file not found`);
    } else {
      err(`${relativeToRoot(path)}: invalid JSON: ${error.message}`);
    }
    return null;
  }
}

function validateI18n(label, obj, field, requiredLocales) {
  const value = obj[field];
  if (!value) {
    err(`${label}: missing '${field}'`);
    return;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    err(`${label}: '${field}' must be an object`);
    return;
  }

  for (const locale of requiredLocales) {
    const text = value[locale];
    if (typeof text !== "string" || !text.trim()) {
      err(`${label}: '${field}.${locale}' must be a non-empty string`);
    }
  }

  for (const [locale, text] of Object.entries(value)) {
    if (!LOCALE.test(locale)) {
      err(`${label}: '${field}' has invalid locale key '${locale}'`);
    }
    if (typeof text !== "string" || !text.trim()) {
      err(`${label}: '${field}.${locale}' must be a non-empty string`);
    }
  }
}

/** 符号链接与体积上限检查，返回错误字符串数组。 */
function treeViolations(root, label, { caps = true } = {}) {
  if (lstatSync(root).isSymbolicLink()) {
    return [`${label}: directory is a symlink`];
  }
  const found = [];
  let files = 0;
  let total = 0;

  const walk = (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    for (const entry of entries) {
      const full = join(dir, entry.name);
      // lstat 而非 stat：链接本身要被识别出来，而不是跟过去
      const stats = lstatSync(full);
      const rel = toPosix(relative(root, full));
      if (stats.isSymbolicLink()) {
        found.push(`${label}: ${rel} is a symlink (not allowed)`);
        continue;
      }
      if (stats.isDirectory()) {
        walk(full);
      } else if (stats.isFile()) {
        files += 1;
        total += stats.size;
      }
    }
  };

  try {
    walk(root);
  } catch (error) {
    found.push(`${label}: ${error.message}`);
    return found;
  }

  if (!caps) return found;
  if (files > MAX_PLUGIN_FILES) {
    found.push(`${label}: ${files} files exceeds the ${MAX_PLUGIN_FILES} file limit`);
  }
  if (total > MAX_PLUGIN_BYTES) {
    found.push(`${label}: ${total} bytes exceeds the ${MAX_PLUGIN_BYTES} byte limit`);
  }
  return found;
}

/** ZCode 优先的清单查找，与客户端优先级一致。 */
function pluginManifestPath(pluginDir) {
  const preferred = join(pluginDir, ".zcode-plugin", "plugin.json");
  if (existsSync(preferred)) return preferred;
  return join(pluginDir, ".claude-plugin", "plugin.json");
}

function resolvePluginDir(entry, root) {
  const source = entry.source;
  const name = entry.name;
  if (typeof name !== "string" || !KEBAB.test(name)) {
    throw new Error("plugin name must be kebab-case");
  }
  const expected = PLUGIN_ROOTS.map((d) => `./${d}/${name}`);
  if (!expected.includes(source)) {
    throw new Error("source must be exactly ./plugins/<name> or ./external_plugins/<name>");
  }
  const directory = join(root, source.slice(2));
  const parentName = basename(dirname(source.slice(2)));
  // 父目录或目录本身都不能是链接，否则 realpath 检查会被整体替换绕过
  if (lstatSync(dirname(directory)).isSymbolicLink() || lstatSync(directory).isSymbolicLink()) {
    throw new Error("plugin source is a symlink");
  }
  if (resolve(dirname(directory)) !== join(resolve(root), parentName)) {
    throw new Error("plugin source resolves outside its declared root");
  }
  return directory;
}

/** ui.surfaces 字段校验（可选字段，缺失时不校验）。 */
function uiSurfaceErrors(manifest, pluginDir) {
  const ui = manifest.ui;
  if (ui === undefined) return [];
  const problems = [];
  if (typeof ui !== "object" || !Array.isArray(ui.surfaces)) {
    return ["ui.surfaces must be an array"];
  }

  let servers = manifest.mcpServers ?? "./.mcp.json";
  if (typeof servers === "string") {
    const path = resolve(pluginDir, servers);
    if (!path.startsWith(resolve(pluginDir))) {
      return ["UI MCP declaration must remain inside the plugin"];
    }
    try {
      servers = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    } catch {
      return ["UI MCP declaration must be valid JSON"];
    }
    if (servers && typeof servers === "object" && !Array.isArray(servers)) {
      servers = servers.mcpServers ?? servers;
    }
  }
  const names = servers && typeof servers === "object" ? new Set(Object.keys(servers)) : new Set();

  const seen = new Set();
  for (const surface of ui.surfaces) {
    if (typeof surface !== "object" || surface === null) {
      problems.push("ui.surfaces entry must be an object");
      continue;
    }
    const id = surface.id;
    if (
      typeof id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(id) ||
      seen.has(id)
    ) {
      problems.push("ui.surfaces requires unique valid ids");
    } else {
      seen.add(id);
    }
    const title = surface.title;
    const titles = title && typeof title === "object" ? Object.values(title) : [title];
    if (!titles || titles.length === 0 || !titles.every((t) => typeof t === "string" && t.trim())) {
      problems.push("ui.surfaces title must contain non-empty text");
    }
    const server = surface.server;
    if (typeof server !== "string" || !names.has(server)) {
      problems.push("ui.surfaces server must name a declared MCP server");
    }
    const uri = surface.resourceUri;
    if (
      typeof uri !== "string" ||
      !uri.trim().startsWith("ui://") ||
      !(uri.trim().length > 5 && uri.trim().length <= 2048)
    ) {
      problems.push("ui.surfaces resourceUri must use ui:// and be at most 2048 characters");
    }
    if (surface.availability !== "session") {
      problems.push("ui.surfaces availability must be session");
    }
  }
  return problems;
}

function main() {
  const marketplace = loadJson(join(ROOT, "marketplace.json"));
  if (marketplace === null) {
    printResults();
    return;
  }

  for (const field of ["name", "owner", "plugins"]) {
    if (marketplace[field] === undefined) {
      err(`marketplace.json: missing required field '${field}'`);
    }
  }
  if (!marketplace.description) {
    err("marketplace.json: missing 'description'");
  }
  validateI18n("marketplace.json", marketplace, "description_i18n", ["en", "zh-CN"]);

  const entries = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  if (!Array.isArray(marketplace.plugins)) {
    err("marketplace.json: 'plugins' must be a list");
  }

  const seen = new Set();
  const registeredDirs = new Set();

  entries.forEach((entry, i) => {
    let label = `marketplace.json plugins[${i}]`;
    const name = entry?.name;
    if (!name) {
      err(`${label}: missing 'name'`);
      return;
    }
    label = `${label} (${name})`;

    if (!KEBAB.test(name)) {
      err(`${label}: name must be kebab-case (lowercase letters, digits, hyphens)`);
    }
    if (seen.has(name)) {
      err(`${label}: duplicate plugin name`);
    }
    seen.add(name);

    for (const field of ["source", "description", "version"]) {
      if (!entry[field]) {
        err(`${label}: missing '${field}'`);
      }
    }
    validateI18n(label, entry, "description_i18n", ["en", "zh-CN"]);

    const version = entry.version ?? "";
    if (version && !SEMVER.test(version)) {
      err(`${label}: version '${version}' is not semver (X.Y.Z)`);
    }

    const category = entry.category;
    if (!category) {
      err(`${label}: missing 'category'`);
    } else if (!CATEGORIES.has(category)) {
      err(
        `${label}: category '${category}' not in allowed set (${[...CATEGORIES].sort().join(", ")}); propose new categories via PR`
      );
    }

    let pluginDir;
    try {
      pluginDir = resolvePluginDir(entry, ROOT);
    } catch (error) {
      err(`${label}: ${error.message}`);
      return;
    }
    registeredDirs.add(entry.source.slice(2));
    if (!existsSync(pluginDir)) {
      err(`${label}: source directory ${entry.source} does not exist`);
      return;
    }
    if (lstatSync(pluginDir).isDirectory() === false) {
      err(`${label}: source is not a directory`);
      return;
    }
    if (dirname(pluginDir) !== ROOT && !resolve(pluginDir).startsWith(resolve(ROOT))) {
      err(`${label}: source escapes the repository root`);
      return;
    }
    if (basename(pluginDir) !== name) {
      err(`${label}: directory name '${basename(pluginDir)}' does not match plugin name`);
    }
    for (const problem of treeViolations(pluginDir, label)) err(problem);

    const manifest = loadJson(pluginManifestPath(pluginDir));
    if (manifest === null) return;
    if (manifest.name !== name) {
      err(`${label}: plugin.json name '${manifest.name}' does not match`);
    }
    if (manifest.version !== version) {
      err(
        `${label}: plugin.json version '${manifest.version}' does not match marketplace version '${version}'`
      );
    }
    if (!manifest.description) {
      err(`${label}: plugin.json missing 'description'`);
    }
    validateI18n(`${label}: plugin.json`, manifest, "description_i18n", ["en", "zh-CN"]);
    if (JSON.stringify(manifest.description_i18n) !== JSON.stringify(entry.description_i18n)) {
      err(`${label}: plugin.json description_i18n does not match marketplace entry`);
    }
    for (const problem of uiSurfaceErrors(manifest, pluginDir)) err(`${label}: ${problem}`);
  });

  // 保留已下架的源树，但不让它们成为可安装的目录条目
  const unlisted = Array.isArray(marketplace.unlistedPlugins) ? marketplace.unlistedPlugins : [];
  if (marketplace.unlistedPlugins !== undefined && !Array.isArray(marketplace.unlistedPlugins)) {
    err("marketplace.json: 'unlistedPlugins' must be a list");
  }
  for (const entry of unlisted) {
    try {
      if (typeof entry !== "object" || entry === null) {
        throw new Error("entry must be an object");
      }
      const pluginDir = resolvePluginDir(entry, ROOT);
      if (!existsSync(pluginDir)) {
        throw new Error("source directory does not exist");
      }
      if (registeredDirs.has(entry.source.slice(2))) {
        throw new Error("source is already listed or unlisted");
      }
      registeredDirs.add(entry.source.slice(2));
    } catch (error) {
      err(`marketplace.json unlistedPlugins: ${error.message}`);
    }
  }

  for (const directory of PLUGIN_ROOTS) {
    const pluginsRoot = join(ROOT, directory);
    if (!existsSync(pluginsRoot)) continue;
    for (const child of readdirSync(pluginsRoot, { withFileTypes: true })) {
      if (child.isSymbolicLink()) {
        err(`${directory}/${child.name}: symlink (not allowed)`);
      } else if (
        child.isDirectory() &&
        !registeredDirs.has(`${directory}/${child.name}`) &&
        !(directory === "plugins" && TEMPLATE_DIRS.has(child.name))
      ) {
        err(`${directory}/${child.name}: directory not registered in marketplace.json`);
      }
    }
  }

  // 共享 assets 由同一个任务发布到 CDN，规则相同
  const assets = join(ROOT, "assets");
  if (existsSync(assets)) {
    for (const problem of treeViolations(assets, "assets")) err(problem);
  }

  printResults(entries.length);
}

function printResults(count) {
  if (errors.length > 0) {
    console.error(`FAIL: ${errors.length} problem(s)`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK: ${count} plugin(s) validated`);
}

main();
