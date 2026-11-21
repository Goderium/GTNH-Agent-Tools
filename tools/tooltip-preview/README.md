
# GTNH Tooltip 工作台

供 Agent 从源码、BridgeNH 回执或已解析文本生成 Minecraft 1.7.10 / GTNH 的 Tooltip 预览。入口是离线 HTML 和命令行。命令行驱动同一份 HTML，输出 PNG 和机器可读的布局、分页、缺失字形以及差分回执。

## 生成流程

先定位实际显示入口，按对应版本源码确定行序、分支、翻译键、格式和布局。为当前例子提供运行状态或配方内容，用同一 HTML 渲染器输出预览，并核对有代表性的开关、空状态及长文本。源码解析遇到不支持的调用会在机器报告模式中报错。实拍和已有回执用于验证，也可独立回放。

| 内容 | 源码入口与生成方式 |
| --- | --- |
| 物品、多方块和 GUI 文字 | 用 `source=java` 读取说明方法、Builder 或语言资源，检查 `extraction.unresolved`。可用 `requireComplete` 要求所有行可解析。 |
| NEI 配方页 | 读取配方池和 Frontend 结构，由 HTML 生成格子，再填材料与悬停文字。 |
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

用 `--batch` 传入清单，一次调用可混合生成 NEI 配方页、物品 Tooltip、三录仪和 Waila 预览。清单中的路径相对于清单，每份请求里的资源路径仍相对于该请求。以下清单会生成一张配方页和一张 Waila 图。

```json
{
  "jobs": [
    { "request": "requests/recipe.json", "out": "recipe.html", "report": "recipe-report.json" },
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
| mui1 / mui2 | Widget.addTooltip、tooltipBuilder / tooltipDynamic、RichTooltip | 文字、宽度与阴影。富文本 drawables 和事件装饰用原帧 |
| waila | getWailaHead / Body / Tail | HUD、多列、配置配色，可导入块图标。自定义渲染用原帧 |
| scanner / chat | GT getInfoData / getExtraInfoData、BehaviourScanner | 另有 machine-scanner，用于主机自定义纯文本。已存报告支持分节与分页，聊天支持换行 |
| text | Minecraft FontRenderer、Angelica 批处理字体、TST Style | 无边框文字和可复现的多色效果 |
| guide / vanilla | GuideNH 悬停文字、GuiScreen 悬停 | 文字草稿与原版边框。GuideNH 组件最终效果用原帧 |

字体直接导入当前客户端 JAR、Angelica JAR 和可选字体资源包 ZIP。工具包内没有复制游戏字体。整框像素对照还受游戏背景、鼠标高亮、实际动画相位、采样舍入和第三方自定义绘制影响。实机 PNG 对照可以独立导入。

GT 配方材料中的化学式可能使用 GT 的私用区字形。把客户端实际加载的 GregTech JAR 放入 `files.fonts`，顺序在 Minecraft JAR 之后，以加载 GT 的 `glyph_sizes.bin` 和对应 Unicode 图集。

实现对照 Minecraft 1.7.10 的 FontRenderer、[Angelica 2.2.43 字体渲染](https://github.com/GTNewHorizons/Angelica/tree/2.2.43/src/main/java/com/gtnewhorizons/angelica/client/font)、[Chromatic Tooltips 1.0.36-GTNH](https://github.com/GTNewHorizons/ChromaticTooltips/tree/1.0.36-GTNH) 和 [GT5-Unofficial 5.09.54.265](https://github.com/GTNewHorizons/GT5-Unofficial/tree/5.09.54.265) 的常规路径。
