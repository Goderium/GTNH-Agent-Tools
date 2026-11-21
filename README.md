# GTNH Agent Tools

供 Agent 离线使用的 GTNH 工具集。

各工具位于 `tools/` 下，其 README 提供运行依赖、输入输出和调用示例。

| 工具 | 用途 | Agent 入口 |
| --- | --- | --- |
| [GTNH Tooltip 工作台](tools/tooltip-preview/README.md) | 从 Java 和翻译资源预览 Tooltip，用配方池布局与手填内容生成 NEI HTML，从主机字段和同步 NBT 生成三录仪与 Waila 预览 | [命令行](tools/tooltip-preview/agent.mjs) · [离线 HTML](tools/tooltip-preview/index.html) |

工作台随附源码和合成样例。预览所需的目标模组源码、游戏字体和客户端配置由使用者在请求文件中指定。
