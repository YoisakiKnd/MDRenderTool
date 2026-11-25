# UI 交互设计与四大导出系统规范 (`UI_AND_EXPORT.md`)

> 本文档定义 MDRenderTool 的界面视觉规范、交互细节、本地持久化机制以及四大懒加载导出模块的具体实现方案。

---

## 1. 界面视觉风格与 `shadcn-svelte` 选型

### 1.1 美学定位
对标 **Linear / Notion / Typora** 的极致克制与现代感：
- **配色系统**：中性灰度底色（Slate / Zinc 系）+ 单一克制主强调色（Indigo / Blue），高对比度、低视觉噪音，突出文字与图表内容本身。
- **亮 / 暗双主题**：通过 `<html class="dark">` 切换，所有组件、CodeMirror 编辑器、代码高亮、以及自研 SVG 图表全部由 CSS 变量驱动，**零闪烁瞬切**，默认跟随系统并记住用户选择。
- **shadcn-svelte 按需组件清单**（仅安装用到的极简原语至 `src/lib/components/ui/`）：
  - `Button`, `DropdownMenu`, `Dialog`, `Tooltip`, `Tabs`, `Separator`, `ScrollArea`（仅侧边栏使用；主预览区使用自研虚拟滚动，绝不套第三方滚动容器）

### 1.2 页面四区骨架布局

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ Toolbar (44px)                                                          │
│ [≡ 侧栏] [📄 文档标题 ●] [打开][保存]   [仅编辑|双栏|仅预览]   [排版][☀/🌙][导出▾]│
├───────────────┬────────────────────────────┬────────────────────────────┤
│ Sidebar       │ EditorPane (CodeMirror 6)  │ PreviewPane (Virtual List) │
│ (可折叠 240px) │                            │                            │
│ [大纲 | 草稿]  │ 1  # 架构设计               │   架构设计                  │
│  ├ 1. 概述     │ 2  ```mermaid              │   ┌────────────────────┐   │
│  ├ 2. 渲染管线 │ 3  sequenceDiagram         │   │  [SVG 图表] [🔍📋⬇] │   │
│  └ 3. 导出     │ 4    A->>B: Hello          │   └────────────────────┘   │
│               │ 5  ```                     │   这是带脚注的正文[1]       │
│               │                            │      └─ Hover 悬浮脚注卡    │
├───────────────┴────────────────────────────┴────────────────────────────┤
│ StatusBar (24px): 行 42, 列 12 | 3,280 字 | 184 块 | 渲染 4.2ms | 已自动保存 │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.3 关键交互体验细节
1. **可拖拽分栏分隔条**：双栏模式下中间 4px 拖动条（Hover 高亮），支持 25% ~ 75% 自由调节，双击恢复 50/50，宽度比例自动持久化到 IndexedDB `settings`。
2. **三套内置阅读排版风格（`src/styles/prose.css`）**：
   - `Minimal`（默认，清爽 Notion 风，舒展行高 1.75）
   - `GitHub`（紧凑经典技术文档风）
   - `Document`（衬线/正式文档风，适合长文阅读与导出 PDF）
3. **图表块悬浮微工具栏（`DiagramBlock.svelte`）**：
   - 仅鼠标移入图表区域时淡入右上角半透明浮条：
     - **全屏查看（`DiagramLightbox.svelte`）**：支持滚轮缩放（25% ~ 400%）、鼠标拖拽平移、一键适应屏幕、`ESC` 关闭。
     - **复制 SVG 源码**（带“已复制”轻提示）。
     - **单图导出高清 PNG**（2x / 3x DPI，透明或当前主题背景）。
4. **脚注悬浮预览**：
   - 正文脚注角标 `[1]` 悬停或点击时，在附近弹出轻量气泡卡片展示完整脚注内容；点击气泡内「跳转至定义行」可将编辑器定位到对应行。
5. **TOC 大纲同步**：
   - 实时高亮当前阅读所在章节；点击 TOC 条目同时将**预览区虚拟列表**与**CodeMirror 6 编辑器**精准滚动至对应标题行。
6. **核心快捷键**：
   - `Cmd/Ctrl + S`：保存本地文件（已绑定句柄直接覆写，否则触发另存为 `.md`）
   - `Cmd/Ctrl + O`：打开本地 `.md` 文件
   - `Cmd/Ctrl + B` / `I` / `K` / `` ` ``：编辑器内加粗 / 斜体 / 链接 / 行内代码
   - `Cmd/Ctrl + \`：切换左侧大纲栏显示/隐藏
   - `Cmd/Ctrl + Shift + P`：在仅编辑 / 双栏 / 仅预览间循环切换
   - `Cmd/Ctrl + E`：打开导出菜单

---

## 2. 编辑器与本地文件持久化规范

### 2.1 CodeMirror 6 最小化配置 (`EditorPane.svelte`)
仅组装必要扩展，绝不引入多余语言包：
- `lineNumbers()`, `highlightActiveLine()`, `history()`, `drawSelection()`, `bracketMatching()`, `foldGutter()`
- `markdown()`（仅做源码基础语法着色）
- `search()`（内置 `Cmd/Ctrl + F` 查找替换，支持超大文件极速搜索）
- 自定义精简亮/暗主题与正文字体（系统等宽字体栈，零外链字体）
- **文件拖拽导入**：直接将本地 `.md` / `.markdown` / `.txt` 文件拖入编辑器即打开；如拖入体积 > 10MB 的极端大文件，先弹窗确认。

### 2.2 本地草稿与文件读写 (`src/lib/storage/idb.ts`, `file-io.ts`)
- **自动防丢失**：编辑停止 1 秒后自动将当前文档写入 IndexedDB `documents` 表，状态栏显示「已自动保存」；刷新页面或关闭重开立刻恢复上次草稿与光标/滚动位置。
- **多草稿管理**：左侧边栏「草稿」Tab 支持新建文档、重命名、复制、删除、切换文档，首次打开内置一篇精美的 **Welcome & 功能演示文档**（包含 8 种自研图表、数学公式、表格、代码高亮、脚注示例，开箱即震撼体验）。
- **本地文件读写**：
  - 优先支持现代浏览器 **File System Access API**（`showOpenFilePicker` / `showSaveFilePicker`），可实现真正意义上的本地 `.md` 文件原地保存。
  - Safari / Firefox 自动优雅降级为 `<input type="file">` 读取 + `Blob` 下载保存。

---

## 3. 四大导出系统规范（全部独立 chunk 按需懒加载）

> **公共前置步骤 (`src/lib/export/export-utils.ts`)**：
> 由于预览区使用虚拟滚动，未滚动到的视口外图表可能尚未渲染。在执行 **HTML / PDF / PNG / DOCX** 全文导出前，必须先调用 `prepareAllBlocksForExport(blocks, onProgress)`：
> 1. 扫描所有 `kind === 'diagram'` 的块；
> 2. 依次查询 `L1 内存 LRU` → `L2 IndexedDB`；仅对未命中的块通过 Worker 并发限流（concurrency = 4）批量渲染；
> 3. 通过 `ExportDialog.svelte` 展示真实进度条（如「正在渲染图表 12 / 35...」），支持点击「取消」随时中止导出。
> 4. 提供 `inlineSvgThemeStyles(svg, themeMode)`：将当前主题计算后的 `--dg-*` CSS 变量静态固化到 SVG 内部 `<style>`，确保导出文件在任何外部查看器中色彩完整。

### 3.1 HTML 导出 (`src/lib/export/export-html.ts`)
- **目标**：生成一份**单文件自包含 `.html`**，双击离线打开即与预览区几乎一致，**零外部链接**。
- **实现**：
  1. 将 `prose.css`、`highlight.css`、当前主题 CSS 变量（固定为导出选项选中的 Light/Dark 主题）内联写入 `<style>`。
  2. 若文档包含 LaTeX 公式，将精简版 KaTeX CSS 内联（字体可选择保留自包含或内联关键样式，确保公式正确排版）。
  3. 顺序流式拼接所有块的 HTML 与固化样式后的内联 `<svg>`（使用 `string[]` + `new Blob(parts, { type: 'text/html;charset=utf-8' })` 避免大字符串反复拼接爆内存）。
  4. 可选勾选：「包含左侧可折叠目录导航」（注入 < 30 行原生轻量内联 `<script>` 实现点击跳转，零依赖）。

### 3.2 PDF 导出 (`src/lib/export/export-pdf.ts` + `src/styles/print.css`)
- **方案**：**原生矢量打印管线**（彻底杜绝 `html2canvas + jsPDF` 导致的文字模糊、无法复制、大文件崩溃）。
- **实现**：
  1. 预渲染所有离屏图表后，创建一个仅在打印时可见的离屏容器 `#mdrt-print-root`（或同源隐藏 `<iframe>`）挂载全量文档 HTML 与内联 SVG。
  2. `print.css` 精细排版规则：
     - `@page { size: A4; margin: 16mm 14mm; }`
     - 打印时强制隐藏 Toolbar / Sidebar / Editor / StatusBar / 图表悬浮按钮，仅展示 `#mdrt-print-root` 且强制采用白底高对比度打印配色（也可提供“保留暗色背景”开关，开启 `print-color-adjust: exact`）。
     - `h1, h2, h3 { break-after: avoid; }`（防标题孤立在页底）。
     - `.mdrt-diagram, pre, table, blockquote { break-inside: avoid; }`（防图表/表格/代码块被硬生生从中间腰斩）。
     - 自动在打印完毕（`afterprint` 事件）后立即清空并销毁 `#mdrt-print-root`，**瞬时回收全部临时 DOM 内存**！

### 3.3 PNG 导出 (`src/lib/export/export-png.ts`)
拆分两个实用入口：
1. **单张图表高清 PNG 导出**（图表悬浮条一键触发）：
   - 固化 SVG 主题变量 → 构造 `Blob('image/svg+xml')` → 绘制至 `2x`（可选 `3x`）分辨率 `<canvas>` → `canvas.toBlob('image/png')` 下载 → 立即 `URL.revokeObjectURL` 并置空 canvas 尺寸释放显存。
2. **整篇文档导出 PNG（防 Canvas 超限崩溃方案）**：
   - 浏览器 `<canvas>` 存在硬性最大高度限制（Chrome/Safari 通常约 `16,384px` 或总像素上限，直接截 5 万行长文必黑屏或崩溃）。
   - **安全实现**：
     - 在隐藏沙箱容器中按固定纸张宽度（默认 `960px`，DPI `2x`）依次测量块高度并**自动按页分组**（每页逻辑高度 ≤ `4,000px`，确保 `2x` 物理高度 ≤ `8,000px`，远低于浏览器安全线，且绝不在图表或代码块中间切断）。
     - 利用 SVG `<foreignObject>` + 内联样式逐页光栅化到 Canvas 生成 PNG `Blob`（注意处理内嵌图表的直接绘制，避免跨域污染 canvas；由于本项目 100% 同源无外链图片，Canvas 天然干净无 taint 问题！）。
     - **单页文档**：直接下载 `.png`。
     - **多页长文档**：懒加载 `fflate`（~8KB）将 `page-01.png, page-02.png, ...` 无压缩/轻压缩打包为一个 `.zip` 下载，并用进度条逐页释放内存（每画完一页立刻销毁该页 Canvas）。

### 3.4 DOCX 导出 (`src/lib/export/export-docx.ts`)
- **策略**：仅在用户点击「导出 DOCX」时通过 `await import('docx')` 动态加载（同时受益于 Service Worker 缓存，二次导出无需重新下载）。
- **Markdown → 原生 OOXML 映射规则**：
  - **标题 `H1`~`H6`** → Word 原生 `HeadingLevel.HEADING_1..6`（打开 Word 自动生成左侧导航大纲）。
  - **段落与行内样式** → `Paragraph` + `TextRun`（精准还原 **加粗**、*斜体*、~~删除线~~、`行内代码`浅灰底色、超链接 `ExternalHyperlink`）。
  - **无序/有序/任务列表** → Word 原生多级项目符号/编号列表（任务列表带 `☑` / `☐`）。
  - **引用块（Blockquote）** → 左侧蓝色竖线边框 + 缩进 + 淡灰底色段落。
  - **GFM 表格** → Word 原生 `Table` / `TableRow` / `TableCell`（表头加粗浅底色、细灰边框、自动列宽）。
  - **代码块** → 等宽字体（Consolas / Courier New）+ 浅灰背景框 + 保留缩进换行。
  - **8 种图表（Mermaid / PlantUML）** → 复用单图导出管道将固化浅色主题的 SVG 转为 `2x` 高清 PNG `Uint8Array`，通过 `ImageRun` 按 Word 页面可用宽度（~600px）等比缩放嵌入，不失真不溢出。
  - **LaTeX 数学公式** → 优先将渲染好的 KaTeX 区块转为高清 PNG 嵌入（或单行文本/图片混排），确保在 WPS / Microsoft Word / Pages 里 100% 显示不乱码。
  - **脚注** → 映射为 Word 原生 `Footnotes` 与 `FootnoteReferenceRun`！
- **内存释放**：每张图片 `Uint8Array` 在 `Packer.toBlob(doc)` 生成完毕后解除引用，防止大文档导出后内存滞留。
