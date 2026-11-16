// DeepSeek 全家桶应用 API 的 HTTP 封装与运行配置。
// 零依赖：只用 Node 内置的 fetch / FormData / Blob。
//
// 五个独立接口：Search、Fetch、OCR、ASR、TTS。
// 对话内工具（deepseek_web_search、deepseek_read_url、文件输入、模型安全）由服务端
// 在模型请求里开启参数实现，不是独立端点，这里不封装——见 README 的说明。

import { readFileSync } from "node:fs";

export const DEFAULT_BASE_URL = "https://api.deepseek.com";
// 插件版本，与 .zcode-plugin/plugin.json 保持一致
export const DEFAULT_VERSION = "0.2.0";

export const OCR_PURPOSES = ["text_recognition", "rich_layout_recognition"];
export const TTS_VOICES = ["stella", "tide"];
export const TTS_FORMATS = ["wav", "pcm"];

export class ApiError extends Error {
  constructor(message, { status, code, type, body } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status ?? null;
    this.code = code ?? null;
    this.type = type ?? null;
    this.body = body ?? null;
  }
}

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

// 宿主未配置 userConfig 时可能把 ${...} 字面量传进来，视为未设置。
function isPlaceholder(value) {
  return typeof value === "string" && value.trim().startsWith("${");
}

// 读取运行配置：API Key 只允许来自环境变量或显式参数，不落盘。
export function resolveConfig(overrides = {}) {
  const apiKey = (overrides.apiKey || process.env.DEEPSEEK_API_KEY || "").trim();
  const rawBaseUrl = overrides.baseUrl || process.env.DEEPSEEK_BASE_URL || "";
  const baseUrl = (isPlaceholder(rawBaseUrl) ? DEFAULT_BASE_URL : rawBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");

  if (!apiKey || isPlaceholder(apiKey)) {
    throw new ConfigError(
      "Missing DeepSeek API key. Set DEEPSEEK_API_KEY in the environment, or pass --api-key <key>.",
    );
  }
  if (!/^https?:\/\//u.test(baseUrl)) {
    throw new ConfigError(`Invalid base URL: ${baseUrl}`);
  }
  return { apiKey, baseUrl };
}

// 重试策略：5xx 与网络错误重试 2 次，退避 100ms / 200ms。
// 4xx 不重试——密钥错、参数错重试多少次都是同样结果，只是白等。
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 100;
const DEFAULT_TIMEOUT_MS = 30_000;

// 搜索缓存：只缓存 search，TTL 5 分钟。
// 内存缓存而非磁盘：CLI 每次调用都是新进程，磁盘缓存命中率低且要处理残留；
// MCP 是长驻进程，能真正吃到缓存。
const CACHE_TTL_MS = 5 * 60 * 1000;
const searchCache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt) {
  return RETRY_BASE_MS * attempt;
}

/**
 * 发一次请求，返回 { response, text }。
 *
 * body 传字符串按 JSON 发，传 FormData 交给 undici 自己设 multipart 头——
 * 手写 Content-Type 会丢掉 boundary，服务端直接解析失败。
 */
async function send(path, config, body, { retries = MAX_RETRIES, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const headers = { Authorization: `Bearer ${config.apiKey}` };
  if (typeof body === "string") headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      if (retries > 0) {
        await sleep(backoffDelay(MAX_RETRIES - retries + 1));
        return send(path, config, body, { retries: retries - 1, timeoutMs });
      }
      throw new ApiError(`Request timed out after ${timeoutMs / 1000}s.`, { status: 408, code: "timeout" });
    }
    if (retries > 0) {
      await sleep(backoffDelay(MAX_RETRIES - retries + 1));
      return send(path, config, body, { retries: retries - 1, timeoutMs });
    }
    throw new ApiError(`Network error: ${error.message}`, { status: 504, code: "network_error" });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok && response.status >= 500 && retries > 0) {
    await sleep(backoffDelay(MAX_RETRIES - retries + 1));
    return send(path, config, body, { retries: retries - 1, timeoutMs });
  }

  return response;
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function throwHttpError(response, data) {
  const error = data && typeof data === "object" ? data.error : null;
  const message = (error && (error.message || error.code)) || `Request failed with HTTP ${response.status}.`;
  throw new ApiError(message, {
    status: response.status,
    code: error?.code ?? null,
    type: error?.type ?? null,
    body: data,
  });
}

// 统一 JSON 请求：只读接口，失败抛出带状态码的 ApiError。
export async function requestJson(path, config, payload, opts = {}) {
  const response = await send(path, config, JSON.stringify(payload), opts);
  const data = parseJson(await response.text());
  if (!response.ok) throwHttpError(response, data);
  if (!data || typeof data !== "object") {
    throw new ApiError(`Malformed response from ${path}.`, { status: response.status, code: "bad_response" });
  }
  return data;
}

// multipart 请求：给 OCR / ASR 用。
async function requestMultipart(path, config, form, opts = {}) {
  const response = await send(path, config, form, opts);
  const data = parseJson(await response.text());
  if (!response.ok) throwHttpError(response, data);
  if (!data || typeof data !== "object") {
    throw new ApiError(`Malformed response from ${path}.`, { status: response.status, code: "bad_response" });
  }
  return data;
}

// 二进制请求：给 TTS 用。音频不是 JSON，只有错误体才是。
// 响应体只能读一次，所以先按状态码决定读文本还是读字节。
async function requestBinary(path, config, payload, opts = {}) {
  const response = await send(path, config, JSON.stringify(payload), opts);
  if (!response.ok) throwHttpError(response, parseJson(await response.text()));
  // 音频边合成边返回，中途失败会以「提前结束的音频」呈现，只能由调用方按字节数判断
  return Buffer.from(await response.arrayBuffer());
}

/** 把磁盘文件读成 multipart 需要的形态；读不到就报配置错误，不静默跳过 */
export function readFileInput(path) {
  try {
    return { name: path.split(/[\\/]/).pop() || "file", data: readFileSync(path) };
  } catch (error) {
    throw new ConfigError(`Cannot read file ${path}: ${error.message}`);
  }
}

function toFormPart(file) {
  const bytes = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data ?? []);
  const name = file.name || "file";
  return [new Blob([bytes], { type: file.contentType ?? "application/octet-stream" }), name];
}

// Search：query 支持官方搜索语法（site:、-site:、-关键词、"短语"、lang:、after:/before:）。
export function search(params, config) {
  const body = { query: params.query };
  if (params.count !== undefined) body.count = params.count;
  if (params.oriQuestion) body.ori_question = params.oriQuestion;
  if (params.localization) body.localization = params.localization;
  if (params.needContent) body.need_content = true;

  // 相同查询在 TTL 内直接复用，省额度
  const key = JSON.stringify(body);
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return Promise.resolve(cached.data);
  }
  return requestJson("/v1/tools/search", config, body).then((data) => {
    searchCache.set(key, { at: Date.now(), data });
    return data;
  });
}

// Fetch：把目标网页抓成 Markdown。
export function fetchPage(params, config) {
  return requestJson("/v1/tools/fetch", config, { url: params.url });
}

/**
 * OCR：按页识别 PDF / Word / PowerPoint / 图片里的文字。
 *
 * 官方总时长上限 180 秒，30 秒默认超时会把正常的大文件误判成失败。
 */
export function ocr(params, config) {
  const [blob, name] = toFormPart(params.file);
  const form = new FormData();
  form.append("purpose", params.purpose);
  form.append("file", blob, name);
  return requestMultipart("/v1/tools/ocr", config, form, { timeoutMs: params.timeoutMs ?? 200_000 });
}

/** ASR：整段音频转写，最长 120 秒，不支持流式。 */
export function asr(params, config) {
  const [blob, name] = toFormPart(params.file);
  const form = new FormData();
  form.append("file", blob, name);
  return requestMultipart("/v1/tools/asr", config, form, { timeoutMs: params.timeoutMs ?? 300_000 });
}

/**
 * TTS：整段合成，音频写进 outPath（调用方必须给），返回元信息。
 *
 * 返回音频字节没有意义——命令行和 MCP 都只能落盘或播放，所以这里直接写文件，
 * 把 base64 塞进 JSON 只会让输出体积爆炸。
 */
export async function tts(params, config) {
  const payload = {
    text: params.text,
    voice_id: params.voiceId ?? "stella",
    format: params.format ?? "wav",
    filter_markdown: params.filterMarkdown !== false,
  };
  const audio = await requestBinary("/v1/tools/tts", config, payload, {
    timeoutMs: params.timeoutMs ?? 120_000,
  });
  const outPath = params.outPath;
  if (outPath) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(outPath, audio);
  }
  return {
    format: payload.format,
    voiceId: payload.voice_id,
    filterMarkdown: payload.filter_markdown,
    contentType: payload.format === "pcm" ? "audio/pcm" : "audio/wav",
    bytes: audio.length,
    outPath: outPath ?? null,
  };
}

// doctor：用一次最小 Search 探测 Key 与连通性，不消耗额度时不会成功计费。
export function doctor(config) {
  return requestJson("/v1/tools/search", config, { query: "deepseek api health check", count: 1 });
}
