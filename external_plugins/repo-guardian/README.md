# repo-guardian

仓库健康检查与本机规则执行。把 `AGENTS.md` 里「机器可判定」的那部分规则从常驻上下文下沉到 hook：按需检测、按需注入，而不是一股脑塞进每一轮。

## 为什么需要它

`AGENTS.md` 自己写着：新增规则前先问「它是否每次会话都需要、且模型无法自行发现？否则下沉到技能或项目文档」。

但规则其实分三类：

| 类别 | 例子 | 该去哪 |
| --- | --- | --- |
| 模型无法自行发现，且每次都需要 | 人格、优先级 | 留在 `AGENTS.md` |
| 模型无法自行发现，但**机器可判定** | 有没有 CI、有没有 .gitattributes、有没有用 powershell.exe | 本插件 |
| 模型能自行发现 | 检索优先 GitHub | 技能或文档 |

第二类现在占着常驻上下文，却只在特定仓库状态下才有意义。

## 三个 hook

| 事件 | 检测什么 | 命中后 |
| --- | --- | --- |
| `SessionStart` | CI 缺失、`.gitattributes` 缺失、README 非中文 | 注入提示（附最小 workflow 骨架） |
| `PreToolUse` | `powershell.exe` / `cmd.exe` / `pip install` / `poetry` / `conda` | deny |
| `PreToolUse` | 内容含 emoji、`.ps1` 写到 `.tmp/` 之外 | 注入提示 |
| `UserPromptSubmit` | CI 缺失（每 10 轮重申一次） | 注入提示 |

三项仓库健康检查都干净时 `SessionStart` 完全静默，不打扰。

## 为什么 deny 只给硬规则

`powershell.exe`、`pip install` 这类是「用了就明确违规」的命令，重写代价低，deny 不会误伤正常工作。

emoji 与 `.ps1` 落点容易误报（测试夹具里的 emoji 字符串、业务代码里的脚本），只提示不阻断，并在提示里写明「误报直接说明理由继续」。

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

**README 中文占比**：中文字符数除以非空白字符总数，低于 30% 提示。

**emoji**：用 Unicode 属性 `\p{Extended_Pictographic}` 判定，覆盖变体选择器与组合序列。
