# security-review

两层安全审查：

1. **模式层**（`PostToolUse`）：文件写入后立刻用正则扫一遍新增内容，命中即提示。
2. **收尾审查**（`Stop`）：一轮结束时用 **ZCode 当前在跑的模型**审查本轮 git diff，有问题就把模型叫回来处理。

对照 `security-guidance`（Anthropic）：它的模式层在 ZCode 里本来就能跑，但 LLM 审查依赖 `ANTHROPIC_API_KEY` 或 OAuth token，无凭据时整层空转。本插件把审查后端换成本机网关，无需任何凭据。

## 模式层检测什么

| 规则 | 命中特征 |
| --- | --- |
| `hardcoded-secret` | 密钥/口令类变量直接赋字面量 |
| `aws-access-key` | `AKIA...` 形态的 Access Key ID |
| `private-key` | PEM 私钥内容进入代码 |
| `sql-concat` | SQL 用字符串拼接或插值构造 |
| `command-injection` | `exec`/`system` 等用拼接或插值构造命令 |
| `path-from-request` | 文件路径直接取自请求参数 |
| `dynamic-code` | `eval` / `new Function` |
| `tls-verify-off` | 关闭 TLS 证书校验 |
| `xss-html` | `innerHTML` / `dangerouslySetInnerHTML` |
| `weak-hash` | 口令或签名场景使用 md5/sha1 |
| `insecure-random` | 安全相关值用 `Math.random` 生成 |
| `cors-wildcard` | CORS 允许任意来源 |

规则集刻意精简：**误报会持续吃掉模型上下文，比漏报更伤**。规则在 `src/post-tool.ts` 的 `RULES`。

## 收尾审查怎么定范围

`UserPromptSubmit` 时抓一份工作树快照（`git stash create`，无改动则退回 `HEAD`）作为基线；`Stop` 时 `git diff <基线>` 得到本轮改动。

不用 `HEAD` 做基线的原因：会话中途可能提交，用 HEAD 会把已提交的改动重复送审，或者把上一轮的问题反复报出来。

范围还有三条限制：

- 只审源码类扩展名（`.ts/.js/.mjs/.py/.go/...`），文档与锁文件跳过
- 未跟踪的新文件按「整份新增」补进 diff（新文件是漏洞高发处），上限 20 个、每个 400 行
- diff 总计上限 60 KB，超出截断

## 模型怎么定

`Stop` 时 hook 入参里**没有模型信息**（ZCode 只注入 `session_id` / `cwd` / `tool_*` / `agent_type`），所以按会话 id 回查 ZCode 的会话库，取该会话最近一次实际使用的模型。

显式指定优先：设 `SECURITY_REVIEW_MODEL` 就不再查库。

**两个字段都读**：部分模型把结论写在 `reasoning_content`、`content` 是空串，只读 `content` 会永远得到「没问题」——这是静默失效，最难发现。

## 终止性保证

审查会阻塞收尾（`decision: "block"`）要求模型处理，写不严就是死循环。三条约束叠起来：

1. **判定阻塞之前先推进基线**——模型若什么都不改，下次 `Stop` 的 diff 为空，直接放行
2. 每轮最多阻塞 `SECURITY_REVIEW_MAX_BLOCKS` 次（默认 2），计数在 `UserPromptSubmit` 时清零
3. 网关报错、模型解析不到、输出不是 JSON 一律放行

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SECURITY_REVIEW_DISABLE` | — | 设 `1` 整体关闭 |
| `SECURITY_REVIEW_BASE_URL` | `http://127.0.0.1:4412/v1` | 审查用的 OpenAI 兼容端点 |
| `SECURITY_REVIEW_MODEL` | 查会话库 | 显式指定审查模型 |
| `SECURITY_REVIEW_MAX_BLOCKS` | `2` | 每轮最多阻塞次数 |
| `SECURITY_REVIEW_MAX_DIFF_BYTES` | `60000` | 送审 diff 上限 |
| `SECURITY_REVIEW_TIMEOUT_MS` | `120000` | 审查请求超时 |

## 已知误报

规则表本身就是扫描目标。任何**描述或检测**这些模式的代码（安全工具、测试夹具、文档）都会被判命中——本插件自己的 `src/post-tool.ts` 就带着 `new Function`、`dangerouslySetInnerHTML` 这类规则字面量。

提示里已写明：误报直接说明理由继续，不必为了消警告改坏代码。

## 构建

源码是 TypeScript，产物由构建生成并入库：

```sh
npm install
npm run build              # 写盘
npm run build -- --check   # 只比对，不一致则非零退出
```

`src/*.ts` 顶层文件各产出一个 `hooks/<同名>.mjs`；`src/lib/**` 是共享代码，被打进各入口。**不要手改 `hooks/*.mjs`**。CI 会跑 `--check` 挡住漂移。

## 依赖

Node >= 22（`node:sqlite`）。运行时零依赖，审查走本机网关、不需要任何 API Key。
