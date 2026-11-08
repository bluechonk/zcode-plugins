# zcode-plugins

bluechonk 的 ZCode 插件市场。仓库根即市场根，`marketplace.json` 是市场清单。

## 仓库结构

```text
marketplace.json                       市场清单（catalog name: bluechonk-plugins）
external_plugins/
  deepseek-web-search/                 社区插件（官方约定的伙伴/社区插件位置）
    .zcode-plugin/plugin.json          插件清单
    cli/                               零依赖 CLI（search / fetch / doctor）
    commands/                          斜杠命令
    skills/                            技能
assets/
  deepseek-web-search/icon.png         条目图标（catalog 的 icon 指向它的 raw 地址）
scripts/validate.py                    市场与插件清单校验（取自 zai-org/zcode-plugins，Apache-2.0）
LICENSE
```

校验：

```sh
python3 scripts/validate.py
```

条目字段与目录位置对齐官方约定：`source` 取 `./external_plugins/<name>`，`description_i18n` 同时提供 en 与 zh-CN 且与插件 manifest 完全一致，`category` 取官方允许集合内的值，`icon` 用仓库内资源的 raw HTTPS 地址。第三方来源见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 收录插件

| 显示名 | 插件名 | 作用 | 前置条件 |
| --- | --- | --- | --- |
| DeepSeek 联网搜索 | `deepseek-web-search` | DeepSeek 官方联网搜索与网页抓取 | Node.js >= 18；`DEEPSEEK_API_KEY` |

插件的组件、CLI 用法、接口说明与退出码见 [external_plugins/deepseek-web-search/README.md](external_plugins/deepseek-web-search/README.md)。

## 添加为 ZCode 插件市场

1. 打开 **插件市场 / Plugin Marketplace**。
2. 点击 **添加 / Add → 添加插件市场 / Add Plugin Marketplace**。
3. 粘贴仓库地址：`https://github.com/bluechonk/zcode-plugins`
4. 添加后到 **个人 / Personal** 分组，找到「DeepSeek 联网搜索」并点击安装。

### 关于分组标题

分组标题取 `marketplace.json` 的 `name`，因此显示为 `bluechonk-plugins`。该字段受客户端校验约束 `^[a-z0-9][a-z0-9._-]{0,127}$`，只能 ASCII 小写；客户端也没有给第三方市场提供显示名通道（`known_marketplaces.json` 里没有该字段），中文只可能出现在插件条目的 `displayName` 上。

> catalog 的 `name` 就是市场 id。改名等同换市场：已注册的旧 id 需先移除再重新添加，插件也要重装。

## 配置

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 是 | DeepSeek API Key，与普通 API 同一把 |
| `DEEPSEEK_BASE_URL` | 否 | 覆盖 API 地址，留空用 `https://api.deepseek.com` |

## 许可

MIT
