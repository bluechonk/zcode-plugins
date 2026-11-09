/**
 * 插件构建：把每个插件 src/ 下的 TypeScript 打包成单文件 ESM，落到 hooks/。
 *
 * 干什么：ZCode 直接执行插件目录里的文件，不编译任何东西，所以插件必须吃 .mjs。
 *        单文件产物没有相对 import 解析问题，装进 cache 目录也不会踩路径坑。
 * 怎么跑：node scripts/build.mjs           构建全部插件并写盘
 *        node scripts/build.mjs --check   只比对，不写盘；不一致则退出码 1
 * 依赖：esbuild（devDependency）。产物零运行时依赖。
 *
 * 入口规则：src/*.ts（顶层文件）各产出一个 hooks/<同名>.mjs；src/lib/** 是共享代码，
 * 被打进各入口、不单独产出。
 *
 * 产物入库、由 CI 跑 --check 挡住「改了源码忘了构建」的漂移。
 */

import { build } from "esbuild";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PLUGINS_DIR = join(ROOT, "external_plugins");
const CHECK_ONLY = process.argv.includes("--check");

function banner(pluginName, entryName) {
  return (
    `// 本文件由 scripts/build.mjs 从 external_plugins/${pluginName}/src/${entryName}.ts 生成。\n` +
    `// 请修改源码并重跑 \`npm run build\`，不要直接编辑本文件。\n`
  );
}

async function bundle(entry, pluginName, entryName) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // 不压缩：产物入库且要能被人审读，安全类代码更不该是黑盒
    minify: false,
    legalComments: "none",
    banner: { js: banner(pluginName, entryName) },
    write: false,
  });
  return result.outputFiles[0].text;
}

/** 顶层 .ts 是 hook 入口；lib/ 只被引用、不产出 */
function entriesOf(pluginDir) {
  const srcDir = join(pluginDir, "src");
  if (!existsSync(srcDir)) return [];
  return readdirSync(srcDir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .map((f) => f.slice(0, -3))
    .sort();
}

const jobs = [];
for (const name of readdirSync(PLUGINS_DIR)) {
  const pluginDir = join(PLUGINS_DIR, name);
  if (!existsSync(join(pluginDir, ".zcode-plugin", "plugin.json"))) continue;
  for (const entry of entriesOf(pluginDir)) jobs.push({ plugin: name, entry });
}

if (jobs.length === 0) {
  console.log("没有找到可构建的插件入口");
  process.exit(0);
}

let drifted = 0;
for (const { plugin, entry } of jobs) {
  const entryPath = join(PLUGINS_DIR, plugin, "src", `${entry}.ts`);
  const outPath = join(PLUGINS_DIR, plugin, "hooks", `${entry}.mjs`);
  const code = await bundle(entryPath, plugin, entry);

  if (CHECK_ONLY) {
    const current = existsSync(outPath) ? readFileSync(outPath, "utf8") : null;
    if (current !== code) {
      console.error(`✗ ${plugin}/${entry}: 产物与源码不一致，请跑 npm run build`);
      drifted++;
    } else {
      console.log(`✓ ${plugin}/${entry}: 产物最新`);
    }
    continue;
  }

  await writeFile(outPath, code, "utf8");
  console.log(`构建 ${plugin}/${entry} -> hooks/${entry}.mjs (${code.length} bytes)`);
}

if (CHECK_ONLY && drifted > 0) process.exit(1);
