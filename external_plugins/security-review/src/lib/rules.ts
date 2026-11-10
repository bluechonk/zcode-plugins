/**
 * security-review 的正则规则表。
 *
 * 独立成模块是为了能被单测与语料扫描直接引用：import 整个 post-tool 会执行 main()
 * 并读 stdin，拿不到规则表。
 *
 * 宁缺毋滥——误报会持续吃掉模型上下文，比漏报更伤，所以每条都要求
 * 只看新增文本就能判断，拿不准的不写进来。
 */

export interface Rule {
  id: string;
  /** 一句话说清命中了什么 */
  what: string;
  /** 怎么修 */
  fix: string;
  pattern: RegExp;
}

export const RULES: readonly Rule[] = [
  {
    id: "hardcoded-secret",
    what: "疑似把密钥/口令写成字面量",
    fix: "改从环境变量或密钥管理读取，不要入库",
    // 前瞻排掉含 `${` 的模板插值：`${prefix}${token}` 这类是算出来的值，
    // 长度与字符集都符合「像字面量」，但它跟硬编码无关。
    pattern:
      /\b(api[_-]?key|secret|token|password|passwd|credential)\b\s*[:=]\s*["'`](?![^"'`\s]*\$\{)[^"'`\s]{12,}["'`]/i,
  },
  {
    id: "aws-access-key",
    what: "疑似 AWS Access Key ID",
    fix: "撤销该密钥并改用临时凭据",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    id: "private-key",
    what: "私钥内容被写进代码",
    fix: "私钥走密钥管理服务，绝不能入库",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    id: "sql-concat",
    what: "SQL 语句用字符串拼接构造",
    fix: "改用参数化查询（占位符 + 绑定参数）",
    // 拼接的判据是「加号紧邻字符串字面量」，不能只看「加号后面跟标识符」：
    // 正则字面量里的量词恰好满足后者——`update\s+set` 的 `+s` 就是加号紧跟字母，
    // 实测把代码里的正则与规则自身的定义都误报了一遍。
    //
    // 前面要求 SQL 自己的两段式结构（SELECT…FROM / UPDATE…SET），而不是单个关键字：
    // 日志文案里的 "before first state update" 只是英文单词，配合同一条消息里的
    // 模板插值就凑成了命中。单个关键字在自然语言里出现得太频繁。
    // 负向后顾再挡方法调用：摘要函数的 `.update(...)` 链式调用与 SQL 无关。
    pattern:
      /(?<!\.)\b(?:SELECT\b[^\n;]{0,200}?\bFROM\b|INSERT\s+INTO\b|UPDATE\b[^\n;]{0,200}?\bSET\b|DELETE\s+FROM\b)[^\n;]{0,200}?(?:\+\s*["'`]|["'`]\s*\+\s*[A-Za-z_$]|\$\{|%s|\.format\s*\()/i,
  },
  {
    id: "command-injection",
    what: "shell 命令用拼接/插值构造",
    fix: "改用数组形式传参（execFile/spawn 的 args），不要过 shell",
    pattern: /\b(exec|execSync|system|popen)\s*\(\s*[^)]*(\+\s*[A-Za-z_$]|\$\{|f")/,
  },
  {
    id: "path-from-request",
    what: "文件路径直接取自请求参数",
    fix: "做白名单或规范化后校验前缀，拒绝 ../ 与绝对路径",
    pattern:
      /\b(readFile|writeFile|createReadStream|createWriteStream|sendFile|unlink)\s*\([^)]*\b(req|request|ctx|params|query|body)\b/,
  },
  {
    id: "dynamic-code",
    what: "动态执行代码",
    fix: "改成显式分支或解析器，不要 eval / new Function",
    pattern: /\beval\s*\(|\bnew\s+Function\s*\(/,
  },
  {
    id: "tls-verify-off",
    what: "关闭了 TLS 证书校验",
    fix: "改回校验；确需自签证书就把该证书加进信任链",
    pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0/,
  },
  {
    id: "xss-html",
    what: "把未转义内容塞进 HTML",
    fix: "改用文本节点，或先经白名单净化",
    // 要求后面跟赋值或 JSX 属性定界符：真实用法是 `dangerouslySetInnerHTML={{...}}`，
    // 不加这个约束时规则自身的定义文本（结尾是 `dangerouslySetInnerHTML/`）会匹配自己。
    pattern: /\.innerHTML\s*=|dangerouslySetInnerHTML\s*[=:{]/,
  },
  {
    id: "weak-hash",
    what: "口令/签名场景使用了弱哈希",
    fix: "口令用 bcrypt/scrypt/argon2；完整性校验用 sha256 起步",
    pattern: /createHash\s*\(\s*["'`](md5|sha1)["'`]/i,
  },
  {
    id: "insecure-random",
    what: "疑似用 Math.random 生成安全相关值",
    fix: "改用 crypto.randomUUID / randomBytes",
    pattern: /\b(secret|token|salt|nonce|session[_-]?id|api[_-]?key)\w*\s*[:=]\s*[^;\n]*Math\.random\s*\(/i,
  },
  {
    id: "cors-wildcard",
    what: "CORS 允许任意来源",
    fix: "改为白名单来源，或明确说明为何需要放开",
    pattern: /(Access-Control-Allow-Origin["'`]?\s*[:,]\s*["'`]\*|origin\s*:\s*["'`]\*["'`])/i,
  },
  {
    id: "jwt-weak-secret",
    what: "疑似把 JWT 密钥写成字面量",
    fix: "密钥从环境变量读取，至少 32 字节，不要用示例值",
    pattern: /\b(jwt[_-]?secret|jwt[_-]?key|JWT_SECRET|JWT_KEY)\b\s*[:=]\s*["'`][A-Za-z0-9_\-.]{8,}["'`]/i,
  },
  {
    id: "hardcoded-iv-salt",
    what: "疑似硬编码 IV 或盐",
    fix: "IV 每次随机生成并随密文存储；盐用 crypto.randomBytes 生成",
    pattern: /\b(iv|salt|nonce)\b\s*[:=]\s*["'`][A-Za-z0-9+/=]{8,}["'`]/i,
  },
  {
    id: "child-process-concat",
    what: "child_process 用字符串拼接构造命令",
    fix: "改用 execFile / spawn 的数组参数，避免 shell 注入",
    pattern: /\bexec\s*\(\s*[`"][^`"]*(?:\$\{|\+|"+)/,
  },
  {
    id: "unsafe-deserialize",
    what: "不安全的反序列化",
    fix: "改用 JSON 或带 schema 校验的解析；yaml 用 SafeLoader",
    pattern: /\byaml\.load\s*\(|\bpickle\.load\b|\bunserialize\s*\(/,
  },
];

