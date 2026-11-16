---
name: repo-hygiene
description: Audit and fix repository hygiene - LF line endings and .gitattributes, credentials that must never be committed, the pre-commit self-check, and build artifacts or runtime data that must stay out of the repo. Use before committing, when inheriting an existing repository, or when a secret has been committed by accident.
---

# 仓库卫生

四条规则的落地手册。插件的 hook 会在动作当下提示，这个技能负责「现在要动手修」时的完整流程与命令。

## 先跑审计

一次全量盘点，比逐条猜快：

```bash
node "<本文件所在目录>/../../hooks/audit.mjs"
```

本文件位于 `<插件根>/skills/repo-hygiene/SKILL.md`，把上面的路径替换成实际解析出的位置。
加 `--json` 得到机器可读结果；退出码 1 表示有未通过项。

## 规则 1：文本一律 LF，仓库必须有 .gitattributes

`.gitattributes` 至少要有这一行，只有别的属性不算补齐：

```
* text=auto eol=lf
```

存量仓库一次性归一（不要专门开一次「只改换行符」的提交，跟着下次改动走）：

```bash
git add --renormalize .
git ls-files --eol | grep '^i/crlf'   # 归一后应该没有输出
```

## 规则 2：凭据一律不入库

禁止入库的形态：apikey、accesskey、secret key、token、密码、私钥、证书、数据库连接串，
以及含真实凭据的 `.env` / `.pem` / `.key` / `.p12` / `.keystore` / `id_rsa` / `service-account*.json`。

正确做法是敏感内容走环境变量或密钥管理服务，并把文件写进 `.gitignore`。
模板文件（`.env.example`）可以入库，但值必须是占位符。

已经入库了，按这个顺序处理，**顺序不能颠倒**：

```bash
# 1. 先轮换。历史里的密钥一旦被拉到，删除只是补救，不是撤销
# 2. 从当前提交里移除，但保留本地文件
git rm --cached .env
# 3. 从全部历史里清除
git filter-repo --path .env --invert-paths
# 4. 覆盖远端历史
git push --force --all && git push --force --tags
```

`git filter-repo` 不可用时用 BFG（`bfg --delete-files .env`）。
只 `git rm` 不改写历史 = 没处理完。

## 规则 3：提交前自查

每次 `git commit` 前四步，一步都别省：

```bash
git status              # 有没有该忽略却没忽略的文件、临时产物有没有跟进来
git diff --cached       # 逐条看过要提交的内容
git diff --cached | grep -inE 'api[_-]?key|secret|token|password|BEGIN .*PRIVATE KEY|AKIA|://[^ ]+:[^ ]+@'
```

最后一条命中就停下：先确认是不是真实凭据，是就走规则 2，不要先提交再修。

再核对一条逻辑原则：**一个 commit = 一件完整的逻辑**。同一件事的多次返工合成一条，
不同的事即便只差一行也不得混提。

## 规则 4：构建产物与运行时数据不入库

`dist/`、`node_modules/`、运行时数据目录一律不入库。已经入库的先移出索引，再补忽略：

```bash
git rm -r --cached dist node_modules
printf 'node_modules/\ndist/\n' >> .gitignore
```

判据是「能不能从源码重新生成」——能生成的就不该在仓库里。

## 边界

- 审计与修复都只读加提示，插件本身不替你改仓库状态：`git rm --cached`、
  `filter-repo`、`push --force` 都是改写性动作，必须逐次经用户确认。
- 真实凭据的值不进对话、不进日志、不进提交信息。
- 误报直接说明理由继续，不必为了消提示把仓库改坏。
