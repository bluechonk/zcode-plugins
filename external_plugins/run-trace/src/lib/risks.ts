/**
 * 命令形态检测：识别「输出会被吞掉、过程无法追溯」的写法。
 *
 * 判据来自实测（2026-11-24，本机 python 3.11 + Git Bash）：
 *   - `python x.py` 直连逐行实时；
 *   - `python x.py | grep …` 在非 tty 下按块缓冲，4 行输出在第 8 秒才一次性出现；
 *   - `python x.py 2>&1 | grep …` 崩溃时退出码被 grep 覆盖成 0，stderr 全丢。
 *
 * 所以问题不在「用了 grep」，而在两件事叠加：
 *   1. 管道下游把输出攒着，人看不到进度；
 *   2. 没有落盘，进程一死现场就没了。
 * 这里只判形态，不判语义——拿不准的一律不报。
 */

export interface RiskHit {
  /** 规则 id：同一会话内按 id + 命令去重 */
  rule: string;
  /** 给模型看的一句话说明 */
  message: string;
}

/**
 * 长跑型命令：这些通常几十秒到几小时，输出必须能看见、能落盘。
 *
 * 覆盖三类 shell —— 用户可能用 Git Bash、也可能用 pwsh：
 *   - POSIX 侧：python / node / npm / pytest / make …
 *   - PowerShell 侧：pwsh -File、Invoke-* 脚本、dotnet、Start-Process
 *   - 两者共用的：docker、git clone（大仓库）、pip/uv install
 */
const LONG_RUNNING = /(?:^|[;&|]\s*|\bthen\s+|\bdo\s+)(?:\.\/)?(?:[\w./\\-]*[\\/])?(?:python3?(?:\.exe)?|py\.exe|node|npm|npx|pnpm|yarn|bun|deno|pytest|uv\s+(?:run|sync|pip)|pip3?|poetry|cargo|go\s+(?:run|test|build|generate)|dotnet|java|mvn|gradlew?|gradle|docker\s+(?:build|run|compose)|make|cmake|ninja|tsc|vite|webpack|next|nuxt|ollama|nvidia-smi\s+-l|git\s+clone|git\s+submodule|(?:pwsh|powershell)(?:\.exe)?\s+(?:-\w+\s+)*(?:-File|-Command))\b/iu;

/** 过滤型下游：非 tty 时按块缓冲，实时性最差 */
const FILTERING_TAIL = /\|\s*(?:grep|egrep|fgrep|rg|ag|ack|awk|sed|head|tail|sort|uniq|jq|cut|wc)\b/iu;

/** 会把退出码换成下游自己的：管道最后一段是过滤器时，上游失败无法从 $? 看出 */
const MASKS_EXIT_CODE = /\|\s*(?:grep|egrep|fgrep|rg|ag|ack|awk|sed|head|tail|sort|uniq|jq|cut|wc)\b[^|]*$/iu;

/** 已经做了持久化或流控的写法，不再提示 */
const HAS_TEE = /\|\s*tee\b/iu;
const HAS_LINE_BUFFERED = /--line-buffered\b/iu;
const HAS_UNBUFFERED_PY = /(?:-u\b|PYTHONUNBUFFERED=1)/u;
/**
 * 重定向到文件才算落盘。
 *
 * `(?!&)` 不能省：`2>&1` 是把 stderr 并进 stdout，不产生任何文件——
 * 少了这个否定前瞻，`2>&1 | grep` 会被当成「已落盘」而漏掉最关键的提示
 * （实测踩过：该命中的 no-trace-long-run 没触发）。
 */
const HAS_REDIRECT = />{1,2}\s*(?!&)\S/u;

/** 短命令：一眼能看完，落盘反而是负担 */
const looksShortLived = (command: string): boolean => {
  const trimmed = command.trim();
  if (trimmed.length > 400) return false;
  // 纯查询类：git status / ls / cat / echo / which / node -v …
  return /^(?:git\s+(?:status|log|diff|show|branch|remote|rev-parse)|ls|cat|head|tail|echo|printf|which|where|node\s+-v|npm\s+-v|python3?\s+--version|pwd|cd|mkdir|rm|cp|mv|touch)\b/u.test(
    trimmed
  );
};

/**
 * 判一条 Bash 命令是否会「跑着跑着看不见、死了没现场」。
 *
 * 返回空数组表示没问题。可能同时命中多条——它们指向不同的补救动作。
 */
export function traceRisks(command: string): RiskHit[] {
  if (!command.trim()) return [];
  if (looksShortLived(command)) return [];

  const hits: RiskHit[] = [];
  const longRunning = LONG_RUNNING.test(command);
  const hasFilter = FILTERING_TAIL.test(command);
  const persisted = HAS_TEE.test(command) || HAS_REDIRECT.test(command);

  // 长跑 + 过滤 + 没落盘：这就是「输出都没有」的原始配方
  if (longRunning && hasFilter && !persisted) {
    hits.push({
      rule: "no-trace-long-run",
      message:
        "长跑命令的输出经过过滤器且没有落盘：非 tty 下 grep 会按块缓冲，" +
        "中途你可能一行都看不到；进程若崩掉，现场也随管道消失。\n" +
        "   改法：`… 2>&1 | tee .tmp/run.log | grep --line-buffered <模式>`" +
        "（tee 先落盘，--line-buffered 保住实时性），或直接 `… 2>&1 | tee .tmp/run.log` 不筛。",
    });
  }

  // 长跑但完全没落盘：进度看得见，但崩了没有现场
  if (longRunning && !persisted && !hasFilter) {
    hits.push({
      rule: "no-log-long-run",
      message:
        "长跑命令没有把输出落到文件：能看到滚动，但进程一崩、会话一断，现场就没了。\n" +
        "   改法：加 `2>&1 | tee .tmp/<名字>.log`；需要筛选时在后面再接 `| grep --line-buffered <模式>`。",
    });
  }

  // 退出码被下游覆盖：崩溃会被当成成功
  if (MASKS_EXIT_CODE.test(command) && !HAS_LINE_BUFFERED.test(command)) {
    hits.push({
      rule: "masked-exit-code",
      message:
        "管道最后一段是过滤器，`$?` 会变成过滤器的退出码——上游崩了也可能显示成功（实测：崩溃的 python 经 `| grep` 后退出码从 3 变成 0）。\n" +
        "   改法：`set -o pipefail` 后接管道，或先 `… > .tmp/run.log 2>&1` 再单独检查 `$?`。",
    });
  }

  // 筛掉 stderr：报错看不见
  if (/\b2>\s*\/dev\/null\b/u.test(command) && longRunning) {
    hits.push({
      rule: "stderr-discarded",
      message:
        "长跑命令丢弃了 stderr（`2> /dev/null`）：报错与警告全部消失，失败时无从追查。\n" +
        "   改法：`2>&1 | tee .tmp/run.log`，把 stderr 也留下。",
    });
  }

  return hits;
}

/**
 * 输出侧提醒：脚本自身没 flush，进度会攒在缓冲区。
 *
 * 这是「明明 print 了却看不到」的另一半原因——python 在管道下默认块缓冲，
 * 只有 flush=True 或 -u 才逐行。写入时提示比运行时救火便宜得多。
 */
export function missingFlush(text: string, filePath: string): RiskHit | null {
  const p = filePath.replace(/\\/gu, "/").toLowerCase();
  if (!/\.(?:py|pyi)$/u.test(p)) return null;
  const prints = text.match(/\bprint\s*\(/gu);
  // 两处就够：循环里一条进度 + 结尾一条结果，正是最需要实时的形态
  if (!prints || prints.length < 2) return null;
  if (/\bflush\s*=\s*True\b/u.test(text) || /sys\.stdout\.reconfigure\s*\(/u.test(text)) return null;
  // 进度型脚本才会在意实时性：有循环或耗时调用
  if (!/(?:for\s+\w+\s+in\b|while\s+|time\.sleep|\.encode\s*\(|requests\.|subprocess\.)/u.test(text)) return null;
  return {
    rule: "py-no-flush",
    message:
      `这个 Python 脚本有多处 print（${prints.length} 处）但没开 flush：` +
      "被管道接走时 python 默认块缓冲，进度会攒到结束才一次性出现，等于看不到。\n" +
      "   改法：`print(..., flush=True)`，或文件头 `sys.stdout.reconfigure(line_buffering=True)`，" +
      "或运行时 `python -u`。",
  };
}
