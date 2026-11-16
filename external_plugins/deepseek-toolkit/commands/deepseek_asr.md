---
description: Transcribe a local audio file with DeepSeek's official ASR API. Pass the audio path as the argument.
argument-hint: "<file> [--format json|text|markdown]"
skills: deepseek-asr
---

Use the `deepseek-asr` skill for this request:

$ARGUMENTS

Run the transcription through the DeepSeek CLI and return the transcript. Use `--format json` when the duration or request id is needed, `--format text` when only the words matter. If it fails, report the HTTP status and the CLI error message instead of retrying blindly.
