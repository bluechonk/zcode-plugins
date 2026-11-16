---
description: Recognize text in a local PDF, Word, PowerPoint or image with DeepSeek's official OCR API. Pass the file path as the argument.
argument-hint: "<file> [--purpose text_recognition|rich_layout_recognition] [--format json|text|markdown]"
skills: deepseek-ocr
---

Use the `deepseek-ocr` skill for this request:

$ARGUMENTS

Run the recognition through the DeepSeek CLI and return the recognized text. Use `--format json` when the per-page structure matters (for example to keep page numbers), and `--format text` when the user just wants the words. If it fails, report the HTTP status and the CLI error message instead of retrying blindly.
