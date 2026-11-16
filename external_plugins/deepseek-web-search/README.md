# deepseek-web-search

把 DeepSeek 全家桶应用 API 接入 ZCode：联网搜索、网页抓取、OCR、语音识别、语音合成。

架构上是「CLI 为唯一事实来源」：`cli/` 是一个零依赖的 Node 包，`commands`、`skills`、`mcpServers` 全部基于它的子命令构建。脱离 ZCode 时，其他 agent 直接调用同一份 CLI 源码即可，无需安装。

## 五个接口

| 接口 | 端点 | 用途 |
| --- | --- | --- |
| Search | `POST /v1/tools/search` | 联网搜索，返回结构化结果 |
| Fetch | `POST /v1/tools/fetch` | 抓取单个网页，返回 Markdown |
| OCR | `POST /v1/tools/ocr` | 识别 PDF / Word / PPT / 图片中的文字，按页返回 |
| ASR | `POST /v1/tools/asr` | 把 16 位 PCM WAV 或 Ogg Opus 转成文字 |
| TTS | `POST /v1/tools/tts` | 把文字合成音频文件 |

全部使用与 DeepSeek API 相同的 Bearer 鉴权，同一个 Key。

## 组件

| 组件 | 位置 | 作用 |
| --- | --- | --- |
| CLI | `cli/src/index.mjs` | 零依赖命令行，`search` / `fetch` / `ocr` / `asr` / `tts` / `doctor` |
| MCP | `cli/src/mcp-*.mjs` | 五个 stdio MCP server，各暴露一个工具 |
| Command | `commands/*.md` | 五条斜杠命令，委托给对应 skill |
| Skill | `skills/*/SKILL.md` | 引导 agent 正确使用 CLI |

## 前置条件

- Node.js >= 18（用到内置 `fetch` / `FormData` / `Blob`）。
- DeepSeek API Key，通过环境变量 `DEEPSEEK_API_KEY` 提供。
- 可选：`DEEPSEEK_BASE_URL` 覆盖 API 地址（代理或测试用）。

API Key 只走环境变量或 `--api-key`，不写进任何配置文件。

## 独立使用 CLI

本包不发布到 npm，从仓库取用即可：

```bash
git clone https://github.com/bluechonk/zcode-plugins.git
cd zcode-plugins/external_plugins/deepseek-web-search/cli
npm link          # package.json 里已声明 bin，链接一次即可全局用 dws
```

```bash
dws search "DeepSeek V4 发布" --count 5
dws fetch https://api-docs.deepseek.com/zh-cn/guides/search
dws ocr 合同.pdf --purpose rich_layout_recognition
dws asr 会议录音.wav
dws tts "你好，我是 DeepSeek。" --voice stella --out speech.wav
dws doctor
```

不想链接就每次用 Node 直接跑，把下文的 `dws` 换成 `node src/index.mjs`。

## 在 ZCode 里使用

安装插件后：

- 斜杠命令：`/deepseek_web_search`、`/deepseek_web_fetch`、`/deepseek_ocr`、`/deepseek_asr`、`/deepseek_tts`。
- Skill：在输入框选择 `deepseek-web-search`、`deepseek-web-fetch`、`deepseek-ocr`、`deepseek-asr`、`deepseek-tts`。
- MCP：五个 server 自动注册为 `deepseek_web_search`、`deepseek_web_fetch`、`deepseek_ocr`、`deepseek_asr`、`deepseek_tts` 工具，模型可直接调用。

插件自带 CLI，不需要全局安装；全局安装只是给非 ZCode 场景用。

## 定价与限速

| 接口 | 计费 | 限速 |
| --- | --- | --- |
| Search | 5 元 / 千次成功请求 | 100 QPS |
| Fetch | 5 元 / 千次成功请求 | 25 QPS |
| OCR | 1.5 元 / 千页 | 同时 15 个 |
| ASR | 0.78 元 / 小时，限时 5 折 0.39 元 | 同时 50 个 |
| TTS | 3 元 / 万字符，限时 5 折 1.5 元 | 同时 50 个 |

失败与无结果不计费。语音两项的 5 折是限时活动价。

## 对话内工具：不在本插件范围

DeepSeek 同时把这批能力做成了模型请求里的开关（`deepseek_web_search`、`deepseek_read_url` 工具，文件输入，`safety_check` 等），由服务端在推理时自动调用并拼接上下文，只对 `deepseek-flash` 开放。那是 provider 侧的参数，不是独立端点，插件无法也不应该代劳——要开的话在 ZCode 的 provider 配置里加，参考官方「构建 Chatbot」指南。

本插件封装的是**独立接口**：自己控制调用时机、自己拼装上下文，适合 agent 工作流。

## 输出格式

- `json`（默认）：结构化 JSON，适合程序解析。
- `text`：紧凑文本，适合日志。
- `markdown`：带链接的排版，适合直接展示或写文档。

TTS 是二进制音频，一律写文件（`--out` 必填），命令只回路径与字节数。

## 退出码

| 退出码 | 含义 |
| --- | --- |
| 0 | 成功 |
| 1 | API 错误（408/429/5xx 可重试一次） |
| 2 | 参数或配置错误，不重试 |
| 3 | HTTP 402，余额不足，充值后再试 |

## Claude Code 用户

本插件的 MCP 配置写在 `.zcode-plugin/plugin.json` 里，供 ZCode 使用。Claude Code 用户可参照同一份 CLI 自行配置：

```json
{
  "mcpServers": {
    "deepseek_web_search": {
      "command": "node",
      "args": ["<插件根>/cli/src/mcp-search.mjs"],
      "env": { "DEEPSEEK_API_KEY": "sk-..." }
    }
  }
}
```

其余四个把 `mcp-search.mjs` 换成 `mcp-fetch.mjs` / `mcp-ocr.mjs` / `mcp-asr.mjs` / `mcp-tts.mjs` 即可。

## 边界

只做检索、抓取、识别与合成，不写回 DeepSeek，不碰账号设置。不引入任何 npm 运行时依赖。

官方文档：<https://api-docs.deepseek.com/zh-cn/guides/search> · <https://api-docs.deepseek.com/zh-cn/guides/ocr> · <https://api-docs.deepseek.com/zh-cn/guides/asr> · <https://api-docs.deepseek.com/zh-cn/guides/tts>
