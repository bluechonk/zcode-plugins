# dev-flow

探索式开发的收口流程：dev 分支当草稿纸积累 wip 提交，定期开「整理会」拆成干净的主题分支。

## 技能

`skills/dev-flow/SKILL.md` —— 完整流程（分类、cherry-pick 三铁律、重写提交信息、顺序 PR）。

**技能名保持英文 `dev-flow`**：ZCode 的技能名走 `Ays = /^[A-Za-z0-9][A-Za-z0-9_-]*$/` 校验，中文无效；`$dev-flow` 这类引用也依赖它。中文名做在**插件**层（marketplace 的 `displayName`）。

## 三个 hook：把「草稿落 dev」变成机器约束

光有技能不够——模型调了技能却不去建/切 dev 分支。三个 hook 补这段：

| 事件 | 做什么 |
| --- | --- |
| `SessionStart` | 报告分支状态：当前分支、本地有无 dev、是否在主干 |
| `UserPromptSubmit` | 识别探索式意图（整理提交 / 拆分支 / 累计起来 / 随便改改…），据此把会话标记为探索式，并提示建或切 dev |
| `PreToolUse` | 探索式会话里发生写入、但当前不在 dev → 提示一次 |

### 为什么 PreToolUse 要双闸

提示的前提是**两个条件同时成立**：本会话已被标记为探索式 **且** 当前分支不是 dev。

缺了「探索式」这一闸，任何一次普通改动都会被拦一句「请在 dev 分支」——那是纯噪音。缺了「分支」这一闸，切到 dev 之后还会反复提醒。

同会话只提示一次：提示是纠偏，不是每写一个文件就复读。

### 为什么意图判据这么窄

只认明确的词（`整理提交` / `拆分支` / `累计起来` / `攒多了` / `探索式` / `随便改改` …）。泛化成「任何改动」会让规则变成噪音，而 dev-flow 的价值恰恰在于**只在探索式会话里坚持 dev 分支**。

## 分支探测的边界

- 读不到分支（不在 git 仓库 / detached HEAD）时完全静默，不瞎提示
- 用 `GIT_CEILING_DIRECTORIES` 可阻止 git 向上找到父仓库（测试里就是这么隔离的）
- 只读，不改任何 git 状态

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `DEV_FLOW_DISABLE` | 设 `1` 整体关闭 |

## 安装

```sh
/plugin install dev-flow@bluechonk-plugins
```

或本机验证：

```sh
npm run sync:local
```

## 构建

`src/*.ts` → `hooks/<同名>.mjs`（`npm run build`）。`src/lib/**` 是共享代码。**不要手改 `hooks/*.mjs`**。

## 依赖

运行时零依赖，只调 `git`。
