# GTNH Agent Tools

供 Agent 离线使用的 GTNH 工具集。

各工具位于 `tools/` 下，其 README 提供运行依赖、输入输出和调用示例。

| 工具 | 用途 | Agent 入口 |
| --- | --- | --- |
| [GTNH Tooltip 工作台](tools/tooltip-preview/README.md) | 从 Java 预览 Tooltip 和 MUI2 面板，按配方池布局与手填内容生成 NEI 页，从主机字段和同步 NBT 生成三录仪与 Waila 预览 | [命令行](tools/tooltip-preview/agent.mjs) · [离线 HTML](tools/tooltip-preview/index.html) |

工作台随附源码和合成样例。预览所需的目标模组源码、游戏字体和客户端配置由使用者在请求文件中指定。

MUI2 从 Java 面板工厂或 drawable 字段输出 PNG 和单文件 HTML。多页面板从同一源码入口生成，共享控件和同步状态。Agent 可切页、调节控件、读取回执，并导出操作后的画面。[调用说明](tools/tooltip-preview/README.md#mui2-面板与绘制) · [分页示例](tools/tooltip-preview/examples/mui2-pages.json) · [滑块示例](tools/tooltip-preview/examples/mui2-slider.json)
