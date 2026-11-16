// 输出格式化：json（默认，给 agent 解析）/ text / markdown（给人看）。

export const FORMATS = ["json", "text", "markdown"];

export function isFormat(value) {
  return FORMATS.includes(value);
}

export function formatJson(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

function clip(text, max) {
  const value = String(text ?? "");
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function formatSearchText(data) {
  const results = Array.isArray(data?.results) ? data.results : [];
  if (results.length === 0) return "No results.\n";

  const lines = results.map((item, index) => {
    const score = item.rerank_score ?? "-";
    const date = item.date ?? "-";
    return [
      `${index + 1}. ${item.title ?? "(untitled)"}`,
      `   url: ${item.url ?? "-"}`,
      `   score: ${score}  authority: ${item.authority ?? "-"}  date: ${date}`,
      `   ${clip(item.snippet, 220)}`,
    ].join("\n");
  });
  return `${lines.join("\n\n")}\n`;
}

function formatSearchMarkdown(data) {
  const results = Array.isArray(data?.results) ? data.results : [];
  if (results.length === 0) return "No results.\n";

  const lines = results.map((item, index) => {
    const score = item.rerank_score ?? "-";
    const date = item.date ?? "-";
    return [
      `${index + 1}. **[${item.title ?? "(untitled)"}](${item.url ?? "#"})**`,
      `   score \`${score}\` · authority \`${item.authority ?? "-"}\` · date \`${date}\``,
      `   ${clip(item.summary || item.snippet, 400).replace(/\n+/gu, " ")}`,
    ].join("\n");
  });
  return `${lines.join("\n\n")}\n`;
}

function formatFetchText(data) {
  const title = data?.title ?? "";
  const content = data?.content ?? "";
  return `${title ? `# ${title}\n\n` : ""}${content}\n`;
}

function formatFetchMarkdown(data) {
  const title = data?.title ?? "";
  const content = data?.content ?? "";
  return `${title ? `# ${title}\n\n` : ""}${content}\n`;
}

// OCR / ASR 的正文可能很长，text 与 markdown 只给正文，页码信息放进行内标题
function formatPagesText(data) {
  const pages = Array.isArray(data?.pages) ? data.pages : [];
  if (pages.length === 0) return "No recognized pages.\n";
  return pages
    .map((page) => {
      const head = pages.length > 1 ? `----- page ${page.index + 1} -----\n` : "";
      return `${head}${page.text ?? ""}`;
    })
    .join("\n");
}

function formatPagesMarkdown(data) {
  const pages = Array.isArray(data?.pages) ? data.pages : [];
  if (pages.length === 0) return "No recognized pages.\n";
  if (pages.length === 1) return `${pages[0].text ?? ""}\n`;
  return pages
    .map((page) => `### 第 ${page.index + 1} 页\n\n${page.text ?? ""}`)
    .join("\n\n");
}

function formatTtsText(data) {
  const size = data?.bytes ?? 0;
  return `Saved ${data?.outPath ?? "(nowhere)"} (${size} bytes, ${data?.format ?? "wav"}, voice ${data?.voiceId ?? "-"}).\n`;
}

// 按 kind 选择渲染器；未知格式回退 json。
export function render(kind, data, format) {
  if (format === "text") {
    if (kind === "search") return formatSearchText(data);
    if (kind === "ocr") return formatPagesText(data);
    if (kind === "asr") return `${data?.text ?? ""}\n`;
    if (kind === "tts") return formatTtsText(data);
    return formatFetchText(data);
  }
  if (format === "markdown") {
    if (kind === "search") return formatSearchMarkdown(data);
    if (kind === "ocr") return formatPagesMarkdown(data);
    if (kind === "asr") return `${data?.text ?? ""}\n`;
    if (kind === "tts") return formatTtsText(data);
    return formatFetchMarkdown(data);
  }
  return formatJson(data);
}

// 错误也按格式输出，方便 agent 解析失败原因。
export function renderError(error, format) {
  const payload = {
    error: {
      message: error.message,
      name: error.name ?? "Error",
      status: error.status ?? null,
      code: error.code ?? null,
    },
  };
  if (format === "json") return formatJson(payload);
  const head = `${error.name ?? "Error"}: ${error.message}`;
  const detail = error.status ? ` (HTTP ${error.status}${error.code ? `, ${error.code}` : ""})` : "";
  return `${head}${detail}\n`;
}
