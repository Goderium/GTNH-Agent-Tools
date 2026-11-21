
# GTNH Tooltip 工作台

供 Agent 从源码、BridgeNH 回执或已解析文本生成 Minecraft 1.7.10 / GTNH 的 Tooltip、NEI 配方页和 MUI2 面板预览。命令行驱动离线 HTML 渲染器，输出 PNG 或单文件 HTML，并可生成机器可读的布局与差分回执。

## 生成流程

先定位实际显示入口，按对应版本源码确定行序、分支、翻译键、格式和布局。为当前例子提供运行状态或配方内容，用同一 HTML 渲染器输出预览，并核对有代表性的开关、空状态及长文本。源码解析遇到不支持的调用会在机器报告模式中报错。实拍和已有回执用于验证，也可独立回放。

| 内容 | 源码入口与生成方式 |
| --- | --- |
| 物品、多方块和 GUI 文字 | 用 `source=java` 读取说明方法、Builder 或语言资源，检查 `extraction.unresolved`。可用 `requireComplete` 要求所有行可解析。 |
| NEI 配方页 | 读取配方池和 Frontend 结构，由 HTML 生成格子，再填材料与悬停文字。 |
| MUI2 面板与绘制 | 用 `source=mui2` 读取面板工厂或 drawable 字段，从方法体、主题注册和同步值生成控件布局、纹理、文字与悬停状态。 |
| 主机三录仪 | 用 `source=machine` 读取 `getInfoData` 或 `getExtraInfoData`，传入手填主机字段，输出主机自定义纯文本。 |
| Waila | 用 `source=machine` 读取 `getWailaBody`，传入同步后的 NBT，在 Waila HUD 中绘制所选机器的正文。 |
| 彩色文字、聊天与已有报告 | 使用已有文字渲染入口保留格式码、字形和布局。已存三录仪物品报告可用 `profile=scanner` 回放。 |

## Agent 调用

需要 Node.js 22+ 和 Chromium 或 Edge。从 Java 提取时另需支持目标语法的 JDK。可用 `--java` 指定 Java 的绝对路径。直接打开 index.html 可以检查预览。命令行只启动临时 Chromium 配置，在本机通过 DevTools 读取离线页面。

```powershell
node .\agent.mjs --request request.json --out tooltip.png --report result.json
```

JSON 文件相对自身目录解析输入路径。可用 --browser 指定 Chromium 或 Edge 的绝对路径。--require-exact 要求提供实机对照并且为零差异。退出码 0 表示请求成功，1 表示输入或运行错误，2 表示没有达到零差异。退出 2 时保留 PNG 和报告。

对话预览直接使用透明 PNG，保留 Tooltip 自身的配色和边框。HTML 的主预览和导出 PNG 只包含 Tooltip 图层。

### 批量请求

用 `--batch` 传入清单，一次调用可混合生成 NEI 配方页、MUI2 面板、物品 Tooltip、三录仪和 Waila 预览。清单中的路径相对于清单，每份请求里的资源路径仍相对于该请求。以下清单会生成一张配方页、一张 MUI2 信号面板图和一张 Waila 图。

```json
{
  "jobs": [
    { "request": "requests/recipe.json", "out": "recipe.html", "report": "recipe-report.json" },
    { "request": "examples/mui2-panel.json", "out": "signals.png", "report": "signals-report.json" },
    { "request": "requests/waila.json", "out": "waila.png" }
  ]
}
```

```powershell
node .\agent.mjs --batch batch.json --report batch-report.json
```

任务按清单顺序运行，可以先导出布局，再由后续配方页读取。整个批次按需启动一个浏览器，每份请求使用独立页面状态。每项可用 `report` 保存原有的完整报告，用 `requireExact: true` 要求该项通过像素对照。批次的标准输出和可选的 `--report` 是同一份 JSON，包含逐项退出码、浏览器启动次数和跳过的任务数。清单或输入路径冲突在执行前报错。运行中遇到错误时保留已有输出，停止后续任务并返回 1。仅像素对照未通过时继续执行，批次返回 2。

### Java 源码

```json
{
  "source": "java",
  "profile": "item",
  "java": {
    "file": "path/to/BlockPowerChair.java",
    "method": "addInformation",
    "locale": "zh_CN",
    "namespace": "gtnhcommunitymod"
  },
  "strict": true,
  "settings": { "advanced": true, "scale": 2, "font-mode": "modern" },
  "item": {
    "nameKey": "tile.tst.block_power_chair.0.name",
    "registryName": "TwistSpaceTechnology:BlockPowerChair",
    "metadata": 0,
    "hasSubtypes": true,
    "modName": "Twist Space Technology",
    "keys": ["shift", "alt"]
  },
  "files": {
    "fonts": ["path/to/minecraft-1.7.10-client.jar", "path/to/angelica.jar"],
    "fontConfig": "path/to/config/angelica.cfg"
  }
}
```

工具用 JDK AST 读取源码。按惯用目录查找 src/main/resources/assets/<namespace>/lang/，先加载 en_US，再覆盖请求语言。files.language 可指定一组翻译文件，后者覆盖前者。不执行目标源码。可解析文本字面量、部分拼接、颜色枚举、可求值的翻译调用、顺序输出和常见 Shift / Ctrl / Alt / F3+H 条件。上下文开关放在 settings。

可用 java.method 指定 Java 方法。省略时扫描常见 Tooltip 方法。指定 createResetButton 等方法可提取控件中的 tooltipBuilder 或 addLine。同文件的 TST #tr 草稿能提供翻译，当前目标语言的源码注释优先用于预览。提取可解析同一 Java 源目录里显式导入的静态终值字段和 GT Builder 的普通说明。GT 终止分隔线使用 java.gtFinisherStyle，默认沿用 GT 5.09.54.265 的连续线。

结果的 extraction.unresolved 记录无法求值的语句和源码行号。java.requireComplete 为 true 时发现未结项便失败。继承、自动生成的 Shift 结构说明、条件循环、动态 IKey、样板数据和 NBT 可用对应实机状态核对。

### MUI2 面板与绘制

用 `source=mui2` 直接解释面板工厂或 drawable 的 Java 语法树。提供与目标客户端匹配的 MUI2 和模组源码。JDK 解析语法树，浏览器用 WebGL 绘制。逐像素比对时使用硬件图形加速；Angelica 抗锯齿还需要片元导数。随附的信号面板只绘制矩形，可以用 Node.js、Chromium 或 Edge 及支持目标语法的 JDK 独立运行。[请求](examples/mui2-panel.json) · [面板源码](examples/SignalPanel.java)

```powershell
node .\agent.mjs --request examples/mui2-panel.json --out signals.png --report signals-report.json
node .\agent.mjs --request examples/mui2-panel.json --out signals.html
```

完整机器页面从返回 `ModularPanel` 的方法进入。下面的相对路径代表与请求一同准备的源码、JAR 和语言文件。该状态会显示最大并行锁、两个绿色勾选图标，以及格式化为 `4,096` 的输入值。

把外置标题、主面板和侧面弹窗放进同一画布时，外层 `ModularPanel` 可调用 `.invisible()`。这样标题旁和弹窗下方的空白在鼠标经过时也保持透明，里面的页签、按钮和槽位照常接收输入。

```json
{
  "source": "mui2",
  "java": {
    "file": "src/MTEMultiBlockBaseGui.java",
    "method": "openPowerControlPanel",
    "sources": ["src/GTGuiThemes.java", "src/GTGuiTextures.java", "src/GuiTextures.java"]
  },
  "theme": { "source": "GTGuiThemes.STANDARD" },
  "state": {
    "bindings": {
      "GregTech.ID": "gregtech",
      "ModularUI.ID": "modularui2",
      "multiblock.getTrueParallel": 4096,
      "multiblock.makesPowerfailEvents": true
    },
    "sync": { "maxParallel": 4096, "alwaysMaxParallel": true }
  },
  "files": {
    "resources": ["client/gregtech.jar", "client/modularui2.jar"],
    "fonts": ["client/minecraft.jar", "client/angelica.jar", "client/gregtech.jar"],
    "fontConfig": "client/angelica.cfg",
    "language": ["lang/en_US.lang", "lang/zh_CN.lang"]
  },
  "scale": 2
}
```

| 请求字段 | 含义 |
| --- | --- |
| `java.file`、`java.method`、`java.field` | 用一个方法名或一个字段名选定入口。`java.sources` 列出本次引用的辅助类、父类、主题和纹理声明文件。 |
| `state.args` | 按 Java 参数顺序传入值，例如示例中的 `[65]`。仅含 `PanelSyncManager`、`ModularPanel` 参数的工厂可省略。 |
| `state.sync`、`state.bindings` | `sync` 按 Java 注册的同步键提供值。`bindings` 为外部常量和无参 getter 提供运行状态。切换电源面板的两项布尔值并将 `getTrueParallel` 改成 `1234`，即可生成两个红叉和 `1,234`。 |
| `theme` | 提供 `GTGuiThemes.java` 时默认选择 `GTGuiThemes.STANDARD`。可指定源码声明的派生主题。工具跟随 `parent()`，从纹理的 `.name(...)` 注册匹配实际 builder。原版 MUI2 主题可选 `"source": "vanilla"`，并提供对应版本的 `GuiTextures.java`。可用 `theme.color` 或 `state.bindings["Dyes.GUI_METAL.toInt"]` 指定实例的金属色。 |
| `files.resources`、`files.fonts` | 从资源 JAR 或 ZIP 读取纹理，从客户端字体和可选 Angelica 配置读取字形。纹理所在的模组 JAR 加到 `resources`。 |
| `files.language`、`state.language` | 显式列出目标客户端使用的 `.lang` 文件，后项覆盖前项。省略文件列表时从入口 Java 的项目资源查找。可用 `state.language` 覆盖单个键。缺失翻译按游戏行为显示键名。 |
| `size`、`scale`、`timeMs` | 面板沿用源码中的尺寸。单独绘制一段 drawable 时给出 `size.width`、`size.height`，单位为 GUI 逻辑像素。`scale` 为 1 至 4 的整数，`timeMs` 用于固定基于时钟的动画相位。 |

报告中的 `methods` 给出实际访问的方法，`widgets` 给出控件 ID、类型、逻辑坐标、悬停响应和提示文字。用 `files.reference` 指向同状态的客户端截图，用 `crop` 的 `x`、`y`、`width`、`height` 选取物理像素区域。单项调用使用 `--require-exact`，批量清单中使用 `requireExact: true`。检查 `comparison.checkedPixels`、`differentPixels` 和 `exact`。

面板默认按自身大小导出。要按游戏内屏幕位置测试悬停，可传 `"viewport": {"width": 520, "height": 360, "x": 359, "y": 78}`，其中 `x`、`y` 是面板左上角在屏幕上的逻辑坐标。把报告中的控件 ID 填入 `state.hover`，用 `state.mouse` 的 `x`、`y` 指定鼠标屏幕逻辑坐标，省略时取控件中心。PNG 会画出该状态，周围游戏世界透明。默认 `tooltipRenderer` 为整合包使用的 `chromatic`，关闭 Chromatic 的 MUI2 集成时可选 `mui2` 的原生鼠标邻近布局。

导出的 HTML 可直接移动鼠标。Agent 也可调用 `GTNHMuiScene.hover(id, x, y)` 再等待 `GTNHMuiScene.ready()`，用 `state().tooltipBox` 读取含边框的逻辑坐标，用 `panelPng()` 和 `tooltipPng()` 读取独立图层。调用 `hover(null)` 可返回面板。HTML 内含本次悬停用到的字形和面板资源，可单文件离线使用。

已用 MUI2 2.3.94、GT 5.09.54.265、TST `32e535ab4b` 和 JDK 25 验证。梦魇工业合成中心的样板倍率、熯焱高炉的电源控制、奇异物质聚合器的自动搭建与运行配置在 2×、3× 下逐像素匹配客户端。高炉另验证了 2× 解锁并行、关闭故障事件的状态。四组文字悬停比对了整个外框与字体阴影。瓶中混沌单独核对了四个终端标签、30 个凭证指示灯与三个时刻的动画边缘。绘制样例另含进度条、拉伸、九宫格、平铺、透明混合、四色渐变和圆角。

当前可解释行列布局、文本、按钮、滑块、数字输入框，以及源码中的条件、常用循环和 drawable 回调。未支持的绘制方法、外部运行值、控件构造器和主题声明会报告错误。跨面板子控件定位、同名同参数数量的 Java 重载和自定义 OpenGL 绘制需单独适配。

#### 调节 MUI2 控件

整窗使用一个 Java 入口。把调用到的页面工厂所在文件加入 `java.sources`，工作台沿着源码中的子控件、页控制器和可见条件构建整棵控件树。MUI2 原生 `PagedWidget`、`PageButton` 和 `Controller` 支持初始页、指定页、上一页和下一页。机器自定义页签也可以用鼠标回调写入 `IntSyncValue`，各页的 `setEnabledIf` 跟随该值。返回时保留已改动的子页状态。Agent 可按报告里的 `label`、`control.target` 和 `choice` 定位当前页签。[双页工厂](examples/PagedPanel.java) · [可运行请求](examples/mui2-pages.json)

```powershell
node .\agent.mjs --request examples/mui2-pages.json --out pages.html --report pages-report.json
```

一般导出为可独立打开的 HTML。需要嵌入对话时，使用相同入口并设 `"htmlMode": "fragment"`，产物包含同一套源码解释器和鼠标交互。PNG 用于展示指定状态。GUI 依赖服务器库存、NBT 或配方结果时，从 `state.sync`、`state.bindings` 和 `state.slots` 提供快照；空机可用 `"state": {"emptyBoundSlots": true}` 表示未列出的绑定槽皆空。

需要适配特殊运行时对象时，可在 `java.adapters` 按签名指定适配工厂，例如 `{"Machine.makeResult/1":"Snapshot.makeResult/1"}`。目标方法来自同一组输入源码，接受原参数或零个参数，报告的 `methods` 会记录替换关系。支持的同步写入和分页点击可离线重放，无法解释的自定义回调在对应控件上标记 `controlUnavailable`。Agent 可先检查该字段，再判断自己的预览是否覆盖目标操作。实机执行的配方和容器事务使用单独的游戏状态。指定 `"textureQuadMode": "angelica-2.2.43"` 可复现该版本 GUI 纹理的三角形拆分。

先用 `--report` 取得 `widgets[].id` 和 `widgets[].control`。后者给出控件类型、当前值、写入位置，以及源码声明的取值范围、停点或滚轮步长。带数据绑定的数字框、开关、循环按钮、滑块支持调节。普通按钮只有在工具识别完整回调及其同步写入时才提供调节操作。每次操作后，工作台用更新的状态重新执行面板工厂，关联控件、纹理、文字和悬停内容随之刷新。

将 `actions` 加入请求即可从初始状态重放操作，单个请求最多 256 步。做交互验收时可设 `"requireInteractive": true` 并依次打开目标页。遇到可见但无法重放的自定义输入回调，CLI 或 HTML 会报告对应的控件。下例可配合随附滑块面板直接使用。输出 PNG 为末步画面，导出 HTML 后可继续调节。[Java 源码](examples/SliderPanel.java) · [起始请求](examples/mui2-slider.json) · [动作请求](examples/mui2-slider-actions.json)

```json
{
  "source": "mui2",
  "java": { "file": "SliderPanel.java", "method": "create" },
  "actions": [
    { "id": "red", "type": "drag", "x": 80, "y": 4 },
    { "id": "mode", "type": "scroll", "direction": "up" }
  ],
  "scale": 3
}
```

```powershell
node .\agent.mjs --request examples/mui2-slider-actions.json --out sliders.html --report sliders-report.json
```

| 操作 | 请求 |
| --- | --- |
| 设值 | `set` 接受 `value`。开关用布尔值，循环按钮用 `control.options` 中的值。滑块取绝对数值。数字框的数值表示绝对值，字符串走输入解析和验证，例如有相对上限的字段接受 `"25%"`。 |
| 点击与拖动 | `click` 的 `button` 默认 0，1 表示右键反向循环。`drag` 的 `x, y` 是相对滑块左上角的 GUI 逻辑像素。手柄行程、横纵方向、上下界与停点依照源码。 |
| 滚轮 | `scroll` 的 `direction` 为 `up` 或 `down`。可加 `modifiers: {"ctrl":true,"shift":true,"alt":false}`。数字步进需要焦点，滑块遵循自身滚轮设置。回执的 `consumed` 表示控件是否处理该事件。 |
| 编辑数字 | `focus` 开始编辑；`edit` 给出整行 `text`，可指定 `anchor`、`caret` 和 `showCaret` 固定选区与光标相位。`commit` 验证、写回并结束编辑；`cancel` 恢复聚焦时的值。长草稿按输入框宽度裁切，可用逻辑像素 `scrollX` 固定水平偏移。 |

报告的 `actions[]` 逐步给出 `before`、`after` 和 `consumed`。`controlState.edit` 保存草稿，`controlState.sync` 和 `bindings` 保存已写回的值。默认在确认或失焦时提交，源码启用 `autoUpdateOnChange` 或聚焦滚轮步进时可即时写回。

数字提交跟随字段声明选择 MUI2 的解析器。例如 `2m` 在 `numbersInt` 中为 2,000,000，在 `numbersDouble` 中为 0.002；`numbersInt` 的 `2s` 为 128。千位分隔符由绘制器添加，直接从显示文字复制时应传入原始数字。内置数值表达式和禁用表达式的字段均有原生 Java 对照。超出 JavaScript 安全整数范围的提交会报错。自定义 Java 验证器和 EvalEx 日期、字符串函数需单独适配。

交互 HTML 自带本次解析的 Java 语法树、字体和纹理，在支持 WebGL 的浏览器离线运行。Agent 可以直接调用以下 API，浏览器也接受鼠标拖动、滚轮、键盘和选区操作。按 Enter 或失焦会提交；Escape 默认提交，按目标客户端配置可设置 `state.escRestoreLastText: true`。截图时可用动作显式锁定光标相位。

```js
await GTNHMuiScene.ready();
const receipt = await GTNHMuiScene.act({id: "mode", type: "set", value: 3});
const current = GTNHMuiScene.state();
const png = GTNHMuiScene.panelPng();
await GTNHMuiScene.reset();
```

验收样例覆盖了熯焱高炉的最大并行锁、故障开关和编辑选区，梦魇工业合成中心的样板倍率及上下界，GT EV 改良唱片机的两条滑块，以及 GT 无线算力输入仓的聚焦滚轮。以上控件均有与实机同状态的 RGBA 对照。

#### MUI2 物品槽与流体槽

布局取自 Java 中的 `ItemSlot`、`FluidSlot`。Agent 用 `state.slots` 按控件 ID 填入当前堆叠或罐体的显示状态。在源文件中用 `.name("tank")` 可固定 ID。槽位注册使用 `.slot(...)`、`.tank(...)` 或 `.syncHandler(...)` 时，为每个已绑定槽提供一项，空槽写为 `{}`。其中可以包含 `new ModularSlot(...)` 和 `new FluidSlotSyncHandler(...)`。数量、纹理和 Tooltip 来自该次请求，不会查询玩家物品栏或客户端容器。

以下片段用于具有 `diamond`、`tank`、`spare` 三个控件 ID 的面板。对应的基础图标来自 Minecraft 1.7.10 客户端 JAR。

```json
{
  "state": {
    "slots": {
      "diamond": { "resource": "minecraft:items/diamond", "count": 64, "tooltip": ["钻石"] },
      "tank": {
        "resource": "minecraft:blocks/water_still",
        "size": [16, 512], "frame": [0, 0, 16, 16],
        "amount": 250, "capacity": 1000,
        "tooltip": ["水", "250 / 1000 L"]
      },
      "spare": {}
    }
  },
  "files": { "resources": ["client/minecraft.jar", "client/modularui2.jar", "client/gregtech.jar"] }
}
```

- `resource` 解析为 `assets/<namespace>/textures/<path>.png`。`size` 是源图宽高，`frame` 以源图像素指定 `[x, y, width, height]`，适合从动画条带或图集中选择一帧。省略两者时使用整张纹理。`tint` 接受 RGB 或 ARGB 整数。
- 物品图标按原生位置在左上内移 1 像素后绘制为 16×16。`count` 默认为 1，大于 1 时显示右下方带阴影的数量。木斧单件和 StructureLib 全息投影仪 64 件已用客户端 2×、3× 整槽截图逐像素核对。
- 有流体时提供正整数 `amount`。默认填满内容区。Java 使用 `.alwaysShowFull(false)` 时再给出 `capacity`，液体从下往上，`gaseous: true` 的气体从上往下。布局支持源代码的 `contentPadding` 和 `flipLighterThanAir`。流体图标按每 16 个 GUI 像素平铺。默认数量单位为 L，实例使用 Forge 的毫桶显示时传 `state.useForgeFluidMillibuckets: true`。工具读取同步处理器的 `.controlsAmount(false)`，请求也可通过 `controlsAmount` 指定是否显示液量文字。
- GT EV 四重输入仓装入 1,234 mB 熔融铁后，已用 2×、3× 实机截图核对完整流体槽和相邻空槽。比对包含原始动画条带的两个不同帧、材料色、右下角的 `1234L` 以及边框。另用 MUI2 原生绘制对照验证了部分填充的液体、气体、平铺与悬停高亮。
- `tooltip` 接受游戏格式码字符串数组。报告 `widgets[].slot` 给出图标矩形、数量文字、悬停矩形。物品高亮覆盖 16×16，流体高亮覆盖控件四边内缩 1 像素的区域。`state.itemHoverOverlay: false` 对应关闭物品高亮的客户端，`state.showSlotOverlay: false` 对应隐藏已填槽位的自定义背景层。
- 此入口绘制单层平面纹理。请求显式指定 `renderer` 时仅接受 `"flat"`。专用物品模型、3D 方块、多层效果、附魔光效、耐久条和拖拽状态需要独立渲染支持。参数内提供这类额外渲染声明会报错。

### 主机三录仪与 Waila

`source=machine` 使用 JDK 22+ 的多文件源码启动器，当前 TST 样例使用 JDK 25。每次从指定 Java 文件读取实际方法体，使用 JDK 语法树解释显示涉及的语句。同类辅助方法按实际分支求值。普通字段由 `state.fields` 传入，外部无参取值方法可以在 `state.calls` 提供结果。Waila 使用 `state.nbt`，缺失标签按对应 NBT getter 的默认值处理。超过 JavaScript 安全整数范围的长整数写为 `{"long":"9007199254740993"}`。

```json
{
  "source": "machine",
  "java": {
    "file": "tst/src/main/java/com/Nxer/TwistSpaceTechnology/common/machine/TST_MegaCraftingCenter.java",
    "method": "getInfoData",
    "locale": "zh_CN"
  },
  "state": { "fields": { "patternDetails": ["电路板", "微处理器", "晶体管", "电感", "二极管"] } },
  "strict": true,
  "files": { "fonts": ["minecraft.jar", "angelica.jar", "gregtech.jar"], "fontConfig": "angelica.cfg" }
}
```

```powershell
node .\agent.mjs --java "path/to/jdk-25/bin/java.exe" --request machine.json --out machine.html --report machine-report.json
```

输出扩展名可选 `.html` 或 `.png`。HTML 内含位图和 `#machine-report` JSON。报告中的 `extraction.methods` 给出实际走过的方法与源码行号，`extraction.lines` 是机器贡献的文字。三录仪纯文本保留颜色、行序和末尾空格。继承的基础扫描项不进入主机报告。Waila 可另填 `waila.head`、`waila.tail` 字符串数组组合 HUD，并可通过 `files.wailaConfig` 引入该实例的位置、背景及文字颜色。样例使用游戏默认的 100% HUD 缩放。

[四台主机的请求样例](examples/machine-reports.json)使用 TST 仓库相对源码路径，取其中一项作为请求，将路径定位到所需版本的工作树，再加入客户端字体文件。样板列表填写各样板第一个产物的显示名。解释器支持这些样例用到的数组、列表、条件、循环、翻译和数字格式。手填运行字段与服务端同步后的标签从各自入口提供。增加机器时按实际遇到的显示方法扩展。

### 物品框和颜色

可在 java 或 editable 请求中传入 item。标题用 nameKey 从语言文件读取，也可传 displayName。rarity 可指定 Minecraft 的一位稀有度颜色。提供 registryName、modName、numericId、metadata、hasSubtypes 及 keys 可复现普通物品的框体。settings.advanced 决定显示高级物品编号和注册名。省略 item 时可单独渲染正文。

item.titleStyle 和 item.credits[].style 支持 standard、rainbow、modularized、dyson、infusion。titleStyleFrom 可令标题仅对指定分隔符之后的文字应用样式。署名条目使用 text，可用 formatKey 或 prefix、suffix 包裹格式化后的名称。timeMs 选定可复现的动画时刻。主题颜色覆盖仍使用四个 ARGB 值，可用于背景及边框渐变。

独立彩色正文使用 profile=text。文本行支持原版颜色和修饰码、Angelica 的 §x RGB 和 §g 渐变，也可用 @style rainbow 之类的行指令。导入 Angelica JAR 后，现代字体模式使用对应位图、半像素 Unicode 阴影、粗体采样和抗锯齿。可选的 files.fontConfig 直接读取游戏实例的 Angelica 配置。

### BridgeNH 原生文本与截图

- source=bridge 加 capture 指向本地回执 JSON，读取 mcb_gui_tooltip 返回的 tooltip，或 mcb_nei_view 的已完成帧文本 entries。后者需按 lineIndex 合并完整分页。回执只提供实际观察到的信息，自定义标题 ID、按键徽章、图标等组件可能单独渲染。
- source=editable 加 lines 字符串数组，逐行处理 § 格式、可选 & 格式、@lang 翻译和按键条件。支持 @title 普通标题 | 数字 ID、@body、@footer、@section 三录仪分节。NEI 可通过 page 选页。files.reference 和 crop 用于像素对照，截图尺寸必须与 GUI 缩放后的视口一致。
- source=game-frame 加 files.reference 裁切当前游戏截图，保存原始 RGBA。crop 用物理像素的 x、y、width 和 height。亦可提供 capture，其中的 Chromatic 实测矩形按 settings.scale 自动转成物理像素。比较回执验证裁切 PNG 的像素往返。此模式适用于复杂装饰、动态元素、自定义绘制和最终证据。

```json
{
  "source": "game-frame",
  "capture": "completed-hover.json",
  "settings": { "scale": 2 },
  "files": { "reference": "minecraft-frame.png" }
}
```

实机对照可以并排查看原帧裁切与透明渲染。HTML 的差分只统计两侧都不透明的像素。Agent 报告直接比较裁切区域的 RGBA，透明度差异也计入结果。

`strict` 检查游戏字形和翻译是否齐全，`--require-exact` 单独检查像素结果。原帧裁切的零差异只说明截取保真。重绘结果以单独的 `comparison.exact` 为准。

### NEI 配方主面板

`source: "nei-frame"` 从 `mcb_nei_view` 的 `section="detail", target="rendered_text"` 回执重放选定的主面板文字。`drawIndices` 填同一绘制坐标系中的 `itemIndex`，`drawRegion` 用该坐标系的逻辑像素指定 `x`、`y`、`width`、`height`。离线 PNG 透明，按绘制顺序保留文字坐标、颜色和阴影。输出报告带 `drawFrameId` 和实际使用的 `drawIndices`。

NEI 的局部绘制坐标可能随图层平移或裁切。用实拍确认主面板区域。原生物品图标、纹理和自定义槽框以 `game-frame` 裁切留证。输入、输出槽的文字可以使用已完成的 `hover_tooltip_lines` 回执，GT 三录仪的聊天和物品报告可分别使用 `chat` 与 `scanner` 场景。

### NEI 配方页生成

用 `source: "nei-layout"` 从选定的 RecipeMap、Frontend 和对应版本的 GT 源码提取面板尺寸、槽组容量、网格起点、列数、间距和装饰位置。提取器支持奇迹顶点这类通过 `UIHelper.getGridPositions` 定义四组规则网格且明确关闭进度条的 Frontend。其他布局可以直接提供同结构的 JSON，通过 `cells` 添加独立槽位，通过 `decorations` 描述固定图标。解析 GT 5.09.54.265 源码可用 JDK 25。

```json
{
  "source": "nei-layout",
  "java": {
    "recipeMap": "src/GTCMRecipe.java",
    "field": "MiracleTopRecipeMap",
    "frontend": "src/TST_MiracleTopFrontend.java",
    "gridHelper": "gt/UIHelper.java",
    "uiDefaults": "gt/BasicUIPropertiesBuilder.java"
  }
}
```

```powershell
node .\agent.mjs --request layout-request.json --out layout.json
```

用 `source: "nei-scene"` 生成单文件 HTML。HTML 按面板和网格设定生成格子和鼠标命中区域。槽位 ID 由网格的 `role` 和从零开始的序号组成，例如 `fluid-input-0`。标题、说明、图标、数量和悬停文字均手填。每槽可指定一张 PNG 基础纹理。整页含说明一次展开，使用绘制底板和客户端位图字体。多个配方共用一个 HTML 时，切换放在页底。

```json
{
  "source": "nei-scene",
  "viewport": { "width": 427, "height": 240, "scale": 2 },
  "files": { "fonts": ["minecraft.jar", "angelica.jar", "gregtech.jar"], "fontConfig": "angelica.cfg" },
  "scenes": [{
    "id": "planck",
    "layout": "layout.json",
    "textures": { "logo": "gt-logo.png", "special-0": "arrow-white-down.png" },
    "content": {
      "title": "奇迹顶点 - NAC配方",
      "description": ["时间：25,344 秒"],
      "slots": {
        "item-output-0": {
          "name": "普朗克尺度电路",
          "icon": "planck-circuit.png",
          "quantity": "64",
          "tooltip": ["§7产出 64 个"]
        }
      }
    }
  }]
}
```

```powershell
node .\agent.mjs --request scene.json --out recipe.html --report scene-report.json
```

`layout` 和 `content` 可用内联对象或 JSON 文件路径。槽位 PNG 相对于内容所在文件解析。布局装饰的 PNG 通过 `textures` 关联装饰 ID，路径相对于请求文件。Agent 可调用 `GTNHNeiScene.select(id)`、`GTNHNeiScene.hover(slotId)`、`GTNHNeiScene.state()` 和 `await GTNHNeiScene.panelPng()`。报告提供槽位坐标和填充状态。

NEI 数量标签在一次命令调用中共享最多 512 个缓存项。相同文字、绘制参数和资源版本复用同一张字形位图，物品和流体仍各自计算槽内缩放。更换字体资源或配置、字体模式、GUI 缩放时会重新绘制，带 `§k` 扰码的标签每次绘制。配方报告和批次摘要的 `quantityLabels` 分别用 `requested`、`rendered`、`hits` 记录槽位请求数、实际绘制次数和缓存命中次数。

## 场景

| profile | TST / GT 的入口 | HTML 处理 |
| --- | --- | --- |
| item / multiblock | addInformation、ItemTooltipEvent、GT MultiblockTooltipBuilder、按键分支 | 物品、控制器和结构说明，Chromatic 与经典 NEI，标题和页脚 |
| nei | handleTooltip、handleItemTooltip、配方输入输出、物品面板、书签 | 版块、分页、宽度与贴边位置。配方页从 Frontend 布局生成 |
| mui1 / mui2 | Widget.addTooltip、tooltipBuilder / tooltipDynamic、RichTooltip | 文字、宽度与阴影。整份 MUI2 面板的源码工厂使用 `source=mui2` |
| waila | getWailaHead / Body / Tail | HUD、多列、配置配色，可导入块图标。自定义渲染用原帧 |
| scanner / chat | GT getInfoData / getExtraInfoData、BehaviourScanner | 另有 machine-scanner，用于主机自定义纯文本。已存报告支持分节与分页，聊天支持换行 |
| text | Minecraft FontRenderer、Angelica 批处理字体、TST Style | 无边框文字和可复现的多色效果 |
| guide / vanilla | GuideNH 悬停文字、GuiScreen 悬停 | 文字草稿与原版边框。GuideNH 组件最终效果用原帧 |

字体直接导入当前客户端 JAR、Angelica JAR 和可选字体资源包 ZIP。工具包内没有复制游戏字体。整框像素对照还受游戏背景、鼠标高亮、实际动画相位、采样舍入和第三方自定义绘制影响。实机 PNG 对照可以独立导入。

GT 配方材料中的化学式可能使用 GT 的私用区字形。把客户端实际加载的 GregTech JAR 放入 `files.fonts`，顺序在 Minecraft JAR 之后，以加载 GT 的 `glyph_sizes.bin` 和对应 Unicode 图集。

实现对照 Minecraft 1.7.10 的 FontRenderer、[Angelica 2.2.43 字体渲染](https://github.com/GTNewHorizons/Angelica/tree/2.2.43/src/main/java/com/gtnewhorizons/angelica/client/font)、[Chromatic Tooltips 1.0.36-GTNH](https://github.com/GTNewHorizons/ChromaticTooltips/tree/1.0.36-GTNH) 和 [GT5-Unofficial 5.09.54.265](https://github.com/GTNewHorizons/GT5-Unofficial/tree/5.09.54.265) 的常规路径。
