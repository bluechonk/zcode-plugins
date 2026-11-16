# deepseek-web-search CLI

DeepSeek 全家桶应用 API 的命令行工具：联网搜索、网页抓取、OCR、语音识别、语音合成。零依赖，只用 Node 内置模块。

命令名是 `dws`，短，好敲。

## 获取

本包不发布到 npm，从仓库取用即可：

```bash
git clone https://github.com/bluechonk/zcode-plugins.git
cd zcode-plugins/external_plugins/deepseek-web-search/cli
```

`package.json` 里已声明 `bin`，本地链接一次即可全局用 `dws`：

```bash
npm link
dws doctor
```

不想链接就直接用 Node 跑，下文所有 `dws` 换成 `node src/index.mjs`：

```bash
node src/index.mjs search "DeepSeek V4 发布" --count 5
node src/index.mjs fetch https://api-docs.deepseek.com/zh-cn/guides/search
node src/index.mjs ocr 合同.pdf
node src/index.mjs asr 会议录音.wav
node src/index.mjs tts "你好" --out speech.wav
node src/index.mjs doctor
```

## 配置

| 环境变量 | 必填 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 是 | DeepSeek API Key，与普通 DeepSeek API 共用 |
| `DEEPSEEK_BASE_URL` | 否 | 覆盖 API 地址，默认 `https://api.deepseek.com` |

## 命令

```bash
dws search <query> [options]
dws fetch <url> [options]
dws ocr <file> [options]
dws asr <file> [options]
dws tts <text> --out <path> [options]
dws doctor
```

### search

```bash
dws search "DeepSeek V4 发布" --count 5
dws search "site:github.com deepseek" --need-content
dws search "AI 新闻" --format markdown
dws search "deepseek after:2026-10-01" --count 20
```

| 选项 | 说明 |
| --- | --- |
| `--count <n>` | 返回条数，1-50，默认 10 |
| `--need-content` | 结果中附带网页正文 |
| `--ori-question <s>` | 原始问题，改善排序 |
| `--localization <ip>` | 按 IP 本地化结果 |
| `--format <fmt>` | `json`（默认）/ `text` / `markdown` |

query 支持搜索语法：`site:`、`-site:`、`-关键词`、`"精确短语"`、`lang:zh,en`、`after:`、`before:`。

### fetch

```bash
dws fetch https://api-docs.deepseek.com/zh-cn/guides/search
dws fetch https://example.com/article --format json
```

| 选项 | 说明 |
| --- | --- |
| `--format <fmt>` | `json`（默认）/ `text` / `markdown` |

### ocr

```bash
dws ocr 合同.pdf
dws ocr 扫描件.png --format text
dws ocr 排版稿.pdf --purpose rich_layout_recognition
```

| 选项 | 说明 |
| --- | --- |
| `--purpose <p>` | `text_recognition`（默认）/ `rich_layout_recognition` |
| `--format <fmt>` | `json`（默认，含页码）/ `text` / `markdown` |
| `--timeout <ms>` | 覆盖请求超时，默认 200 秒（官方总时长上限 180 秒） |

文件上限 100 MiB、1000 页。超限在本地就挡住，不会白发一次请求。

### asr

```bash
dws asr 会议录音.wav
dws asr 采访.opus --format text
```

| 选项 | 说明 |
| --- | --- |
| `--format <fmt>` | `json`（默认，含 `duration_ms`）/ `text` / `markdown` |
| `--timeout <ms>` | 覆盖请求超时，默认 300 秒 |

只吃 16 位 PCM WAV 或 Ogg Opus，最长 120 秒，最大 8 MiB。

### tts

```bash
dws tts "你好，我是 DeepSeek。" --out speech.wav
dws tts "今日摘要" --voice tide --out summary.wav
dws tts "正文" --tts-format pcm --out audio.pcm
```

| 选项 | 说明 |
| --- | --- |
| `--out <path>` | 音频输出路径，必填 |
| `--voice <v>` | `stella`（默认，女声）/ `tide`（男声） |
| `--tts-format <f>` | `wav`（默认）/ `pcm` |
| `--no-filter-markdown` | 保留 Markdown 标记，默认朗读前会去掉 |
| `--timeout <ms>` | 覆盖请求超时，默认 120 秒 |

音频是二进制，直接写文件；命令回一句路径与字节数。

### doctor

```bash
dws doctor
```

用一次最小 Search 探测 Key 与连通性。

## 退出码

| 退出码 | 含义 |
| --- | --- |
| 0 | 成功 |
| 1 | API 错误 |
| 2 | 参数或配置错误 |
| 3 | 余额不足（HTTP 402） |

## MCP server

同一份代码也提供五个 stdio MCP server，每个暴露一个工具：

```bash
node src/mcp-search.mjs   # deepseek_web_search
node src/mcp-fetch.mjs    # deepseek_web_fetch
node src/mcp-ocr.mjs      # deepseek_ocr
node src/mcp-asr.mjs      # deepseek_asr
node src/mcp-tts.mjs      # deepseek_tts
```

## 计费

| 接口 | 计费单位 | 价格 |
| --- | --- | --- |
| Search | 每 1000 次成功请求 | 5 元 |
| Fetch | 每 1000 次成功请求 | 5 元 |
| OCR | 每 1000 页 | 1.5 元 |
| ASR | 每小时音频 | 0.78 元，限时 5 折 0.39 元 |
| TTS | 每 10000 字符 | 3 元，限时 5 折 1.5 元 |

失败与无结果不计费。限速：Search 100 QPS、Fetch 25 QPS；OCR 同时 15 个、ASR 与 TTS 各同时 50 个。

官方文档：<https://api-docs.deepseek.com/zh-cn/guides/search>
