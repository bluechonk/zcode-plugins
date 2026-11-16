#!/usr/bin/env node
// DeepSeek 全家桶 CLI 入口：解析参数并分发到 Search / Fetch / OCR / ASR / TTS / doctor。
// 零依赖，只用 Node 内置模块。

import {
  ApiError,
  ConfigError,
  DEFAULT_VERSION,
  OCR_PURPOSES,
  TTS_FORMATS,
  TTS_VOICES,
  asr,
  doctor,
  fetchPage,
  ocr,
  readFileInput,
  resolveConfig,
  search,
  tts,
} from "./api.mjs";
import { formatJson, isFormat, render, renderError } from "./output.mjs";

const HELP = `dwt — DeepSeek 全家桶应用 API CLI（搜索 / 抓取 / OCR / 语音识别 / 语音合成）

Usage:
  dwt <command> [options]

Commands:
  search <query>        联网搜索（支持 site:, -site:, -term, "phrase", lang:, after:/before:）
  fetch <url>           抓取网页，返回 Markdown 正文
  ocr <file>            识别 PDF / Word / PPT / 图片中的文字，按页返回
  asr <file>            语音识别，把 16 位 PCM WAV 或 Ogg Opus 转成文字
  tts <text>           语音合成，把文字转成音频文件
  doctor                检查 API Key 与连通性

Options:
  --count <n>           搜索结果条数，1-50（默认 10）
  --need-content        搜索结果里带网页正文
  --ori-question <s>    触发搜索的原始问题，改善排序
  --localization <ip>   按 IP 本地化搜索结果
  --purpose <p>         OCR 模式：text_recognition（默认）| rich_layout_recognition
  --voice <v>           TTS 音色：stella（默认，女声）| tide（男声）
  --tts-format <f>      TTS 音频格式：wav（默认）| pcm
  --out <path>          TTS 音频输出路径（必填）
  --no-filter-markdown  TTS 保留 Markdown 标记，默认朗读前会去掉
  --timeout <ms>        OCR / ASR / TTS 的请求超时，默认按接口上限给
  --format <fmt>        json（默认）| text | markdown
  --api-key <key>       覆盖 DEEPSEEK_API_KEY
  --base-url <url>      覆盖 API 地址
  -h, --help            显示帮助
  -V, --version         显示版本

Environment:
  DEEPSEEK_API_KEY      必需的 API Key
  DEEPSEEK_BASE_URL     可选的 API 地址覆盖

Examples:
  dwt search "DeepSeek V4 发布" --count 5
  dwt fetch https://api-docs.deepseek.com/zh-cn/guides/search
  dwt ocr 合同.pdf --purpose rich_layout_recognition
  dwt asr 会议录音.wav
  dwt tts "你好，我是 DeepSeek。" --voice stella --out speech.wav
`;

// 支持 --opt=value 写法；只展开需要取值的已知选项，避免误伤搜索词。
const VALUE_OPTIONS = new Set([
  "--count",
  "--ori-question",
  "--localization",
  "--format",
  "--api-key",
  "--base-url",
  "--purpose",
  "--voice",
  "--tts-format",
  "--out",
  "--timeout",
]);

// 官方上限：超了必然被拒，本地先挡住，省掉一次必然失败的请求
const OCR_MAX_BYTES = 100 * 1024 * 1024;
const ASR_MAX_BYTES = 8 * 1024 * 1024;
const TTS_MAX_BYTES = 64 * 1024;

function expandEquals(argv) {
  const out = [];
  for (const token of argv) {
    const match = /^(--[a-z-]+)=(.*)$/su.exec(token);
    if (match && VALUE_OPTIONS.has(match[1])) out.push(match[1], match[2]);
    else out.push(token);
  }
  return out;
}

function parseArgs(argv) {
  const options = {
    command: null,
    positional: [],
    count: undefined,
    needContent: false,
    oriQuestion: undefined,
    localization: undefined,
    purpose: "text_recognition",
    voice: "stella",
    ttsFormat: "wav",
    out: undefined,
    filterMarkdown: true,
    timeout: undefined,
    format: "json",
    apiKey: undefined,
    baseUrl: undefined,
    help: false,
    version: false,
    endOfOptions: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new ConfigError(`Missing value for ${token}.`);
      index += 1;
      return value;
    };

    switch (token) {
      case "search":
      case "fetch":
      case "ocr":
      case "asr":
      case "tts":
      case "doctor":
        if (options.command) throw new ConfigError(`Multiple commands given: ${options.command}, ${token}.`);
        options.command = token;
        break;
      case "--count": {
        const value = Number(next());
        if (!Number.isInteger(value) || value < 1 || value > 50) {
          throw new ConfigError("--count must be an integer between 1 and 50.");
        }
        options.count = value;
        break;
      }
      case "--need-content":
        options.needContent = true;
        break;
      case "--ori-question":
        options.oriQuestion = next();
        break;
      case "--localization":
        options.localization = next();
        break;
      case "--purpose": {
        const value = next();
        if (!OCR_PURPOSES.includes(value)) {
          throw new ConfigError(`--purpose must be one of: ${OCR_PURPOSES.join(", ")}.`);
        }
        options.purpose = value;
        break;
      }
      case "--voice": {
        const value = next();
        if (!TTS_VOICES.includes(value)) {
          throw new ConfigError(`--voice must be one of: ${TTS_VOICES.join(", ")}.`);
        }
        options.voice = value;
        break;
      }
      case "--tts-format": {
        const value = next();
        if (!TTS_FORMATS.includes(value)) {
          throw new ConfigError(`--tts-format must be one of: ${TTS_FORMATS.join(", ")}.`);
        }
        options.ttsFormat = value;
        break;
      }
      case "--out":
        options.out = next();
        break;
      case "--no-filter-markdown":
        options.filterMarkdown = false;
        break;
      case "--timeout": {
        const value = Number(next());
        if (!Number.isInteger(value) || value <= 0) {
          throw new ConfigError("--timeout must be a positive integer of milliseconds.");
        }
        options.timeout = value;
        break;
      }
      case "--format": {
        const value = next();
        if (!isFormat(value)) throw new ConfigError(`Unknown --format "${value}". Use json, text or markdown.`);
        options.format = value;
        break;
      }
      case "--api-key":
        options.apiKey = next();
        break;
      case "--base-url":
        options.baseUrl = next();
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "-V":
      case "--version":
        options.version = true;
        break;
      case "--":
        options.endOfOptions = true;
        break;
      default:
        // 搜索语法允许 -site:、-关键词 这类以 - 开头的词，首个位置参数不能当成选项。
        if (!options.endOfOptions && token.startsWith("-")) {
          const expectsPositional = options.command !== null && options.command !== "doctor";
          if (!expectsPositional || options.positional.length > 0) {
            throw new ConfigError(`Unknown option: ${token}`);
          }
        }
        options.positional.push(token);
    }
  }
  return options;
}

// 文件大小前置校验：官方限制是硬上限，本地先挡住，避免白跑一趟还拿到 413
function assertFileSize(path, limit, label) {
  const file = readFileInput(path);
  if (file.data.length > limit) {
    throw new ConfigError(`${label} is ${file.data.length} bytes, over the ${limit} bytes limit: ${path}`);
  }
  return file;
}

// 校验通过后被复用的文件入参：大文件不该读两遍
function validate(options) {
  const files = {};
  if (options.help || options.version) return files;

  if (!options.command) {
    throw new ConfigError("No command given. Use search, fetch, ocr, asr, tts or doctor.");
  }

  const takesOneArg = ["search", "fetch", "ocr", "asr", "tts"].includes(options.command);
  if (takesOneArg && options.positional.length === 0) {
    throw new ConfigError(`${options.command} requires a positional argument.`);
  }
  if (takesOneArg && options.positional.length > 1) {
    throw new ConfigError(`${options.command} accepts exactly one positional argument.`);
  }
  if (options.command === "doctor" && options.positional.length > 0) {
    throw new ConfigError("doctor takes no positional arguments.");
  }

  if (options.command === "fetch" && !/^https?:\/\//u.test(options.positional[0])) {
    throw new ConfigError("fetch <url> must start with http:// or https://");
  }
  if (options.command === "search") {
    const query = options.positional[0];
    if (query.trim() === "") throw new ConfigError("search <query> must not be blank.");
    if (query.length > 128) throw new ConfigError("search <query> must be at most 128 characters.");
  }
  if (options.command === "ocr") {
    files.ocr = assertFileSize(options.positional[0], OCR_MAX_BYTES, "ocr file");
  }
  if (options.command === "asr") {
    files.asr = assertFileSize(options.positional[0], ASR_MAX_BYTES, "asr file");
  }
  if (options.command === "tts") {
    const text = options.positional[0];
    if (text.trim() === "") throw new ConfigError("tts <text> must not be blank.");
    if (Buffer.byteLength(text, "utf8") > TTS_MAX_BYTES) {
      throw new ConfigError(`tts <text> must be at most ${TTS_MAX_BYTES} bytes when UTF-8 encoded.`);
    }
    if (!options.out) throw new ConfigError("tts requires --out <path> to write the audio to.");
  }

  return files;
}

async function main() {
  let options;
  try {
    options = parseArgs(expandEquals(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(renderError(error, "text"));
    process.stderr.write(`\nRun "dwt --help" for usage.\n`);
    process.exitCode = 2;
    return;
  }

  if (options.version) {
    process.stdout.write(`${DEFAULT_VERSION}\n`);
    return;
  }
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  let files;
  try {
    files = validate(options);
  } catch (error) {
    process.stderr.write(renderError(error, "text"));
    process.stderr.write(`\nRun "dwt --help" for usage.\n`);
    process.exitCode = 2;
    return;
  }

  let config;
  try {
    config = resolveConfig(options);
  } catch (error) {
    process.stderr.write(renderError(error, options.format));
    process.exitCode = 2;
    return;
  }

  try {
    if (options.command === "search") {
      const data = await search(
        {
          query: options.positional[0],
          count: options.count,
          oriQuestion: options.oriQuestion,
          localization: options.localization,
          needContent: options.needContent,
        },
        config,
      );
      process.stdout.write(render("search", data, options.format));
      return;
    }

    if (options.command === "fetch") {
      const data = await fetchPage({ url: options.positional[0] }, config);
      process.stdout.write(render("fetch", data, options.format));
      return;
    }

    if (options.command === "ocr") {
      const data = await ocr({ file: files.ocr, purpose: options.purpose }, config);
      process.stdout.write(render("ocr", data, options.format));
      return;
    }

    if (options.command === "asr") {
      const data = await asr({ file: files.asr, timeoutMs: options.timeout }, config);
      process.stdout.write(render("asr", data, options.format));
      return;
    }

    if (options.command === "tts") {
      const data = await tts(
        {
          text: options.positional[0],
          voiceId: options.voice,
          format: options.ttsFormat,
          filterMarkdown: options.filterMarkdown,
          outPath: options.out,
          timeoutMs: options.timeout,
        },
        config,
      );
      process.stdout.write(render("tts", data, options.format));
      return;
    }

    const data = await doctor(config);
    const count = Array.isArray(data?.results) ? data.results.length : 0;
    process.stdout.write(
      options.format === "json"
        ? formatJson({ ok: true, baseUrl: config.baseUrl, results: count })
        : `OK: API key valid, Search reachable (${count} result${count === 1 ? "" : "s"}).\n`,
    );
  } catch (error) {
    process.stderr.write(renderError(error, options.format));
    process.exitCode = error instanceof ApiError && error.status === 402 ? 3 : 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
