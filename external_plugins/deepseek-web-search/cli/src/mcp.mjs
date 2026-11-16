// 通用 MCP stdio 服务：按工具定义暴露 DeepSeek Search / Fetch。
// 零依赖，手写 JSON-RPC 2.0 over stdio。

import { createInterface } from "node:readline";

import {
  ApiError,
  ConfigError,
  DEFAULT_VERSION,
  OCR_PURPOSES,
  TTS_FORMATS,
  TTS_VOICES,
  asr,
  fetchPage,
  ocr,
  readFileInput,
  resolveConfig,
  search,
  tts,
} from "./api.mjs";

const TOOLS = {
  search: {
    name: "deepseek_web_search",
    title: "DeepSeek Web Search",
    description:
      "Search the web with DeepSeek's official search API. Supports query syntax: site:, -site:, -term, \"phrase\", lang:zh,en, after:/before:. Returns ranked results with title, url, snippet, summary and optional page body.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query. Supports site:, -site:, -term, \"phrase\", lang:, after:/before: syntax.",
        },
        count: { type: "integer", minimum: 1, maximum: 50, description: "Results to return, 1-50. Default 10." },
        ori_question: { type: "string", description: "Original user question, improves ranking." },
        localization: { type: "string", description: "IP address used to localize results." },
        need_content: { type: "boolean", description: "Include the page body in each result." },
      },
      required: ["query"],
    },
  },
  fetch: {
    name: "deepseek_web_fetch",
    title: "DeepSeek Web Fetch",
    description:
      "Fetch a web page with DeepSeek's official fetch API and return its Markdown body plus title.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "HTTP or HTTPS URL to fetch." },
      },
      required: ["url"],
    },
  },
  ocr: {
    name: "deepseek_ocr",
    title: "DeepSeek OCR",
    description:
      "Recognize text in a local PDF, Word, PowerPoint or image file with DeepSeek's official OCR API. Returns the recognized text page by page. Charged per recognized page.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Absolute path to the local file to recognize." },
        purpose: {
          type: "string",
          enum: OCR_PURPOSES,
          description:
            "text_recognition extracts text directly from image-free Word/PPT and recognizes other files page by page; rich_layout_recognition recognizes every file page by page and keeps layout coordinates. Default text_recognition.",
        },
      },
      required: ["file"],
    },
  },
  asr: {
    name: "deepseek_asr",
    title: "DeepSeek Speech Recognition",
    description:
      "Transcribe a local audio file (16-bit PCM WAV or Ogg Opus, up to 120 seconds) with DeepSeek's official ASR API. Returns the full transcript.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Absolute path to the local audio file." },
      },
      required: ["file"],
    },
  },
  tts: {
    name: "deepseek_tts",
    title: "DeepSeek Text to Speech",
    description:
      "Synthesize text into speech with DeepSeek's official TTS API and write the audio to a file. Returns the saved path and size. The model cannot play audio, so report the path to the user.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to read, at most 10000 billable characters." },
        out_path: { type: "string", description: "Absolute path to write the audio file to." },
        voice_id: { type: "string", enum: TTS_VOICES, description: "stella (female, default) or tide (male)." },
        format: { type: "string", enum: TTS_FORMATS, description: "wav (default) or pcm." },
        filter_markdown: {
          type: "boolean",
          description: "Strip Markdown formatting before reading. Default true.",
        },
      },
      required: ["text", "out_path"],
    },
  },
};

function toolResult(text, structured) {
  return { content: [{ type: "text", text }], structuredContent: structured, isError: false };
}

function toolError(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function callTool(kind, args) {
  const tool = TOOLS[kind];
  const input = args && typeof args === "object" ? args : {};

  if (kind === "search") {
    if (typeof input.query !== "string" || input.query.trim() === "") {
      return toolError(`${tool.name} requires a non-empty "query" string.`);
    }
    if (input.query.length > 128) {
      return toolError(`${tool.name} "query" must be at most 128 characters.`);
    }
    const count = input.count;
    if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > 50)) {
      return toolError(`${tool.name} "count" must be an integer between 1 and 50.`);
    }
    const config = resolveConfig();
    const data = await search(
      {
        query: input.query,
        count,
        oriQuestion: input.ori_question,
        localization: input.localization,
        needContent: Boolean(input.need_content),
      },
      config,
    );
    const results = Array.isArray(data?.results) ? data.results : [];
    const text = results.length
      ? results
          .map(
            (item, index) =>
              `${index + 1}. ${item.title ?? "(untitled)"}\n   ${item.url ?? "-"}\n   ${item.snippet ?? ""}`,
          )
          .join("\n\n")
      : "No results.";
    return toolResult(text, data);
  }

  if (kind === "fetch") {
    if (typeof input.url !== "string" || !/^https?:\/\//u.test(input.url)) {
      return toolError(`${tool.name} requires an "url" starting with http:// or https://.`);
    }
    const config = resolveConfig();
    const data = await fetchPage({ url: input.url }, config);
    const text = `${data?.title ? `# ${data.title}\n\n` : ""}${data?.content ?? ""}`;
    return toolResult(text, data);
  }

  if (kind === "ocr") {
    if (typeof input.file !== "string" || input.file.trim() === "") {
      return toolError(`${tool.name} requires a "file" path.`);
    }
    if (input.purpose !== undefined && !OCR_PURPOSES.includes(input.purpose)) {
      return toolError(`${tool.name} "purpose" must be one of: ${OCR_PURPOSES.join(", ")}.`);
    }
    const config = resolveConfig();
    const data = await ocr({ file: readFileInput(input.file), purpose: input.purpose }, config);
    const pages = Array.isArray(data?.pages) ? data.pages : [];
    const text = pages.length
      ? pages.map((page) => page.text ?? "").join("\n\n")
      : "No recognized pages.";
    return toolResult(text, data);
  }

  if (kind === "asr") {
    if (typeof input.file !== "string" || input.file.trim() === "") {
      return toolError(`${tool.name} requires a "file" path.`);
    }
    const config = resolveConfig();
    const data = await asr({ file: readFileInput(input.file) }, config);
    return toolResult(data?.text ?? "", data);
  }

  if (kind === "tts") {
    if (typeof input.text !== "string" || input.text.trim() === "") {
      return toolError(`${tool.name} requires a non-empty "text".`);
    }
    if (typeof input.out_path !== "string" || input.out_path.trim() === "") {
      return toolError(`${tool.name} requires an "out_path" to write the audio to.`);
    }
    if (input.voice_id !== undefined && !TTS_VOICES.includes(input.voice_id)) {
      return toolError(`${tool.name} "voice_id" must be one of: ${TTS_VOICES.join(", ")}.`);
    }
    if (input.format !== undefined && !TTS_FORMATS.includes(input.format)) {
      return toolError(`${tool.name} "format" must be one of: ${TTS_FORMATS.join(", ")}.`);
    }
    const config = resolveConfig();
    const data = await tts(
      {
        text: input.text,
        outPath: input.out_path,
        voiceId: input.voice_id,
        format: input.format,
        filterMarkdown: input.filter_markdown,
      },
      config,
    );
    return toolResult(
      `Saved ${data.outPath} (${data.bytes} bytes, ${data.format}, voice ${data.voiceId}).`,
      data,
    );
  }

  return toolError(`Unsupported tool kind: ${kind}`);
}

// 启动一个 MCP stdio 服务；kind 为 "search" 或 "fetch"。
export function runMcpServer(kind) {
  const tool = TOOLS[kind];
  if (!tool) throw new ConfigError(`Unknown MCP tool kind: ${kind}`);

  const readline = createInterface({ input: process.stdin });
  process.stderr.write(`deepseek-web-search MCP server ready (${tool.name})\n`);

  readline.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      process.stderr.write("Ignoring non-JSON line.\n");
      return;
    }

    const { id, method, params } = message;
    if (id === undefined) return; // notification，无需响应

    const reply = (result) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
    const fail = (code, message) =>
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);

    if (method === "initialize") {
      reply({
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: tool.name, version: DEFAULT_VERSION },
      });
      return;
    }

    if (method === "tools/list") {
      reply({ tools: [{ ...tool, title: tool.title }] });
      return;
    }

    if (method === "tools/call") {
      const name = params?.name;
      if (name !== tool.name) {
        fail(-32602, `Unknown tool: ${name}`);
        return;
      }
      callTool(kind, params?.arguments)
        .then(reply)
        .catch((error) => {
          const message = error instanceof ApiError || error instanceof ConfigError
            ? error.message
            : error?.message ?? "Unexpected error.";
          reply(toolError(message));
        });
      return;
    }

    if (method === "ping") {
      reply({});
      return;
    }

    fail(-32601, `Method not found: ${method}`);
  });
}
