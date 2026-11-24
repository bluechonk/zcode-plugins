// 本文件由 scripts/build.mjs 从 external_plugins/run-trace/src/trace.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/run-trace/src/trace.ts
import { spawn } from "node:child_process";
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
var DEFAULT_TIMEOUT_SEC = 0;
var DEFAULT_ECHO_RATE = 0;
function parseArgs(argv) {
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
    break;
  }
  const command = argv.slice(i).join(" ").trim();
  if (!command) return null;
  if (!logPath) {
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/gu, "-").replace("T", "_").slice(0, 19);
    logPath = join(".tmp", "runs", `${stamp}.log`);
  }
  return { logPath: resolve(logPath), timeoutSec, command, echoRate };
}
function shellFor(command) {
  if (process.platform !== "win32") return true;
  const fromEnv = process.env["SHELL"];
  if (fromEnv && /bash\.exe$/iu.test(fromEnv) && existsSync(fromEnv)) return fromEnv;
  const fromGit = join(process.env["ProgramFiles"] ?? "C:\\Program Files", "Git", "bin", "bash.exe");
  if (existsSync(fromGit)) return fromGit;
  process.stderr.write(`[run-trace] \u672A\u627E\u5230 Git Bash\uFF0C\u6539\u7528\u7CFB\u7EDF\u9ED8\u8BA4 shell\uFF1B\u542B POSIX \u8DEF\u5F84\u7684\u547D\u4EE4\u53EF\u80FD\u5931\u8D25\u3002
`);
  return true;
}
function killTree(child, signal) {
  if (child.pid === void 0) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
  }
}
function createEchoThrottle(ratePerSecond) {
  if (ratePerSecond <= 0) {
    return {
      push: (out, line) => {
        out.write(`${line}
`);
      },
      flush: () => {
      }
    };
  }
  let windowStart = Date.now();
  let used = 0;
  let dropped = 0;
  let lastOut = process.stdout;
  const reportDropped = () => {
    if (dropped > 0) lastOut.write(`\u2026 \u5DF2\u7701\u7565 ${dropped} \u884C\uFF08\u5B8C\u6574\u5185\u5BB9\u89C1\u65E5\u5FD7\uFF09
`);
    dropped = 0;
  };
  return {
    push: (out, line) => {
      lastOut = out;
      const now = Date.now();
      if (now - windowStart >= 1e3) {
        reportDropped();
        windowStart = now;
        used = 0;
      }
      if (used < ratePerSecond) {
        out.write(`${line}
`);
        used += 1;
      } else {
        dropped += 1;
      }
    },
    flush: reportDropped
  };
}
function ts() {
  const d = /* @__PURE__ */ new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) {
    process.stderr.write(
      "\u7528\u6CD5\uFF1Anode trace.mjs [--log <\u8DEF\u5F84>] [--timeout <\u79D2>] -- <\u547D\u4EE4\u2026>\n\u4F8B\uFF1A  node trace.mjs --log .tmp/runs/bench.log -- python bench.py --limit 100\n"
    );
    process.exitCode = 2;
    return;
  }
  try {
    mkdirSync(dirname(opts.logPath), { recursive: true });
  } catch (error) {
    process.stderr.write(`[run-trace] \u65E0\u6CD5\u521B\u5EFA\u65E5\u5FD7\u76EE\u5F55 ${dirname(opts.logPath)}\uFF1A${error.message}
`);
    process.exitCode = 2;
    return;
  }
  let log;
  try {
    if (existsSync(opts.logPath) && statSync(opts.logPath).isDirectory()) {
      throw new Error("\u8BE5\u8DEF\u5F84\u662F\u4E00\u4E2A\u76EE\u5F55\uFF0C\u9700\u8981\u6587\u4EF6\u8DEF\u5F84");
    }
    const probe = openSync(opts.logPath, "a");
    closeSync(probe);
    log = createWriteStream(opts.logPath, { flags: "a", encoding: "utf8" });
    log.on("error", (error) => {
      process.stderr.write(`[run-trace] \u65E5\u5FD7\u5199\u5165\u5931\u8D25\uFF1A${error.message}
`);
    });
  } catch (error) {
    process.stderr.write(`[run-trace] \u65E0\u6CD5\u5199\u5165\u65E5\u5FD7 ${opts.logPath}\uFF1A${error.message}
`);
    process.exitCode = 2;
    return;
  }
  const writeLog = (line) => {
    log.write(`${line}
`);
  };
  const startedAt = Date.now();
  writeLog(`# run-trace ${(/* @__PURE__ */ new Date()).toISOString()}`);
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
    detached: process.platform !== "win32"
  });
  let killedByTimeout = false;
  const timer = opts.timeoutSec > 0 ? setTimeout(() => {
    killedByTimeout = true;
    writeLog(`# [${ts()}] TIMEOUT \u8D85\u8FC7 ${opts.timeoutSec}s\uFF0C\u7EC8\u6B62\u8FDB\u7A0B`);
    killTree(child, "SIGTERM");
    setTimeout(() => killTree(child, "SIGKILL"), 5e3);
  }, opts.timeoutSec * 1e3) : null;
  const echo = createEchoThrottle(opts.echoRate);
  const pump = (stream, tag, buffer) => {
    if (!stream) return;
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffer.rest += chunk;
      const parts = buffer.rest.split("\n");
      buffer.rest = parts.pop() ?? "";
      for (const line of parts) {
        writeLog(`[${ts()}] ${tag === "err" ? "E " : ""}${line}`);
        echo.push(tag === "err" ? process.stderr : process.stdout, line);
      }
    });
  };
  const outBuf = { rest: "" };
  const errBuf = { rest: "" };
  pump(child.stdout, "out", outBuf);
  pump(child.stderr, "err", errBuf);
  const PIPE_GRACE_MS = 500;
  let finished = false;
  let graceTimer = null;
  const finishOnce = (code, signal) => {
    if (finished) return;
    finished = true;
    if (graceTimer) clearTimeout(graceTimer);
    finish(code, signal);
  };
  child.on("exit", (code, signal) => {
    graceTimer = setTimeout(() => {
      child.stdout?.destroy();
      child.stderr?.destroy();
      finishOnce(code, signal);
    }, PIPE_GRACE_MS);
  });
  const finish = (code, signal) => {
    if (timer) clearTimeout(timer);
    echo.flush();
    if (outBuf.rest) writeLog(`[${ts()}] ${outBuf.rest}`);
    if (errBuf.rest) writeLog(`[${ts()}] E ${errBuf.rest}`);
    const seconds = ((Date.now() - startedAt) / 1e3).toFixed(1);
    const status = code === null ? `signal=${signal ?? "unknown"}` : `exit=${code}`;
    writeLog("# ---");
    writeLog(`# [${ts()}] END ${status} \u7528\u65F6 ${seconds}s`);
    if (killedByTimeout) {
      writeLog("# RESULT: timeout");
    } else if (code === 0) {
      writeLog("# RESULT: success");
    } else {
      writeLog("# RESULT: failure");
    }
    log.end(() => {
      process.stderr.write(`
[run-trace] \u65E5\u5FD7\uFF1A${opts.logPath}\uFF08${status}\uFF0C\u7528\u65F6 ${seconds}s\uFF09
`);
      process.exitCode = killedByTimeout ? 124 : code ?? 1;
    });
  };
  child.on("error", (error) => {
    writeLog(`# [${ts()}] SPAWN-ERROR ${error.message}`);
    writeLog("# RESULT: failure");
    log.end(() => {
      process.stderr.write(`[run-trace] \u65E0\u6CD5\u542F\u52A8\u547D\u4EE4\uFF1A${error.message}
`);
      process.exitCode = 1;
    });
  });
  child.on("close", (code, signal) => finishOnce(code, signal));
  const onSignal = (sig) => {
    writeLog(`# [${ts()}] \u6536\u5230 ${sig}\uFF0C\u8F6C\u53D1\u7ED9\u5B50\u8FDB\u7A0B`);
    child.kill(sig);
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
}
main();
