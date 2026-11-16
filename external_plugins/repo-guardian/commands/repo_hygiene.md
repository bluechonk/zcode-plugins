---
description: 审计当前仓库的卫生状况（LF 与 .gitattributes、凭据是否入库、提交前自查、构建产物），并给出处置命令
argument-hint: "[仓库路径] [--json]"
skills: repo-hygiene
---

用 `repo-hygiene` 技能处理这个请求：

$ARGUMENTS

先跑审计脚本拿到全量结果，再按报告逐条处置：

    node "${ZCODE_PLUGIN_ROOT}/hooks/audit.mjs" $ARGUMENTS

注意：`git rm --cached`、`git filter-repo`、`git push --force` 都是改写性动作，
逐次经用户确认后才执行；误提交的凭据必须先轮换再清历史。
