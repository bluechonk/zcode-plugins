---
description: Turn text into a speech audio file with DeepSeek's official TTS API. Pass the text and an output path.
argument-hint: "<text> --out <path> [--voice stella|tide] [--tts-format wav|pcm]"
skills: deepseek-tts
---

Use the `deepseek-tts` skill for this request:

$ARGUMENTS

Run the synthesis through the DeepSeek CLI and report the saved file path and size to the user. The model cannot play audio, so the path is the deliverable. If it fails, report the HTTP status and the CLI error message instead of retrying blindly.
