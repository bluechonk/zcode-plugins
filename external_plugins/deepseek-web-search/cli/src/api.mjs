// DeepSeek Search / Fetch API 的 HTTP 封装与运行配置。
// 零依赖：只用 Node 内置的 fetch。

export const DEFAULT_BASE_URL = "https://api.deepseek.com";
// 插件版本，与 .zcode-plugin/plugin.json 保持一致
export const DEFAULT_VERSION = "0.1.1";

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

// 统一请求：只读接口，失败抛出带状态码的 ApiError。
export async function requestJson(path, { apiKey, baseUrl }, payload, { retries = MAX_RETRIES } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      if (retries > 0) {
        await sleep(backoffDelay(MAX_RETRIES - retries + 1));
        return requestJson(path, { apiKey, baseUrl }, payload, { retries: retries - 1 });
      }
      throw new ApiError("Request timed out after 30s.", { status: 408, code: "timeout" });
    }
    if (retries > 0) {
      await sleep(backoffDelay(MAX_RETRIES - retries + 1));
      return requestJson(path, { apiKey, baseUrl }, payload, { retries: retries - 1 });
    }
    throw new ApiError(`Network error: ${error.message}`, { status: 504, code: "network_error" });
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    if (response.status >= 500 && retries > 0) {
      await sleep(backoffDelay(MAX_RETRIES - retries + 1));
      return requestJson(path, { apiKey, baseUrl }, payload, { retries: retries - 1 });
    }
    const error = data && typeof data === "object" ? data.error : null;
    const message =
      (error && (error.message || error.code)) ||
      `Request failed with HTTP ${response.status}.`;
    throw new ApiError(message, {
      status: response.status,
      code: error?.code ?? null,
      type: error?.type ?? null,
      body: data,
    });
  }
  if (!data || typeof data !== "object") {
    throw new ApiError(`Malformed response from ${path}.`, { status: response.status, code: "bad_response" });
  }
  return data;
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

// doctor：用一次最小 Search 探测 Key 与连通性，不消耗额度时不会成功计费。
export function doctor(config) {
  return requestJson("/v1/tools/search", config, { query: "deepseek api health check", count: 1 });
}
