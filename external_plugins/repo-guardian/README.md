# repo-guardian

仓库健康检查、本机规则执行与注释规范核对。把 `AGENTS.md` 里「机器可判定」的那部分规则从常驻上下文下沉到 hook：按需检测、按需注入，而不是一股脑塞进每一轮。

「编码 / 仓库卫生」四条（LF 与 `.gitattributes`、凭据不入库、提交前自查、产物不入库）现在由本插件承载，落地方式见下文。

## 为什么需要它

`AGENTS.md` 自己写着：新增规则前先问「它是否每次会话都需要、且模型无法自行发现？否则下沉到技能或项目文档」。

但规则其实分三类：

| 类别 | 例子 | 该去哪 |
| --- | --- | --- |
| 模型无法自行发现，且每次都需要 | 人格、优先级 | 留在 `AGENTS.md` |
| 模型无法自行发现，但**机器可判定** | 有没有 CI、有没有 .gitattributes、注释里有没有署名 | 本插件 |
| 模型能自行发现 | 检索优先 GitHub | 技能或文档 |

第二类现在占着常驻上下文，却只在特定仓库状态下才有意义。

## 五个 hook

| 事件 | 检测什么 | 命中后 |
| --- | --- | --- |
| `SessionStart` | CI 缺失、`.gitattributes` 不达标、README 非中文、凭据入库、产物入库、CRLF 入库 | 注入提示（附最小 workflow 骨架与处置命令） |
| `SessionStart` | 代码与注释规范中**机器判不了**的部分 | 注入规范卡 |
| `SessionStart` | 仓库卫生四条规则的动作顺序 | 注入卫生卡 |
| `PreToolUse` | `powershell.exe` / `cmd.exe` / `pip install` / `poetry` / `conda` | deny |
| `PreToolUse` | `git commit` | 注入提交前自查清单 |
| `PreToolUse` | `git add` 命中凭据或产物路径、`git add -f`、`push --force`、`filter-repo` / BFG | 注入提示 |
| `PreToolUse` | 写入凭据形态文件、写入内容含 CRLF、`.gitattributes` 缺硬指标行 | 注入提示 |
| `PreToolUse` | 内容含 emoji、`.ps1` 写到 `.tmp/` 之外 | 注入提示 |
| `PostToolUse` | 代码与注释规范中**机器可判定**的部分 | 注入逐行提示 |
| `UserPromptSubmit` | CI 与卫生欠账（每 10 轮重申一次，首轮必说） | 注入提示 |

仓库健康项都干净时 `SessionStart` 只出两张规范卡，不出健康段。

## 仓库卫生四条规则怎么落地

这四条原本常驻 `AGENTS.md` 的「编码 / 仓库卫生」。它们不是同一种规则，所以拆成三种承载方式——
只靠提示词等于没做，只靠 hook 又覆盖不了动作顺序。

| 规则 | 机器可判定的部分 | 落点 |
| --- | --- | --- |
| 1 文本一律 LF，必须有 `.gitattributes` 且含 `* text=auto eol=lf` | 文件是否存在、是否含该行、`git ls-files --eol` 里有没有 `i/crlf` | `SessionStart` 健康检查 + `PreToolUse` 写入含 CRLF 时提示 |
| 2 凭据不入库 | 路径形态（`.env`、`*.pem`/`*.key`/`*.p12`、`id_rsa`、`service-account*.json` 等）；是否已入库、是否被 `.gitignore` 覆盖 | `SessionStart` 盘点 + `PreToolUse` 在 `git add` 与写入当下提示 |
| 3 提交前自查 `git status` / `git diff` / 敏感词扫描 | 「现在要提交」这个时机可判，内容是否含凭据交给 security-review | `PreToolUse` 命中 `git commit` 时注入清单；改写历史与 force push 单独提醒「先轮换再清除」 |
| 4 构建产物与运行时数据不入库 | `git ls-files` 命中 `dist/`、`node_modules/` 等；`.gitignore` 是否覆盖必需条目 | `SessionStart` 盘点 + `PreToolUse` 命中 `git add` 产物路径时提示 |

判不了的部分——「这次是不是真的该补 .gitattributes」「这条欠账要不要现在还」——留在 `SessionStart` 的卫生卡里靠自觉。

### 全量审计入口

`hooks/audit.mjs` 是这四条的一次性盘点，也是 skill 与斜杠命令的执行体：

```sh
node hooks/audit.mjs            # 中文报表，退出码 1 表示有未通过项
node hooks/audit.mjs --json     # 机器可读
node hooks/audit.mjs <仓库路径>
```

hook 只在动作当下说话，存量仓库的欠账（已入库的凭据、CRLF、产物）要靠这个才数得清。

### 技能与命令

- `skills/repo-hygiene/SKILL.md`：四条规则的处置手册，含 `git add --renormalize`、
  `git rm --cached`、`git filter-repo` 的具体顺序与为什么不能颠倒。
- `/repo_hygiene`：调 `hooks/audit.mjs` 出报告。

改写历史与 force push 是破坏性动作，插件只给命令与顺序，不代劳执行——必须逐次经用户确认。

### 与 security-review 的分工

本插件管**文件与仓库状态**：这个路径是不是凭据形态、它有没有被 `.gitignore` 盖住、
有没有跟着 `git add` 进暂存区。内容里是不是真的写了密钥由 security-review 的
`hardcoded-secret` 规则判——两边不重复报同一件事。

## 代码与注释规范为什么拆两层

这一节的规则原本常驻 `AGENTS.md`，现在由本插件承载。两类要求性质完全不同：

| 要求 | 机器能判吗 | 落在哪 |
| --- | --- | --- |
| 注释必须中文、不留署名与修订记录、不留注释掉的代码、不留无理由的 `@ts-ignore`、不写死绝对路径 | 能，纯词法 | `PostToolUse` 逐行核对 |
| 写 why 不写 what、不复述代码、注释随改动更新、别用 `any` 图省事、运行时日志用英文 | 不能，要理解语义或调用链 | `SessionStart` 规范卡 |

只做后者等于没做（模型照样不看），只做前者会漏掉最核心的「写 why 不写 what」。两层都留，才构成对文档规则的等价替代。

`PostToolUse` 只在写入之后提示、不阻断：这些是风格问题，deny 会逼模型为了过检把内容改坏。提示里写明了「误报就直接说明理由继续」。

### 九条检测项

| 规则 | 判据 |
| --- | --- |
| `non-chinese` | 整块注释没有任何中文（汉字、中文标点、全角字符，含 `\uXXXX` 转义） |
| `author-trail` | `@author` / `Author:` / `作者：` / `审批：` / `reviewed by` |
| `revision-record` | 注释**开头**是「修订/更新/变更记录（历史、日志）」，或日期紧邻改动动词 |
| `commented-code` | 纯 ASCII 行且以代码关键字开头、含 `=>`、像赋值、或以 `;` 结尾带运算符 |
| `todo-format` | 注释以 `TODO` / `FIXME` 开头但不符合 `TODO(名字): 描述` |
| `deprecated-no-replacement` | 有 `@deprecated` 但整块没有替代方案或移除条件 |
| `ts-ignore-no-reason` | `@ts-ignore` / `@ts-expect-error` 同行没有理由 |
| `empty-catch` | `catch` 块内既没有代码也没有说明注释 |
| `hardcoded-path` | 字符串字面量里写死盘符 / `Desktop/` / `/Users/` / `/home/` / `AppData/` |

### 一条刻意不做的规则

**「运行时日志一律英文」不做检测。** 试过，实测不可判定：日志调用与面向用户的 CLI 报表写法完全一样，`console.log("守护PID: …")` 既是运行时输出也可能是状态报表，词法分不开。按目录白名单（`scripts`/`bin`/`cli`）区分也不行——modelmux 的 `daemon.ts`、`headless.ts` 都在 `src` 下却全是给人看的中文报表，44 处命中里 43 处是这类误报。

要做对需要「这个输出流向终端用户还是日志文件」的信息，得读整个项目的调用链，超出「只看新增文本」的边界。所以这条留在规范卡里靠自觉——宁可漏，不可误报。测试里有一条用例专门锁住「不实现」这个决定。

### 误报是怎么压到 0 的

误报比漏报更伤——它会持续吃掉上下文，还诱导模型为消提示改坏代码。实测踩过并修掉的坑：

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| `hooks/*.mjs` 全量命中 | 构建产物的分隔注释是纯英文路径 | 认 banner，跳过生成物 |
| 帮助文本里的网址被当注释 | `//` 出现在 `https://` 里 | `//` 前面是冒号就不算注释 |
| `/^https?:\/\//` 被当注释 | 转义斜杠 + 闭合斜杠拼出 `//` | `//` 前面是反斜杠也不算 |
| 中文块注释里的命令行、JSON 被判非中文 | 逐行判定，那些行没有汉字 | 改整块判定；中文标点也算中文证据 |
| 连续 `//` 里的用法示例被判非中文 | 行注释没有段落概念 | 相邻同种行注释归并为一块 |
| `catch(e){}` 出现在 HTML 字符串里 | 扫代码层规则时没剥字符串 | 剥注释与字符串后再扫 |
| 合规的空 catch 被判违规 | 剥注释后「块内有说明」的证据也没了 | 找块用剥离文本，判注释回原文 |
| `// version 4` 之类短注释 | 阈值过松 | 少于三个英文词不判 |
| 「变更说明」被判修订记录 | 名词表收了「说明」 | 名词收紧为记录/历史/日志，且必须位于注释开头 |
| 所有 URL 被判硬编码路径 | `https://` 里 `s:/` 满足「字母 + 冒号 + 斜杠」 | 先排协议再判路径 |
| `Loomy\|Desktop\|Electron` 被判路径 | `Desktop` 按单词边界匹配 | 要求 `Desktop` 后面紧跟路径分隔符 |

实测结果（按 `git ls-files` 扫全仓）：

| 语料 | 注释规则 | 代码规则 |
| --- | --- | --- |
| 本仓库 43 个源文件 | 0 | 0 |
| modelmux 379 个源文件 | 1（`// version 4`，真实违规） | 0 |

## 为什么 deny 只给硬规则

`powershell.exe`、`pip install` 这类是「用了就明确违规」的命令，重写代价低，deny 不会误伤正常工作。

emoji、`.ps1` 落点、注释规范与**仓库卫生的全部四条**都只提示不阻断。「这次先不补 .gitattributes」是合理决定，硬拦只会逼模型为了过检把仓库改坏；提示里一律写明「误报直接说明理由继续」。

## 安装

```sh
/plugin install repo-guardian@bluechonk-plugins
```

或本机验证：

```sh
npm run sync:local
```

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `REPO_GUARDIAN_DISABLE` | 设 `1` 整体关闭 |

## 检测细节

**CI 判定**：用 `git rev-parse --show-toplevel` 定位仓库根（monorepo 场景下 cwd 可能只是子目录），再看 `.github/workflows/` 下有没有 `.yml`/`.yaml`。

**禁用命令**：只匹配命令位置——行首，或 `&&` / `||` / `;` / `|` 之后。所以 `echo "pip install is bad"` 或注释里的 `pip install` 不会误伤（实测验证过）。

**README 中文占比**：中文字符数除以非空白字符总数，低于 15% 提示。阈值取 15% 而非更高：技术 README 天然含大量代码块、命令与英文标识符，本仓库自己的 README 中文占比只有 28%。

**emoji**：用 Unicode 属性 `\p{Extended_Pictographic}` 判定，覆盖变体选择器与组合序列。

**注释扫描**：逐字符走并维护字符串状态，而不是按行正则。没有这一步，`url("http://x")` 里的 `//`、`"a # b"` 里的 `#` 都会被当成注释开始。模板字符串跨行合法，反引号状态跨换行保留。

**跳过范围**：`node_modules/`、`dist/`、`build/`、`.tmp/`、压缩产物、锁文件、二进制扩展名，以及带构建 banner 的产物。`.tmp/` 是诊断脚本落点，按全局规则「不算正式产物」，不套代码规范。

**CRLF 判定**：取 `git ls-files --eol` 的**索引侧**（`i/crlf`），不看工作树侧。工作树里出现 CRLF 可能只是本机 `core.autocrlf` 的结果，而规则管的是「仓库内文本文件一律 LF」。`i/-text` 是二进制，不参与判定。`-z` 记录里 `attr/` 字段本身可以含空格（`attr/text=auto eol=lf`），所以字段边界只能按制表符切，按空白 split 会错取路径。

**凭据形态**：只收「一看就是凭据」的名字——`.env`、`.env.local`/`.prod` 之类、`*.pem`/`*.key`/`*.p12`/`*.pfx`/`*.jks`/`*.keystore`、`id_rsa`/`id_ed2519`、`.htpasswd`、`credentials`、`service-account*.json`、`secrets*.yaml`。不收 `config.json` 这类宽泛名字：误报率太高，报一次就要模型花一轮去解释。`.env.example` / `.env.sample` / `.env.template` / `.env.dist` 是模板，明确排除。

**「未覆盖的凭据文件」**用 `git ls-files --others --exclude-standard` 取：被 `.gitignore` 盖住的不会出现在结果里，于是「出现在这里」等价于「没被忽略、随时会被顺手提交」。已入库的凭据与裸奔的凭据分开报——前者要清历史并轮换，后者只要补忽略规则，处置代价差一个量级。

**git 命令意图**：按 `&&` / `||` / `;` / `|` / 换行拆段，再在每段里找 `git` 的位置取子命令，所以 `cd x && git commit -m y` 与 `git add . && git commit` 都能认出来。`git add` 的目标只取不以 `-` 开头的 token；`-A` / `.` 这类没有显式路径的动作交给全量审计覆盖。

**重申的节流起点**：`lastPromptedTurn` 初值取 0，让首轮就说一次。曾经取 `-EVERY_N_TURNS`，于是 turn 从 -9 起算，`turn !== 1` 这道门槛永远过不了，第一次重申要拖到第 10 轮——测试里锁住了「首轮必说」。
