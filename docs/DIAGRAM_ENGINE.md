# 自研按图种拆分图表引擎规范 (`DIAGRAM_ENGINE.md`)

> 本文档定义 MDRenderTool 的**核心亮点模块**：不依赖 `mermaid` / `@plantuml/core` 巨无霸，通过**方言适配 → 统一 IR → 按图种懒加载微引擎**，在 Web Worker 内以纯 TypeScript 完成解析、布局与高颜值 SVG 绘制。

---

## 1. 设计原则与核心接口

1. **按图种拆分 chunk**：每个图种位于 `src/lib/diagrams/engines/<type>/`，通过 `registry.ts` 动态 `import()` 加载，互不依赖，单模块压缩体积目标 **5 KB ~ 25 KB**。
2. **Worker 完全安全（零 DOM 依赖）**：严禁调用 `document.createElement`、`getBBox()`、`window`。全部文本测量由 `text-metrics.ts` 纯数学计算完成，SVG 由 `svg-builder.ts` 纯字符串拼接输出（严格 XML 转义防 XSS）。
3. **干净的 Clean-room 实现**：依据公开的 Mermaid / PlantUML 语法规范与标准图论布局算法（Sugiyama、Reingold-Tilford）独立编写 TypeScript，无 GPL 污染。
4. **冷门语法优雅降级**：解析失败或遇到未收录语法时，绝不抛未捕获异常阻塞文档渲染，必须返回结构化 `status: 'unsupported' | 'error'` + 清晰中文原因。

### 核心接口 (`src/lib/diagrams/types.ts`)

```ts
export type DiagramType =
  | 'sequence'
  | 'flowchart'
  | 'class'
  | 'state'
  | 'er'
  | 'mindmap'
  | 'gantt'
  | 'pie';

export type DiagramDialect = 'mermaid' | 'plantuml' | 'generic';

export interface DiagramRenderResult {
  status: 'ok' | 'unsupported' | 'error';
  diagramType?: DiagramType;
  svg?: string;
  width?: number;
  height?: number;
  /** 不支持或语法错误时的可读提示 */
  reason?: string;
  /** 错误定位行（可选，1-based 相对代码块内部） */
  errorLine?: number;
}

export interface DiagramEngine<TIR = unknown> {
  readonly type: DiagramType;
  readonly version: string; // 用于 IndexedDB 缓存失效版本号，如 "1.0"
  parse(source: string, dialect: DiagramDialect): TIR;
  render(ir: TIR, options: { themeMode: 'light' | 'dark' }): {
    svg: string;
    width: number;
    height: number;
  };
}
```

### 动态注册表 (`src/lib/diagrams/registry.ts`)

```ts
const engineLoaders: Record<DiagramType, () => Promise<{ default: DiagramEngine }>> = {
  sequence: () => import('./engines/sequence/index'),
  flowchart: () => import('./engines/flowchart/index'),
  class: () => import('./engines/class/index'),
  state: () => import('./engines/state/index'),
  er: () => import('./engines/er/index'),
  mindmap: () => import('./engines/mindmap/index'),
  gantt: () => import('./engines/gantt/index'),
  pie: () => import('./engines/pie/index'),
};
```

> 预留扩展槽位：`registerCustomEngine(type, loader)`，方便未来按需挂接新图种或可选外部适配器。

---

## 2. 极轻图种与方言识别器 (`src/lib/diagrams/detector.ts`)

输入 `(fenceLang, source)`，在 `< 0.1ms` 内输出 `{ dialect, type | 'unsupported', reason? }`：

| 判定规则（去空行与注释后检查前 15 行特征） | Dialect | 路由图种 (`DiagramType`) |
| :--- | :--- | :--- |
| `fenceLang` 直接等于 8 种图名之一 | `generic` | 对应图种 |
| 首行匹配 `sequenceDiagram` | `mermaid` | `sequence` |
| 首行匹配 `(flowchart\|graph)\s+(TB\|TD\|BT\|LR\|RL)?` | `mermaid` | `flowchart` |
| 首行匹配 `classDiagram` | `mermaid` | `class` |
| 首行匹配 `stateDiagram(-v2)?` | `mermaid` | `state` |
| 首行匹配 `erDiagram` | `mermaid` | `er` |
| 首行匹配 `mindmap` | `mermaid` | `mindmap` |
| 首行匹配 `gantt` | `mermaid` | `gantt` |
| 首行匹配 `pie(\s+showData)?` | `mermaid` | `pie` |
| `@startmindmap` 或 `@startwbs` | `plantuml` | `mindmap` |
| `@startgantt` | `plantuml` | `gantt` |
| `@startuml` 且包含 `class ` / `interface ` / `abstract ` / `enum ` | `plantuml` | `class` |
| `@startuml` 且包含 `entity ` 或 `\|\|--` / `}o--` | `plantuml` | `er` |
| `@startuml` 且包含 `\[\*\]\s*-->` 或 `state ` | `plantuml` | `state` |
| `@startuml` 且包含 `start` / `stop` / `if (` / `:...;`（活动图）或 `rectangle`/`node` + `-->` | `plantuml` | `flowchart` |
| `@startuml` 且包含 `participant`/`actor` 或 `A -> B:` / `A --> B:`（时序箭头） | `plantuml` | `sequence` |
| `@startuml` 但包含 `!include` / `salt` / `nwdiag` / `archimate` 等未收录块，或其他未知 Mermaid 图（如 `gitGraph`, `sankey-beta`, `quadrantChart`） | 对应方言 | `unsupported`（返回明确原因） |

---

## 3. 共享底层能力

### 3.1 Worker 安全文本测量 (`src/lib/diagrams/text-metrics.ts`)
- 提供 `measureText(text: string, fontSize: number, bold?: boolean): { width: number; height: number; lines: string[] }`。
- 精确区分字符宽幅系数：
  - 窄字符（`i l I t f r j 1 . , : ; | '`）：`0.35 * fontSize`
  - 常规 ASCII / 数字：`0.58 * fontSize`
  - 宽 ASCII（`W M @ % # &`）：`0.82 * fontSize`
  - **CJK 中日韩全角字符与全角标点**（`[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]`）：`1.02 * fontSize`
  - 粗体额外乘以 `1.06`；末尾加安全余量 `+4px` 防文字贴边裁切。
- 支持 `\n` 和 `<br/>` 显式换行，以及超过 `maxWidth` 时的自动折行（支持英文按词折行 + 中文按字折行）。

### 3.2 共享分层有向图布局核 (`src/lib/diagrams/layouts/sugiyama.ts`)
为 **Flowchart、Class、State、ER** 四个图种共享，输入标准有向图 `{ nodes, edges, groups?, direction: 'TB'|'BT'|'LR'|'RL', nodeSep, rankSep }`，输出每个节点的 `(x, y, width, height)`、每条边的控制点路径 `points: Point[]`、以及子图包围盒 `groupBoxes`：

算法 5 步走（清晰且易单测验证）：
1. **方向归一化**：内部统一按 `TB`（自上而下）计算；若为 `LR`/`RL` 先交换输入节点 `width/height`，算完后再做坐标转置/镜像。
2. **去环（Cycle Breaking）**：DFS 检测回边（back-edges），临时翻转方向使其成为 DAG（记录 `reversed: true` 以便绘制阶段恢复真实箭头方向）；自环（`u === v`）单独提取，绘制为节点侧边贝塞尔回环。
3. **分层（Layering）**：采用最长路径分层（Longest-Path Rank Assignment）+ 简单紧缩优化，保证所有边严格由上层指向下层。
4. **虚拟节点与交叉最小化（Crossing Minimization）**：
   - 跨多层边（`rank(v) - rank(u) > 1`）在中间层插入宽高为 0 的 Dummy Node，确保边平滑绕开中间层节点。
   - 连续 4~6 轮上下交替 **Barycenter（重心法）排序**，显著减少连线交叉。
5. **坐标分配与边路由（Coordinate Assignment & Edge Routing）**：
   - 同层节点按居中对齐并维持 `nodeSep` 间距，层间距 `rankSep`。
   - 若存在子图/分组（`subgraph` / `package` / `composite state`），在同层排序时给同组节点增加亲和权重，最后计算组内节点包围盒并加内边距（`padding: 20px` + 标题栏高度）。
   - 每条边从源节点边界锚点出发，经 Dummy Node 生成平滑 **三次贝塞尔曲线 / 圆角折线**，同时计算边标签中点坐标（避开节点矩形）。

### 3.3 共享树形布局核 (`src/lib/diagrams/layouts/tree.ts`)
为 **Mindmap** 使用，实现经典 **Reingold-Tilford 紧凑树布局**：
- 支持 **左右双向发散布局**（根节点居中，一级分支交替或按权重分列左右两侧，符合现代思维导图审美）与 **单向右侧树布局**。
- 节点间以平滑水平三次贝塞尔曲线连接（`C cx1 y1, cx2 y2, x2 y2`），按层级赋予柔和区分色系。

### 3.4 统一 SVG 主题变量规范 (`src/lib/diagrams/svg-builder.ts`)
所有渲染生成的 `<svg>` 统一绑定语义化 CSS 变量（并在 `<svg>` 上带 `class="mdrt-diagram"`、`viewBox="0 0 W H"`、显式 `width` / `height` 便于缩放与导出）：
- `--dg-bg`: 背景（透明或微淡卡片底）
- `--dg-node-bg`, `--dg-node-border`, `--dg-node-text`
- `--dg-accent`, `--dg-accent-soft`
- `--dg-edge-color`, `--dg-edge-label-bg`
- `--dg-group-bg`, `--dg-group-border`
- `--dg-note-bg`, `--dg-note-border`
- `--dg-palette-1` ~ `--dg-palette-8`（供饼图、思维导图分支、甘特图分组使用，亮/暗主题均做过对比度调优）

> **导出关键点**：在 HTML/PNG/DOCX 导出时，工具函数自动将当前激活主题的上述 CSS 变量内联写入 `<svg><style>:root{...}</style>`，确保脱离主页面后依然色彩完美！

---

## 4. 八大自研图种详细规格与语法支持矩阵

### 4.1 时序图 (`sequence`)
- **统一 IR (`SequenceIR`)**：
  `{ title?, participants: { id, label, kind: 'participant'|'actor'|'database' }[], items: Array<Message | Note | FragmentBlock | Divider> }`
- **支持语法**：
  - **Mermaid (`sequenceDiagram`)**：`participant A as 别名`、`actor U`、箭头 `->` / `-->` / `->>` / `-->>` / `-x` / `--x`、激活 `activate`/`deactivate` 及简写 `+`/`-`、`Note left of` / `Note right of` / `Note over A,B`、`loop` / `alt` / `else` / `opt` / `par` / `and` / `end`、`autonumber`。
  - **PlantUML (`@startuml`)**：`participant` / `actor` / `database` / `as`、`->` / `-->` / `->o` / `<-`、`activate`/`deactivate`、`note left/right/over ... end note`、`alt`/`else`/`opt`/`loop`/`group`/`end`、`== 分隔线 ==`、`autonumber`。
- **布局与视觉**：顶部与底部双参与者卡片（支持人形 Actor 图标、圆柱 Database 图标），纵向虚线生命线，激活条矩形高亮，消息自调用回环，嵌套片段带左上角五边形标签框。

### 4.2 流程图 / 有向图 (`flowchart`)
- **统一 IR (`GraphIR`)**：
  `{ direction: 'TB'|'BT'|'LR'|'RL', nodes: { id, label, shape: 'rect'|'round'|'stadium'|'diamond'|'circle'|'cylinder'|'hexagon'|'subroutine' }[], edges: { from, to, label?, lineStyle: 'solid'|'dashed'|'thick', arrowStart?, arrowEnd? }[], subgraphs: { id, label, nodeIds }[] }`
- **支持语法**：
  - **Mermaid (`flowchart` / `graph`)**：方向 `TD/TB/BT/LR/RL`；节点形状 `[矩形]` / `(圆角)` / `([胶囊])` / `{菱形}` / `((圆形))` / `[(数据库)]` / `{{六边形}}` / `[[子流程]]`；边 `-->` / `---` / `-.->` / `==>` / `<-->`、边标签 `-->|文本|` 与 `-- 文本 -->`；链式连写 `A --> B --> C`、`A & B --> C`；`subgraph id [标题] ... end`；`style` / `classDef` 基础配色。
  - **PlantUML**：简易活动图（`start` / `stop` / `:动作;` / `if (条件) then (是) ... else (否) ... endif` / `while (...)`）与节点关系图（`rectangle` / `component` / `database` / `cloud` + `-->` / `..>` + `: 标签`）。
- **布局引擎**：复用 `layouts/sugiyama.ts`。

### 4.3 类图 (`class`)
- **统一 IR (`ClassIR`)**：
  `{ classes: { id, name, stereotype?, members: { visibility: '+'|'-'|'#'|'~'|'', text, kind: 'field'|'method' }[] }[], relations: { from, to, label?, fromCard?, toCard?, kind: 'inheritance'|'realization'|'composition'|'aggregation'|'association'|'dependency' }[], packages: { id, label, classIds }[] }`
- **支持语法**：
  - **Mermaid (`classDiagram`)**：`class Foo { +int id \n +getName() string }`、`Foo : +bar()`、`<<interface>>` / `<<abstract>>`、6 种 UML 关系箭头（`<|--`, `<|..`, `*--`, `o--`, `-->`, `..>`）与多重性标签（`"1" --> "*"`）、`namespace`。
  - **PlantUML**：`class` / `interface` / `abstract class` / `enum` 块语法、成员可见性 `+/-/#/~`、6 种 UML 箭头（`<|--`, `<|..`, `*--`, `o--`, `-->`, `..>`）、`package`。
- **布局引擎**：复用 `layouts/sugiyama.ts`；节点渲染为标准三段式 UML 类盒（标题区含构造型 / 属性区 / 方法区），精准绘制空心三角、实心/空心菱形端头。

### 4.4 状态图 (`state`)
- **统一 IR (`StateIR`)**：
  `{ direction, states: { id, label, kind: 'normal'|'start'|'end'|'fork'|'choice', description?, children?: StateIR }[], transitions: { from, to, label? }[] }`
- **支持语法**：
  - **Mermaid (`stateDiagram` / `stateDiagram-v2`)**：`[*]` 起止实心/双圈状态、`s1 --> s2 : 事件`、`state "描述" as s1`、复合嵌套状态 `state Composite { ... }`、`note right of`。
  - **PlantUML**：`[*]` 起止状态、`state "名称" as s1`、`s1 : 描述`、`s1 --> s2 : 条件`、嵌套状态块。
- **布局引擎**：复用 `layouts/sugiyama.ts`（支持复合状态包围盒）。

### 4.5 ER 实体关系图 (`er`)
- **统一 IR (`ErIR`)**：
  `{ entities: { id, name, attributes: { type, name, key?: 'PK'|'FK'|'UK', comment? }[] }[], relations: { from, to, fromCard: CardType, toCard: CardType, identifying: boolean, label?: string }[] }`
- **支持语法**：
  - **Mermaid (`erDiagram`)**：实体属性块 `USER { int id PK "主键" }`、鸦爪符号（Crow's Foot）：`||`、`o|`、`}|`、`}o` 与 `--`（实线）/ `..`（虚线）组合 + `: 关系名`。
  - **PlantUML**：`entity "USER" as u { * id : int <<PK>> \n -- \n name : varchar }` 与鸦爪连线 `||--o{`。
- **布局引擎**：复用 `layouts/sugiyama.ts`；节点渲染为带 PK/FK 徽标的双列数据表卡片，边端精准绘制标准鸦爪（Crow's Foot）符号。

### 4.6 思维导图 (`mindmap`)
- **统一 IR (`TreeIR`)**：
  `{ root: TreeNode }`，其中 `TreeNode = { id, label, shape?: 'default'|'round'|'pill'|'cloud'|'bang', children: TreeNode[] }`
- **支持语法**：
  - **Mermaid (`mindmap`)**：基于缩进层级（2/4 空格或 Tab）构建树，支持 `((根))` / `(圆角)` / `[方框]` 形状标记。
  - **PlantUML (`@startmindmap` / `@startwbs`)**：基于 `*` / `**` / `***`（或 `+`/`-` 指定左右侧分支）构建树。
- **布局引擎**：`layouts/tree.ts`（Reingold-Tilford 左右双向均衡布局）。

### 4.7 甘特图 (`gantt`)
- **统一 IR (`GanttIR`)**：
  `{ title?, dateFormat, sections: { name, tasks: { id?, label, startDate: number, endDate: number, status?: 'done'|'active'|'crit'|'milestone' }[] }[] }`
- **支持语法**：
  - **Mermaid (`gantt`)**：`title`、`dateFormat YYYY-MM-DD`、`section 阶段名`、任务行 `任务名 :done, t1, 2026-01-01, 5d`（支持 `after t1` 依赖、时间单位 `d/w/h`、`milestone` 菱形里程碑）。
  - **PlantUML (`@startgantt`)**：`Project starts 2026-01-01`、`[任务A] lasts 5 days`、`[任务B] starts at [任务A]'s end`、`-- 阶段 --`。
- **布局与视觉**：左侧分组与任务标签列 + 右侧自适应时间网格刻度轴 + 圆角状态进度条 + 菱形里程碑 + 今日参考线（若在区间内）。

### 4.8 饼图 (`pie`)
- **统一 IR (`PieIR`)**：
  `{ title?, showData: boolean, slices: { label: string, value: number }[] }`
- **支持语法**：
  - **Mermaid (`pie`)**：`pie showData`、`title 标题`、`"分类名" : 42.5`。
- **布局与视觉**：采用高颜值现代环形/饼图（SVG Arc 路径），扇区内显示百分比（过小扇区自动隐藏防重叠），右侧纵向图例列出名称、原值与占比。

---

## 5. 降级提示卡片规范（Unsupported / Error）

当 `DiagramRenderResult.status !== 'ok'` 时，`DiagramBlock.svelte` 渲染一张柔和、不刺眼的圆角提示卡片：
- **Unsupported（暂未收录的冷门图表/语法）**：
  - 图标 + 标题：「暂不支持该图表类型/语法（`<detected>`）」
  - 副文案：`reason`（如：`"当前 V1 轻量内核暂未支持 Mermaid gitGraph / PlantUML !include 宏"`）
  - 可折叠按钮：「查看原始代码」（展开后以代码高亮展示源码，不丢失内容）。
- **Error（语法拼写错误）**：
  - 柔和琥珀/红色提示条，展示具体错误原因与 `errorLine` 行号，点击可让编辑器光标跳转至出错行！
