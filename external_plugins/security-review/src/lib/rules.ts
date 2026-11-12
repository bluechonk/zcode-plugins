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
  /**
   * 正则之外的补充判据，拿到的是捕获组 1。
   *
   * 所以规则里要判的那个片段必须是第一个捕获组（其余分组写非捕获），
   * 否则传进来的是别的东西。有些判据是「像不像」的模糊判断（比如值看起来像不像凭据），
   * 写成正则会变成一坨不可读的交替；拿出来用代码表达，意图和可维护性都好得多。
   */
  verify?: (value: string) => boolean;
}

/** 常见凭据前缀：命中就基本可以确定是密钥，不必再看长度 */
const CREDENTIAL_PREFIX = /^(?:sk-|pk-|ghp_|gho_|ghs_|github_pat_|xox[baprs]-|AKIA|ASIA|AIza|ya29\.|eyJ)/u;

/**
 * 值看起来像不像凭据。
 *
 * 为什么要这一层：只看「键名 + 引号 + 长字符串」会把测试夹具里的占位值
 * （`apiKey: "modelmux-local"`）也算进来，那类值改起来毫无意义，只会磨损规则可信度。
 * 真凭据要么有已知前缀，要么够长、字符集够杂。
 */
function looksLikeCredential(value: string): boolean {
  if (value.includes("${")) return false; // 模板插值：算出来的值，不是字面量
  if (CREDENTIAL_PREFIX.test(value)) return true;
  if (value.length >= 20) return true;
  return value.length >= 16 && /[0-9]/u.test(value) && /[A-Za-z]/u.test(value);
}

export const RULES: readonly Rule[] = [
  {
    id: "hardcoded-secret",
    what: "疑似把密钥/口令写成字面量",
    fix: "改从环境变量或密钥管理读取，不要入库",
    // 键名用非捕获组：verify 拿到的是捕获组 1，必须正好是值本身
    pattern: /\b(?:api[_-]?key|secret|token|password|passwd|credential)\b\s*[:=]\s*["'`]([^"'`\s]{8,})["'`]/i,
    verify: looksLikeCredential,
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
    what: "SQL 语句用拼接或插值构造",
    fix: "改用参数化查询（占位符 + 绑定参数）",
    // 判据三条同时成立：字符串内容以 SQL 关键字开头 + 关键字大写 + 后面接了拼接或插值。
    //
    // 只认关键字会误报：日志文案里 "before first state update"、正则量词里的 update，
    // 都是普通词。只认拼接信号也会误报：`%s`、`${` 这些符号在正则与散文里到处都是。
    //
    // 要求「以关键字开头」是为了一步排掉「句子里提到 SQL 词」；
    // 要求「关键字大写」是自然的第二道闸——SQL 在代码里惯用大写，
    // 而踩过的误报全是小写的普通英文词（日志、文案）。代价是小写 SQL 不报，认了。
    //
    // 跨行拼接依然覆盖：首行就同时带关键字与加号。
    pattern:
      /["'`]\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE)\b[^"'`\n]{0,300}?(?:\$\{|["'`]\s*[+%])/,
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
    // 要求后面紧跟赋值号或 JSX 属性定界符（`={{...}}` 那种）；少了这个约束，
    // 规则自身定义文本里「名称后面紧跟正则结束符」会匹配自己。
    pattern: /\.innerHTML\s*=|dangerouslySetInnerHTML\s*[=:{]/,
  },
  {
    id: "weak-hash",
    what: "口令场景使用了弱哈希",
    fix: "口令用 bcrypt/scrypt/argon2；完整性校验用 sha256 起步",
    // 只在同行的口令上下文里报。md5 用于对齐上游签名是另一回事：那是协议要求的，
    // 换成 sha256 会直接导致对方验签失败，报了也只能「说明理由继续」，纯噪音。
    // 用 80 字符窗口而不是整行：同一行里常有多件事，放宽会把无关的 md5 也带进来。
    pattern:
      /(?:password|passwd|pwd|口令|密码)[^\n]{0,80}?createHash\s*\(\s*["'`](?:md5|sha1)["'`]|createHash\s*\(\s*["'`](?:md5|sha1)["'`][^\n]{0,80}?(?:password|passwd|pwd|口令|密码)/i,
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

