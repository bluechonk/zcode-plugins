/**
 * 插件构建：把每个插件 src/ 下的 TypeScript 打包成单文件 ESM，落到 hooks/。
 *
 * 干什么：ZCode 直接执行插件目录里的文件，不编译任何东西，所以插件必须吃 .mjs。
 *        单文件产物没有相对 import 解析问题，装进 cache 目录也不会踩路径坑。
 * 怎么跑：node scripts/build.mjs           构建全部插件并写盘
 *        node scripts/build.mjs --check   只比对，不写盘；不一致则退出码 1
 * 依赖：esbuild（devDependency）。产物零运行时依赖。
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

function banner(pluginName) {
  return (
    `// 本文件由 scripts/build.mjs 从 external_plugins/${pluginName}/src/index.ts 生成。\n` +
    `// 请修改源码并重跑 \`npm run build\`，不要直接编辑本文件。\n`
  );
}

async function bundle(entry, pluginName) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // 不压缩：产物入库且要能被人审读，安全类代码更不该是黑盒
    minify: false,
    legalComments: "none",
    banner: { js: banner(pluginName) },
    write: false,
  });
  return result.outputFiles[0].text;
}

const pluginNames = readdirSync(PLUGINS_DIR).filter((name) => {
  const entry = join(PLUGINS_DIR, name, "src", "index.ts");
  return existsSync(entry);
});

if (pluginNames.length === 0) {
  console.log("没有找到带 src/index.ts 的插件");
  process.exit(0);
}

let drifted = 0;
for (const name of pluginNames) {
  const entry = join(PLUGINS_DIR, name, "src", "index.ts");
  const outPath = join(PLUGINS_DIR, name, "hooks", `${name}.mjs`);
  const code = await bundle(entry, name);

  if (CHECK_ONLY) {
    const current = existsSync(outPath) ? readFileSync(outPath, "utf8") : null;
    if (current !== code) {
      console.error(`✗ ${name}: 产物与源码不一致，请跑 npm run build`);
      drifted++;
    } else {
      console.log(`✓ ${name}: 产物最新`);
    }
    continue;
  }

  await writeFile(outPath, code, "utf8");
  console.log(`构建 ${name} -> hooks/${name}.mjs (${code.length} bytes)`);
}

if (CHECK_ONLY && drifted > 0) process.exit(1);
