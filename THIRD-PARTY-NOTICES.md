# 第三方来源声明

本仓库源码以 MIT 授权（见 [LICENSE](LICENSE)）。下列文件来自第三方，按其原许可证使用。

## scripts/validate.py

| 项 | 内容 |
| --- | --- |
| 来源 | https://github.com/zai-org/zcode-plugins 的 `scripts/validate.py` |
| 许可证 | Apache License 2.0，原文见 [LICENSE-APACHE-2.0.txt](LICENSE-APACHE-2.0.txt) |
| 改动 | 无，逐字节保持一致，便于与上游比对和同步 |

该脚本校验 `marketplace.json`、各插件 manifest 与目录结构是否满足 ZCode 插件市场约定，只用 Python 标准库，退出码 0 通过、1 失败：

```sh
python3 scripts/validate.py
```

脚本要求 `plugins[]` 条目的 `source` 恰为 `./plugins/<name>` 或 `./external_plugins/<name>`，因此本仓库的社区插件放在 `external_plugins/` 下。

## assets/

`assets/deepseek-web-search/icon.png` 为本仓库自绘几何图形，不含任何第三方品牌素材。
