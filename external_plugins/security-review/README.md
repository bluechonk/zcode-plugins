# security-review

文件写入后立刻做一次正则安全模式检查，命中就在模型上下文里给出提示。

对应 `security-guidance`（Anthropic）里**唯一在 ZCode 中真正生效的那一层**——纯正则、无依赖、无凭据需求。原版的 LLM 审查依赖 `ANTHROPIC_API_KEY` 或 OAuth token，没有凭据时整层空转。

## 检测什么

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

规则集刻意精简：**误报会持续吃掉模型上下文，比漏报更伤**。每条规则都必须能在只看到新增文本的前提下判断。规则定义在 `src/index.ts` 的 `RULES` 常量里。

## 行为约定

- 只审**本次新增的文本**（`Edit` 的 `new_string`、`Write` 的 `content`、`MultiEdit` 逐条），不重审整个文件
- 同一会话内，同一条规则命中的同一个文件**只提示一次**
- 单次最多提示 5 条；超过 200 KB 的写入不扫
- 提示走 `additionalContext`（PostToolUse），**不阻断任何操作**
- 任何异常（入参非 JSON、状态文件损坏、落盘失败）一律静默放行

状态文件落在插件数据目录，文件名取会话 id。可用 `ZCODE_PLUGIN_DATA` 覆写位置。

## 已知误报

它的规则表本身就是扫描目标。任何**描述或检测**这些模式的代码（安全工具、测试用例、文档）都会被判命中——例如本插件的 `src/index.ts` 里那两条规则的字面量，就会被 `security-guidance` 报出来。

提示里已写明：误报直接说明理由继续，不必为了消警告改坏代码。

## 构建

源码是 TypeScript，产物 `hooks/security-review.mjs` 由构建生成并入库：

```sh
npm install
npm run build          # 写盘
npm run build -- --check   # 只比对，产物与源码不一致则非零退出
```

**不要手改 `hooks/security-review.mjs`**，改 `src/index.ts` 后重跑构建。CI 会跑 `--check` 挡住漂移。

## 依赖

Node >= 22。运行时零依赖。
