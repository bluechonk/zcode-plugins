---
name: deepseek-asr
description: Transcribe a local audio file with DeepSeek's official ASR API. Use when the user wants a meeting recording, voice memo or interview turned into text, or when an audio file must be searchable. Supports 16-bit PCM WAV and Ogg Opus up to 120 seconds.
---

# DeepSeek 语音识别（ASR）

用 DeepSeek 官方 ASR API 把本地音频转成文字。所有调用都走本插件自带的零依赖 CLI，不直连 HTTP。

## 何时使用

- 用户要把录音、会议纪要、语音备忘、采访转成文字。
- 需要把音频内容变成可检索、可引用的文本。

## 定位 CLI

按顺序尝试，命中即停：

1. PATH 中是否已全局安装：

   ```bash
   command -v dwt
   ```

2. 未命中则用本技能目录推导插件根。本文件位于 `<插件根>/skills/deepseek-asr/SKILL.md`，因此：

   ```bash
   node "<本文件所在目录>/../../cli/src/index.mjs"
   ```

把下面示例里的 `CLI` 替换成上面解析出的调用形式。

## 基本用法

```bash
CLI asr "会议录音.wav"
CLI asr "采访.opus" --format text
CLI asr "备忘.wav" --format json
```

参数：

- 位置参数：本地音频路径。格式为 16 位 PCM WAV 或 Ogg Opus，由文件内容判断。
- `--format json|text|markdown`：默认 `json`，含 `text` 与 `duration_ms`；`text` 只给转写文本。

## 结果怎么用

- 只要文字就用 `--format text`；需要时长或请求 ID 留存时用 `json`。
- 转写结果没有标点保证，也不要自行「修正」人名术语而不说明。
- 音频最长 120 秒，超长文件要提醒用户先切片，不要静默截断。

## 限制与计费

- 文件最大 8 MiB，时长最长 120 秒，只支持整段识别（没有流式）。
- 按音频时长计费（刊例 0.78 元 / 小时，限时 5 折 0.39 元 / 小时），精确到秒。
- 语种自动识别，没有语种参数。双声道只识别左声道。

## 失败处理

- 退出码 2：参数或配置错误（多为缺 `DEEPSEEK_API_KEY`，或文件超过 8 MiB）。
- 退出码 3：HTTP 402，余额不足，提示充值，不要重试。
- 退出码 1：其他 API 错误。400 多为格式不符（不是 16 位 PCM WAV 或 Ogg Opus）；429 是并发超上限，稍后重试一次。

## 边界

- 只转写用户明确给出的文件，不主动去翻其他目录。
- 不输出 API Key、不读取本地配置文件内容。
