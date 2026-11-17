---
description: 关闭 security-review 每轮的收尾模型审查，省下每轮的模型调用（正则模式层一直生效）
---

执行这一条命令关闭收尾模型审查：

    node "${ZCODE_PLUGIN_ROOT}/hooks/toggle.mjs" off

把脚本输出的状态原样回给用户，不要再做别的。
