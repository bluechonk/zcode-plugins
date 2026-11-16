// 本文件由 scripts/build.mjs 从 external_plugins/security-review/src/baseline.ts 生成。
// 请修改源码并重跑 `npm run build`，不要直接编辑本文件。


// external_plugins/security-review/src/lib/hook.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      data += c;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}
async function readHookInput() {
  const raw = await readStdin();
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function emit(hookEventName, inner) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, ...inner } }));
}
function stateDir() {
  return process.env["ZCODE_PLUGIN_DATA"] ?? process.env["CLAUDE_PLUGIN_DATA"] ?? join(homedir(), ".zcode", "security-review");
}
function statePath(sessionId, name) {
  const safe = sessionId.replace(/[^A-Za-z0-9_.-]/g, "_") || "default";
  return join(stateDir(), `${safe}.${name}.json`);
}
function readState(sessionId, name, fallback) {
  try {
    const parsed = JSON.parse(readFileSync(statePath(sessionId, name), "utf8"));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}
function writeState(sessionId, name, value) {
  try {
    const p = statePath(sessionId, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(value), "utf8");
  } catch {
  }
}
function disabled() {
  return process.env["SECURITY_REVIEW_DISABLE"] === "1";
}

// external_plugins/security-review/src/lib/git.ts
import { spawnSync } from "node:child_process";
function git(cwd, args) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 2e4,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024
  });
  return { ok: r.status === 0, out: r.stdout ?? "" };
}
function isRepo(cwd) {
  return git(cwd, ["rev-parse", "--is-inside-work-tree"]).out.trim() === "true";
}
function captureBaseline(cwd) {
  const stash = git(cwd, ["stash", "create"]);
  if (stash.ok && stash.out.trim()) return stash.out.trim();
  const head = git(cwd, ["rev-parse", "HEAD"]);
  return head.ok && head.out.trim() ? head.out.trim() : null;
}

// external_plugins/security-review/src/lib/review.ts
import { DatabaseSync } from "node:sqlite";
import { homedir as homedir3 } from "node:os";
import { join as join3 } from "node:path";

// external_plugins/security-review/src/lib/providers.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
var PROVIDER_CONFIG = join2(homedir2(), ".zcode", "v2", "provider_config.json");
function providerEndpoint(providerId) {
  if (!providerId) return null;
  try {
    const parsed = JSON.parse(readFileSync2(PROVIDER_CONFIG, "utf8"));
    const rules = parsed.config?.providerConfigRules?.providerRules ?? [];
    const rule = rules.find((r) => r.providerId === providerId);
    const api = rule?.config?.api;
    const access = rule?.config?.access;
    if (!api?.baseUrl || api.type !== "openai-chat-completions") return null;
    if (access?.type !== "api-key" || !access.apiKey) return null;
    return { baseUrl: api.baseUrl.replace(/\/+$/, ""), apiKey: access.apiKey };
  } catch {
    return null;
  }
}

// external_plugins/security-review/src/lib/review.ts
var ZCODE_DB = join3(homedir3(), ".zcode", "cli", "db", "db.sqlite");
function resolveSessionConfig(sessionId) {
  let providerId = "";
  let modelId = "";
  try {
    const db = new DatabaseSync(ZCODE_DB, { readOnly: true });
    try {
      const last = db.prepare(
        `SELECT json_extract(data,'$.modelId') AS m, json_extract(data,'$.providerId') AS p
           FROM message
           WHERE session_id = ? AND json_extract(data,'$.semantics.kind') = 'assistant_response'
           ORDER BY sequence DESC LIMIT 1`
      ).get(sessionId);
      if (last?.m) {
        modelId = last.m;
        providerId = last.p ?? "";
      } else {
        const asked = db.prepare(
          `SELECT json_extract(data,'$.modelSelection.modelId') AS m,
                    json_extract(data,'$.modelSelection.providerId') AS p
             FROM message
             WHERE session_id = ? AND json_extract(data,'$.semantics.kind') = 'user_prompt'
             ORDER BY sequence DESC LIMIT 1`
        ).get(sessionId);
        modelId = asked?.m ?? "";
        providerId = asked?.p ?? "";
      }
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
  if (!modelId || !providerId) return null;
  const endpoint = providerEndpoint(providerId);
  if (!endpoint) return null;
  return { modelId, providerId, baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey };
}
var SYSTEM_PROMPT = [
  "\u4F60\u662F\u5B89\u5168\u5BA1\u67E5\u5458\uFF0C\u53EA\u505A\u53EA\u8BFB\u5206\u6790\u3002",
  "\u53EA\u62A5\u4F60\u5728\u8FD9\u6BB5 diff \u91CC\u80FD\u786E\u8BC1\u7684\u771F\u5B9E\u6F0F\u6D1E\uFF0C\u4E0D\u8981\u62A5\u98CE\u683C\u95EE\u9898\u3001\u4E0D\u8981\u62A5\u5360\u4F4D\u7B26/\u793A\u4F8B/\u6D4B\u8BD5\u5939\u5177\u3002",
  "\u53EA\u5BA1\u672C\u8F6E\u65B0\u5F15\u5165\u7684\u6539\u52A8\uFF1A\u65B0\u589E\u4E0E\u4FEE\u6539\u7684\u884C\u3002\u5220\u9664\u7684\u884C\u3001\u4EE5\u53CA diff \u91CC\u672A\u6539\u52A8\u7684\u4E0A\u4E0B\u6587\u884C\u90FD\u4E0D\u5728\u672C\u8F6E\u8303\u56F4\u3002",
  "\u62FF\u4E0D\u51C6\u5C31\u4E0D\u8981\u62A5\u2014\u2014\u8BEF\u62A5\u4F1A\u8BA9\u5F00\u53D1\u8005\u4ED8\u51FA\u6BD4\u6F0F\u62A5\u66F4\u9AD8\u7684\u4EE3\u4EF7\u3002",
  "",
  "\u53EA\u8F93\u51FA JSON\uFF0C\u4E0D\u8981\u4EFB\u4F55\u89E3\u91CA\u6587\u5B57\uFF1A",
  '{"findings":[{"severity":"high|medium|low","file":"\u8DEF\u5F84","issue":"\u95EE\u9898","fix":"\u5177\u4F53\u4FEE\u6CD5"}]}',
  '\u6CA1\u6709\u771F\u5B9E\u6F0F\u6D1E\u65F6\u8F93\u51FA {"findings":[]}\u3002'
].join("\n");

// external_plugins/security-review/src/baseline.ts
async function main() {
  if (disabled()) return;
  const input = await readHookInput();
  if (!input || input.hook_event_name !== "UserPromptSubmit") return;
  const cwd = input.cwd ?? process.cwd();
  if (!isRepo(cwd)) return;
  const sha = captureBaseline(cwd);
  if (!sha) return;
  const sessionId = input.session_id ?? "default";
  writeState(sessionId, "baseline", { sha, cwd, at: (/* @__PURE__ */ new Date()).toISOString() });
  writeState(sessionId, "stop", { blocks: 0 });
  const state = readState(sessionId, "config", {});
  if (state.configWarned) return;
  if (resolveSessionConfig(sessionId)) return;
  writeState(sessionId, "config", { configWarned: true });
  emit("UserPromptSubmit", {
    additionalContext: "[security-review] \u8BFB\u4E0D\u5230\u672C\u4F1A\u8BDD\u7684\u6A21\u578B\u914D\u7F6E\uFF0C\u672C\u8F6E\u7684\u5B89\u5168\u5BA1\u67E5\u5DF2\u8DF3\u8FC7\u3002\n\u9700\u8981\u4F1A\u8BDD\u5E93\u91CC\u6709 providerId + modelId\uFF0C\u4E14 ~/.zcode/v2/provider_config.json \u91CC\n\u914D\u597D\u8BE5 provider \u7684 baseUrl \u4E0E api-key\u3002\u5BA1\u67E5\u4E0D\u53D1\u8BF7\u6C42\u6BD4\u53D1\u9519\u8BF7\u6C42\u597D\uFF0C\u4F46\u8981\u77E5\u9053\u5B83\u6CA1\u8DD1\u3002"
  });
}
main().then(() => process.exit(0)).catch(() => process.exit(0));
