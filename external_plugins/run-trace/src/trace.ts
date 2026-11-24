/**
 * 运行追踪器：把一条命令跑起来，同时做三件事——
 *   1. 实时把 stdout / stderr 打到终端（人能看见进度）；
 *   2. 逐行追加写入日志文件（边跑边写，不是跑完才写）；
 *   3. 记录退出码、耗时、信号，并在结尾写入一条明确的结束标记。
 *
 * 为什么必须自己起进程、而不是让人在 shell 里拼 `| tee`：
 *   - `| tee` 之后 `$?` 变成 tee 的退出码，上游崩了也显示成功；
 *   - `| grep` 在非 tty 下按块缓冲，进度会攒到结束才出现；
 *   - shell 里没法给每一行盖上时间戳，事后分不清是卡住了还是跑得慢。
 * 这三件事 shell 拼不出来，只能由一个真正的父进程接管。
 *
 * 用法：node hooks/trace.mjs [--log <路径>] [--timeout <秒>] [--echo-rate <行/秒>] -- <命令…>
 * 退出码：透传被跑命令的退出码；超时为 124；参数错误为 2。
 *
 * 输出量大的命令加 `--echo-rate 20`：终端只回显抽样，日志仍是全量。
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

interface Options {
  logPath: string;
  timeoutSec: number;
  command: string;
  /** 终端回显的最大行数/秒；0 表示不限（默认，适合大多数场景） */
  echoRate: number;
}

const DEFAULT_TIMEOUT_SEC = 0;
/** 默认不限速：多数命令输出量不大，限速反而会让人以为卡住了 */
const DEFAULT_ECHO_RATE = 0;

function parseArgs(argv: string[]): Options | null {
  let logPath = "";
  let timeoutSec = DEFAULT_TIMEOUT_SEC;
  let echoRate = DEFAULT_ECHO_RATE;
  let i = 0;

  for (; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--") {
      i += 1;
      break;
    }
    if (arg === "--log") {
      logPath = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg === "--timeout") {
      const raw = Number(argv[i + 1]);
      if (!Number.isFinite(raw) || raw < 0) return null;
      timeoutSec = raw;
      i += 1;
      continue;
    }
    if (arg === "--echo-rate") {
      const raw = Number(argv[i + 1]);
      if (!Number.isFinite(raw) || raw < 0) return null;
      echoRate = raw;
      i += 1;
      continue;
    }
    // 没写 -- 就遇到命令：从这里开始都算命令
    break;
  }

  const command = argv.slice(i).join(" ").trim();
  if (!command) return null;

  if (!logPath) {
    const stamp = new Date().toISOString().replace(/[:.]/gu, "-").replace("T", "_").slice(0, 19);
    logPath = join(".tmp", "runs", `${stamp}.log`);
  }

  return { logPath: resolve(logPath), timeoutSec, command, echoRate };
}

/**
 * 选哪个 shell 来跑命令。
 *
 * 不能让 Node 在 Windows 上默认落到 cmd.exe：调用方（Git Bash）里合法的写法
 * ——`.venv/Scripts/python.exe`、`&&` 链、单引号——在 cmd 下直接报「不是内部或
 * 外部命令」，实测踩过：同一条命令在 Git Bash 里能跑，经 trace 就失败。
 * 有 bash 就用 bash，退出码与命令语义才和调用方一致。
 */
function shellFor(command: string): string | boolean {
  if (process.platform !== "win32") return true;
  // SHELL 由 Git Bash 自己设置，指到的就是当前这一份 bash，比猜安装路径可靠
  const fromEnv = process.env["SHELL"];
  if (fromEnv && /bash\.exe$/iu.test(fromEnv) && existsSync(fromEnv)) return fromEnv;
  const fromGit = join(process.env["ProgramFiles"] ?? "C:\\Program Files", "Git", "bin", "bash.exe");
  if (existsSync(fromGit)) return fromGit;
  // 没有 Git Bash 时退回系统默认 shell，并让调用方知道行为可能不同
  process.stderr.write(`[run-trace] 未找到 Git Bash，改用系统默认 shell；含 POSIX 路径的命令可能失败。\n`);
  return true;
}

/**
 * 杀整棵进程树，不只是那个 shell。
 *
 * `child.kill()` 只杀直接子进程（在 Windows 上就是 cmd/bash 壳），真正的负载
 * ——python / node / 训练进程——会变成孤儿继续跑，并且仍然占着 stdout 管道，
 * 于是 `close` 事件永不触发，超时保护形同虚设（实测踩过：TIMEOUT 已写进日志，
 * 但既没有 END 也没有 RESULT，进程还挂在后台）。
 */
function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      // /T 杀子树，/F 强制；cmd 的 taskkill 是 Windows 上唯一可靠的做法
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
      // detached 让子进程自成进程组，负 pid 即整组
      process.kill(-child.pid, signal);
    }
  } catch {
    // 进程已经退出（ESRCH）是正常情况，无需处理
  }
}

/**
 * 终端回显节流器。
 *
 * rate 为 0 表示不限速，原样全量回显（默认）。限速时按秒给配额：
 * 配额内的行照常回显，超出的丢弃并计数，下一秒开头补一句省略了多少行。
 * 丢弃的只是**给人看的实时流**，日志侧一行不少。
 */
function createEchoThrottle(ratePerSecond: number): {
  push: (out: NodeJS.WriteStream, line: string) => void;
  /** 收尾时把最后一段的省略计数补上：单秒内刷完的输出否则永远等不到下一窗口 */
  flush: () => void;
} {
  if (ratePerSecond <= 0) {
    return {
      push: (out, line) => {
        out.write(`${line}\n`);
      },
      flush: () => {},
    };
  }

  let windowStart = Date.now();
  let used = 0;
  let dropped = 0;
  let lastOut: NodeJS.WriteStream = process.stdout;

  const reportDropped = (): void => {
    if (dropped > 0) lastOut.write(`… 已省略 ${dropped} 行（完整内容见日志）\n`);
    dropped = 0;
  };

  return {
    push: (out, line) => {
      lastOut = out;
      const now = Date.now();
      if (now - windowStart >= 1000) {
        reportDropped();
        windowStart = now;
        used = 0;
      }
      if (used < ratePerSecond) {
        out.write(`${line}\n`);
        used += 1;
      } else {
        dropped += 1;
      }
    },
    flush: reportDropped,
  };
}

function ts(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) {
    process.stderr.write(
      "用法：node trace.mjs [--log <路径>] [--timeout <秒>] -- <命令…>\n" +
        "例：  node trace.mjs --log .tmp/runs/bench.log -- python bench.py --limit 100\n"
    );
    process.exitCode = 2;
    return;
  }

  mkdirSync(dirname(opts.logPath), { recursive: true });
  const log = createWriteStream(opts.logPath, { flags: "a", encoding: "utf8" });

  /** 写一行到日志并立刻刷盘：进程被强杀时，已写的内容必须还在 */
  const writeLog = (line: string): void => {
    log.write(`${line}\n`);
  };

  const startedAt = Date.now();
  writeLog(`# run-trace ${new Date().toISOString()}`);
  writeLog(`# command: ${opts.command}`);
  writeLog(`# cwd: ${process.cwd()}`);
  if (opts.timeoutSec > 0) writeLog(`# timeout: ${opts.timeoutSec}s`);
  writeLog("# ---");

  const child = spawn(opts.command, {
    shell: shellFor(opts.command),
    // 关键：不做管道重定向，父子各自持有真实句柄，输出才能逐行到达
    stdio: ["inherit", "pipe", "pipe"],
    windowsHide: true,
    // POSIX 下建独立进程组，超时时整组一起杀（见 killTree）
    detached: process.platform !== "win32",
  });

  let killedByTimeout = false;
  const timer =
    opts.timeoutSec > 0
      ? setTimeout(() => {
          killedByTimeout = true;
          writeLog(`# [${ts()}] TIMEOUT 超过 ${opts.timeoutSec}s，终止进程`);
          killTree(child, "SIGTERM");
          // 给 5 秒收尾，仍不退就硬杀
          setTimeout(() => killTree(child, "SIGKILL"), 5000);
        }, opts.timeoutSec * 1000)
      : null;

  /**
   * 终端回显节流器。
   *
   * 为什么要节流：训练/构建每秒能刷几百行，全量回显会把人的终端冲垮，
   * 也会让 Agent 的上下文被同一行噪声塞满。但**日志一律全量**——
   * 压缩的只是「给人看的实时流」，不是「事后追溯的现场」。
   *
   * 节流方式：按秒给配额，超出就丢弃回显但记账，下一秒补一句「已省略 N 行」。
   * 这样人知道它在跑，也知道自己看到的是抽样的。
   */
  const echo = createEchoThrottle(opts.echoRate);

  /** 逐行转发：按 \n 切，半行先攒着，避免把一行拆成两条日志 */
  const pump = (
    stream: NodeJS.ReadableStream | null,
    tag: "out" | "err",
    buffer: { rest: string }
  ): void => {
    if (!stream) return;
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      buffer.rest += chunk;
      const parts = buffer.rest.split("\n");
      buffer.rest = parts.pop() ?? "";
      for (const line of parts) {
        // 日志全量、逐行、带时间戳：这是事后追溯的唯一凭证，不能省
        writeLog(`[${ts()}] ${tag === "err" ? "E " : ""}${line}`);
        // 终端回显按配额：保持命令原本的样子，只是低频时抽样
        echo.push(tag === "err" ? process.stderr : process.stdout, line);
      }
    });
  };

  const outBuf = { rest: "" };
  const errBuf = { rest: "" };
  pump(child.stdout, "out", outBuf);
  pump(child.stderr, "err", errBuf);

  const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
    if (timer) clearTimeout(timer);
    // 节流的省略计数要在收尾时补报，否则最后一秒被丢弃的行没人知道
    echo.flush();
    // 收尾：把没换行的半行也落下
    if (outBuf.rest) writeLog(`[${ts()}] ${outBuf.rest}`);
    if (errBuf.rest) writeLog(`[${ts()}] E ${errBuf.rest}`);

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    const status = code === null ? `signal=${signal ?? "unknown"}` : `exit=${code}`;
    writeLog("# ---");
    writeLog(`# [${ts()}] END ${status} 用时 ${seconds}s`);

    // 结尾这条标记就是「跑完了」的凭证：日志里没有它，就说明进程是被杀的
    if (killedByTimeout) {
      writeLog("# RESULT: timeout");
    } else if (code === 0) {
      writeLog("# RESULT: success");
    } else {
      writeLog("# RESULT: failure");
    }

    log.end(() => {
      process.stderr.write(`\n[run-trace] 日志：${opts.logPath}（${status}，用时 ${seconds}s）\n`);
      process.exitCode = killedByTimeout ? 124 : (code ?? 1);
    });
  };

  child.on("error", (error) => {
    writeLog(`# [${ts()}] SPAWN-ERROR ${error.message}`);
    writeLog("# RESULT: failure");
    log.end(() => {
      process.stderr.write(`[run-trace] 无法启动命令：${error.message}\n`);
      process.exitCode = 1;
    });
  });

  child.on("close", (code, signal) => finish(code, signal));

  // 终端断开时也别丢现场：把已写的内容刷出去
  const onSignal = (sig: NodeJS.Signals): void => {
    writeLog(`# [${ts()}] 收到 ${sig}，转发给子进程`);
    child.kill(sig);
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
}

main();
