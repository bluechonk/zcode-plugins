---
name: deepseek-ocr
description: Recognize text in a local PDF, Word, PowerPoint or image with DeepSeek's official OCR API. Use when the user wants the text of a document or picture, when a screenshot or scan must be read, or when a PDF needs to become searchable text. Returns the recognized text page by page.
---

# DeepSeek 文字识别（OCR）

用 DeepSeek 官方 OCR API 识别本地文档或图片里的文字。所有调用都走本插件自带的零依赖 CLI，不直连 HTTP。

## 何时使用

- 用户要提取 PDF / Word / PPT / 图片里的文字。
- 截图、扫描件、照片需要读出内容。
- 需要按页定位文字在原文档中的位置（用 `rich_layout_recognition`）。

## 定位 CLI

按顺序尝试，命中即停：

1. PATH 中是否已全局安装：

   ```bash
   command -v dwt
   ```

2. 未命中则用本技能目录推导插件根。本文件位于 `<插件根>/skills/deepseek-ocr/SKILL.md`，因此：

   ```bash
   node "<本文件所在目录>/../../cli/src/index.mjs"
   ```

把下面示例里的 `CLI` 替换成上面解析出的调用形式。

## 基本用法

```bash
CLI ocr "合同.pdf"
CLI ocr "扫描件.png" --format text
CLI ocr "排版稿.pdf" --purpose rich_layout_recognition
CLI ocr "表格.xlsx截图.png" --purpose rich_layout_recognition --format json
```

参数：

- 位置参数：本地文件路径。支持 PDF、Word（DOC/DOCX）、PowerPoint（PPT/PPTX）与 PNG/JPEG/WebP/GIF/BMP/TIFF 图片。
- `--purpose`：`text_recognition`（默认）对不含图片的 Word/PPT 直接抽取文字，其他文件逐页识别；`rich_layout_recognition` 一律逐页识别并保留版面坐标。
- `--format json|text|markdown`：默认 `json`，含 `page_count` 与每页 `index` / `text` / `finish_reason`。

## 结果怎么用

- 需要保留页码、或后面要按页引用时用 `json`；只要文字内容时用 `text`。
- `rich_layout_recognition` 的文本里带 `<｜ref｜>...<｜/box｜>` 这类标记与 `[[x1,y1,x2,y2]]` 归一化坐标，直接展示给用户前要清掉。
- 某一页 `finish_reason` 是 `length` 说明这页没识别完，如实告知，不要当成完整内容。

## 限制与计费

- 文件最大 100 MiB、最多 1000 页；总时长上限 180 秒。
- 按识别成功的页数计费（1.5 元 / 1000 页），失败与超时不计费。
- 设了打开密码的文件、无法解析的文件会被拒，报错信息里给了具体原因。

## 失败处理

- 退出码 2：参数或配置错误（多为缺 `DEEPSEEK_API_KEY`，或文件超过大小上限）。
- 退出码 3：HTTP 402，余额不足，提示充值，不要重试。
- 退出码 1：其他 API 错误。429 是并发识别数超上限，稍后重试一次；400/413/408 改了请求才有意义。

## 边界

- 只识别用户明确给出的文件，不主动去翻其他目录。
- 不输出 API Key、不读取本地配置文件内容。
