---
name: deepseek-tts
description: Turn text into a speech audio file with DeepSeek's official TTS API. Use when the user wants text read aloud, an article turned into audio, or a voice note produced. Two voices (stella, tide), wav or pcm output.
---

# DeepSeek 语音合成（TTS）

用 DeepSeek 官方 TTS API 把文字合成音频。所有调用都走本插件自带的零依赖 CLI，不直连 HTTP。

## 何时使用

- 用户要把一段文字读出来、把文章转成音频、生成语音备忘。
- 需要配音、朗读、把回答变成可听的片段。

## 定位 CLI

按顺序尝试，命中即停：

1. PATH 中是否已全局安装：

   ```bash
   command -v dws
   ```

2. 未命中则用本技能目录推导插件根。本文件位于 `<插件根>/skills/deepseek-tts/SKILL.md`，因此：

   ```bash
   node "<本文件所在目录>/../../cli/src/index.mjs"
   ```

把下面示例里的 `CLI` 替换成上面解析出的调用形式。

## 基本用法

```bash
CLI tts "你好，我是 DeepSeek。" --out "speech.wav"
CLI tts "今日摘要如下" --voice tide --out "summary.wav"
CLI tts "# 标题\n正文" --out "article.pcm" --tts-format pcm
CLI tts "照读这段" --no-filter-markdown --out "raw.wav"
```

参数：

- 位置参数：要朗读的文本，必填。
- `--out <path>`：音频输出路径，必填——不指定就无处可写。
- `--voice stella|tide`：`stella` 女声（默认）、`tide` 男声。
- `--tts-format wav|pcm`：默认 `wav`；`pcm` 是 24 kHz、16 位、单声道裸流。
- `--no-filter-markdown`：默认会在朗读前去掉 Markdown 格式，加这个开关则保留。

## 结果怎么用

- 模型播不了音频，交付物是文件路径。回给用户时要给出路径与文件大小。
- 输出路径要落在用户工作目录或用户指定的位置，不要写进系统临时目录。
- 需要播放时，提示用户用本地播放器打开，或按宿主的媒体能力处理。

## 限制与计费

- 单次最多 10000 个计费字符（汉字算 2，其他算 1），请求体最大 64 KiB。
- 按字符计费（刊例 3 元 / 万字符，限时 5 折 1.5 元 / 万字符）。
- 不支持调节语速。流式合成走 WebSocket，本插件暂未封装，需要时用整段接口替代。

## 失败处理

- 退出码 2：参数或配置错误（多为缺 `DEEPSEEK_API_KEY`，或漏了 `--out`）。
- 退出码 3：HTTP 402，余额不足，提示充值，不要重试。
- 退出码 1：其他 API 错误。400 常见于是文本未过内容审核（`Content Exists Risk`）；429 是并发超上限，稍后重试一次。

## 边界

- 只合成用户给出的文本，不主动扩大范围。
- 不输出 API Key、不读取本地配置文件内容。
