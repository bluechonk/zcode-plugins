# todo-guard

待办纪律核对：确保任务拆解与进度更新真的用上了 `TodoWrite`，且重写清单前先做过 `TodoRead`。只提示不阻断，**不产生任何文件**。

## 为什么需要它

ZCode 原生已有待办机制（`TodoWrite` / `TodoRead` / `/goal`），缺的不是功能，是**核对**：

| 缺口 | 谁来核 |
| --- | --- |
| 多步任务没拆解就闷头做 | 原生只在「10 轮没写待办且距上次提醒 10 轮」时提醒；本插件补「提问看着像多步任务」与「本轮调了一堆工具却没待办」两个时机 |
| 重写清单时凭记忆，把没想起来的条目静默抹掉 | 原生不查；本插件查 |
| 目标（`/goal`）与待办各走各的，收尾不一致 | 原生不查；本插件查 |

## 先读后写：本插件唯一不可替代的核对

`TodoWrite` 是**整份替换**，不是增量补丁。模型若没先 `TodoRead` 就凭记忆重写，库里那些它没想起来的条目会被静默抹掉 —— 没有任何报错，事后也查不出来。

判据（`src/lib/todo-discipline.ts` 的 `droppedOpenTodos`）：

```
库里的旧清单（权威）减去本次要写的新清单
得到「消失的条目」，只看未完成的
若本轮没有 TodoRead，且消失的条目非空 → 提示
```

三条边界都收敛过：

- **只算未完成的**：已完成条目从清单里消失是正常收尾，不算丢失
- **先读过了就不报**：读过再写，抹掉是有意为之
- **不做模糊匹配**：把「看起来像同一件事」的条目当成保留会让判据不可预测，宁可漏报

## 四个 hook

| 事件 | 时机 | 做什么 |
| --- | --- | --- |
| `SessionStart` | 会话开始 | 注入待办纪律卡（4 条，一次性） |
| `UserPromptSubmit` | 提问像多步任务且本轮没写过待办 | 注入拆解模板，每会话上限 3 次 |
| `PreToolUse` | `TodoWrite` 之前 | 先读后写核对 |
| `PreToolUse` | `ExitPlanMode` 提交计划 | 标题太通用时提示带上主题 |
| `Stop` | 收尾 | 目标 / 待办一致性核对；本轮干了不少活却从没拆过待办时提示一次 |

`ExitPlanMode` 那条针对的是原生 plan：ZCode 侧边栏用**每份计划的第一个标题**当显示名，而 plan 模式规范要求正文以 `## Context` 开头，于是多次规划后侧边栏全显示成「Context」，分不清哪份是哪份。

## 不做的事

**不拦任何工具。** 本插件曾接管 plan 模式（`deny` 掉 `EnterPlanMode`），现在改为辅助原生 plan —— 只提示，不阻断。`EnterPlanMode` 放行。

**不产生任何文件。** 上一版会在项目根写 `task_plan.md` / `progress.md` / `findings.md`，已全部删除。理由：这三个文件与 ZCode 原生的待办机制重复，模型既要维护文件又要维护 todo 表，反而更容易脱节；计划本来就该由原生机制持有，插件只该核对它有没有被用起来。

**不重复原生提醒。** ZCode 自带「10 轮未写待办」的注入，本插件不照抄一遍；只补原生不查的两项（先读后写、目标与待办一致性）与两个不同时机（提问触发的拆解建议、本轮活动触发的未拆解提示）。

## 安装

```sh
/plugin install todo-guard@bluechonk-plugins
```

或本机验证：

```sh
npm run sync:local
```

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `TODO_GUARD_DISABLE` | 设 `1` 整体关闭 |
| `TODO_GUARD_DB` | 指向会话库副本，供测试用；默认 `~/.zcode/cli/db/db.sqlite` |

## 数据来源

全部**只读**访问 `~/.zcode/cli/db/db.sqlite`：

| 表 | 取什么 |
| --- | --- |
| `todo` | 权威待办清单（`session_id` 用会话原样 id，无格式转换） |
| `session_target` | `/goal` 的状态与目标（`status` ∈ active/paused/complete） |
| `part` | 本轮的每次工具调用（`$.tool` 是工具名） |
| `message` | 用户提问的时刻（`$.semantics.kind === 'user_prompt'`），作为「本轮」的基准 |

后两张表相减就得到「本轮用过哪些工具」，这是判「本轮有没有先 TodoRead」的依据。

## 构建

源码是 TypeScript，产物由构建生成并入库：

```sh
npm install
npm run build              # 写盘
npm run build -- --check   # 只比对，不一致则非零退出
```

`src/*.ts` 顶层文件各产出一个 `hooks/<同名>.mjs`；`src/lib/**` 是共享代码。**不要手改 `hooks/*.mjs`**。

## 依赖

Node >= 22（`node:sqlite`）。运行时零依赖。
