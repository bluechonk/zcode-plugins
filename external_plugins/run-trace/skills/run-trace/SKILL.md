---
name: run-trace
description: Keep long-running commands observable - stream output to the terminal while writing a line-by-line log to disk. Use when running training, benchmarks, builds, test suites, migrations or any command that may take minutes, may hang, or whose failure must be traceable afterwards.
---

# 长跑命令的可观测性

一条长跑命令必须同时满足三件事，缺一件就会出「跑着跑着没动静、死了不知道为什么」：

1. **人看得见**：输出实时到终端，不是攒到最后一次性出现；
2. **盘上有**：边跑边写文件，进程被杀时已写的内容还在；
3. **退出码是真的**：命令失败就是失败，不被管道下游覆盖成成功。

## 用 trace 运行器跑

```bash
node "<插件根>/hooks/trace.mjs" [--log <路径>] [--timeout <秒>] [--echo-rate <行/秒>] -- <命令…>
```

本文件位于 `<插件根>/skills/run-trace/SKILL.md`，把 `<插件根>` 替换成上面两级目录。
不写 `--log` 时默认落 `.tmp/runs/<时间戳>.log`。

```bash
# 训练 / 基准：默认落点
node "$ROOT/hooks/trace.mjs" -- python train.py --epochs 100

# 需要自己指定日志名
node "$ROOT/hooks/trace.mjs" --log .tmp/runs/bench.log -- python bench.py --limit 2048

# 加超时：卡死自动收尾，不会无限挂着
node "$ROOT/hooks/trace.mjs" --timeout 600 -- npm run build

# 输出刷屏：终端每秒只回显 20 行，日志仍全量
node "$ROOT/hooks/trace.mjs" --echo-rate 20 -- python train.py

# PowerShell 脚本同样适用
node "$ROOT/hooks/trace.mjs" -- pwsh -NoProfile -File ./scripts/bench.ps1
```

它做的事：

| 行为 | 为什么 shell 拼不出来 |
| --- | --- |
| 终端回显 | 保持命令本来的样子，人不用看前缀 |
| 每行追加写日志并带时间戳 | `\| tee` 没法给每行盖时间；时间戳是判断「卡住还是慢」的唯一依据 |
| 透传真实退出码 | `cmd \| grep` 的 `$?` 是 grep 的，上游崩了也显示 0 |
| 结尾写 `# RESULT: success/failure/timeout` | 日志里没有这行，就说明进程是被杀的、没跑完 |
| stderr 行标 `E` | 事后区分正常输出与报错 |
| 超时杀整棵进程树 | 只杀 shell 会留下孤儿进程继续跑，还会占着管道让收尾永远等不到 |
| 回显可节流、日志不节流 | 刷屏时人只需看到抽样，事后追溯必须全量 |

跨 shell：Windows 上自动用 Git Bash（而不是 cmd.exe），`.venv/Scripts/python.exe` 这类 POSIX 路径、`&&` 链、单引号都与调用方一致。

## 日志怎么读

```
# run-trace 2026-11-24T11:25:30.415Z
# command: python train.py --epochs 100
# cwd: /path/to/project
# ---
[19:25:30.501] epoch 1 loss=2.31
[19:25:31.502] epoch 2 loss=1.87
[19:25:32.503] E CUDA out of memory
# ---
# [19:25:32.509] END exit=1 用时 2.1s
# RESULT: failure
```

- **没有 `# RESULT:`** → 进程被强杀或机器断电，日志里的最后一行就是现场。
- **时间戳间隔突然变大** → 卡在那一步了，不是没跑。
- **`E` 开头的行** → stderr，报错与警告都在这。

## 什么时候不必用

- 秒级命令：`git status`、`ls`、`node -v`。落盘反而是负担。
- 只看最后几行且失败代价低：`npm test` 跑完看尾部就行。
- 已经在用 `tee` 且不在乎逐行时间戳。

## 脚本侧的配合

Python 在管道下默认块缓冲，`print` 了也看不到——这是「明明有输出却没显示」的另一半原因。

```python
print(f"epoch {i} loss={loss}", flush=True)   # 首选
# 或文件头
sys.stdout.reconfigure(line_buffering=True)
# 或运行时
python -u train.py
```

## 边界

- trace 只接管输出与日志，不改命令语义、不注入环境变量。
- 日志落 `.tmp/`，按仓库规范不入库、不删除。
- 它不负责重试、不负责解析输出——那是调用方的事。
