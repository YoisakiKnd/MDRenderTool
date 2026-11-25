# 分阶段开发任务书与验收标准 (`TASKS.md`)

> 本文档将整个项目拆分为 **7 个可独立构建、独立验收的里程碑（Milestone 1 ~ 7）**。
> **强制开发纪律**：GPT 每次只聚焦完成**一个 Milestone**，在该阶段所有单元测试、类型检查和生产构建全部通过前，禁止跳入下一个阶段；绝不允许留 `TODO` 假实现或引入白名单之外的重型包。

---

## Milestone 1：工程脚手架、Svelte 5 + shadcn-svelte 底座与三层缓存基础设施

### 目标交付物
1. 初始化 **Vite 6 + Svelte 5 + TypeScript (strict) + Tailwind CSS v4 + Vitest** 项目。
2. 按需初始化 **`shadcn-svelte`**（`Button`, `DropdownMenu`, `Dialog`, `Tooltip`, `Tabs`, `Separator`）与 `lucide-svelte`，实现亮/暗主题 CSS 变量系统（含 `--dg-*` 图表变量）与 `src/styles/prose.css`（Minimal / GitHub / Document 三套排版主题）、`src/styles/highlight.css`。
3. 实现基础核心数据结构与单元测试（`tests/`）：
   - `src/lib/core/hash.ts`（FNV-1a 哈希）
   - `src/lib/core/lru.ts`（带条数 + 字节数双上限与淘汰回调的 LRU 缓存）
   - `src/lib/core/fenwick.ts`（树状数组前缀和 + `O(log N)` 偏移二分查找）
4. 配置 `vite.config.ts` 手动分包（`manualChunks`）、过滤 KaTeX 非 `woff2` 字体插件、以及构建后自动生成 `dist/asset-manifest.json` 的轻量 Vite 插件。
5. 实现 `public/sw.js`（自托管极简 Service Worker：App Shell Network-First + `/assets/*` Immutable Cache-First + 旧版本清理）与 `src/lib/storage/sw-register.ts`。
6. 输出部署缓存头与严格 CSP 模板：`deploy/nginx.conf`、`deploy/_headers`。

### 验收标准
- [ ] `pnpm test` 全部通过（`hash`, `lru`, `fenwick` 覆盖边界测试）。
- [ ] `pnpm run check`（`svelte-check` / `tsc --noEmit`）0 错误。
- [ ] `pnpm run build` 成功，生成 `dist/asset-manifest.json`，检查 `dist/` 中**零外部 URL（无 CDN、无 Google Fonts）**。

---

## Milestone 2：Web Worker 解析管线、轻量代码高亮、KaTeX 与虚拟滚动双栏联动

### 目标交付物
1. `src/lib/core/protocol.ts`（强类型主线程 ↔ Worker 通信协议）。
2. `src/lib/worker/highlighter.ts`（自研规则表驱动词法高亮器，支持 15+ 常见语言，防 ReDoS，超大代码块自动降级）+ 单元测试。
3. `src/lib/worker/markdown-parser.ts` + `src/lib/worker/math-renderer.ts` + `src/lib/worker/render.worker.ts`：
   - `markdown-it` + `markdown-it-footnote` 分块解析、行号 `[startLine, endLine]` 映射、内容哈希与块级增量 Diff（未变块 `unchanged: true`）。
   - TOC 标题树提取 + 脚注映射表 `footnotes` 提取。
   - 数学公式（`$...$` / `$$...$$`）按需动态 `import('katex')`，无公式文档零加载。
4. `src/lib/components/EditorPane.svelte`（CodeMirror 6 最小扩展集 + 快捷键 + 拖拽导入文件）。
5. `src/lib/components/PreviewPane.svelte` + `src/lib/core/scroll-sync.ts`：
   - 基于 `FenwickTree` 的虚拟滚动预览器 + `ResizeObserver` 动态测高 + 视口上方高度变化滚动锚定（防跳动）。
   - Editor ↔ Preview `O(log N)` 双向精确同步滚动（带防循环锁）。
   - 正文脚注角标 Hover 气泡预览 + 文末脚注区。
6. 拼装基础 `App.svelte`（Toolbar 视图切换、可拖拽分栏、Sidebar TOC 联动跳转、StatusBar 实时统计字数/行数/块数/解析耗时）。

### 验收标准
- [ ] 在测试脚本中构造 **30,000 行大 Markdown 文档**，Worker 解析 + 虚拟渲染后 DOM 中挂载块数量始终 ≤ 60 个，滚动丝滑不卡顿。
- [ ] 仅写纯文本时，Network 面板确认**未请求 KaTeX chunk**；输入 `$E=mc^2$` 后自动按需加载 KaTeX 并正确渲染。
- [ ] 双向同步滚动与点击 TOC 跳转准确；脚注悬停弹窗内容正确。

---

## Milestone 3：图表微内核、共享布局算法与前 3 种高频图（时序 / 流程 / 思维导图）

### 目标交付物
1. 图表微内核基础设施：
   - `src/lib/diagrams/types.ts`, `detector.ts`, `registry.ts`, `text-metrics.ts`（CJK 宽字符感知）, `svg-builder.ts`（安全转义 + 主题变量）。
2. 两大核心布局引擎 + 严格算法单元测试：
   - `src/lib/diagrams/layouts/sugiyama.ts`（方向归一化、DFS 去环、最长路径分层、虚拟节点、Barycenter 交叉最小化、坐标分配、贝塞尔边路由与子图包围盒）。
   - `src/lib/diagrams/layouts/tree.ts`（Reingold-Tilford 左右均衡思维导图树布局）。
3. 实现首批 3 个高频图微引擎（均同时支持 Mermaid 与 PlantUML 常用语法）：
   - `src/lib/diagrams/engines/sequence/`（时序图）
   - `src/lib/diagrams/engines/flowchart/`（流程图 / 活动图 / 子图）
   - `src/lib/diagrams/engines/mindmap/`（思维导图）
4. 打通 Worker 图表渲染调度 + 主线程 `L1 内存 LRU` + `L2 IndexedDB diagram_cache` + 快速滚动 `CANCEL_DIAGRAMS` 取消机制。
5. 实现 `DiagramBlock.svelte`（加载骨架、SVG 展示、右上角悬浮工具条、冷门/错误优雅降级卡片）与 `DiagramLightbox.svelte`（滚轮缩放 + 拖拽平移全屏查看器）。

### 验收标准
- [ ] `detector`、`text-metrics`、`sugiyama`、`tree` 及 3 个引擎的 Mermaid + PlantUML 解析与 SVG 输出全部通过 Vitest 单元测试（含中英文混排、环图、自环、嵌套子图、不支持语法用例）。
- [ ] `pnpm run build` 检查 `diagram-sequence`、`diagram-flowchart`、`diagram-mindmap`、`diagram-layout-dag` 均为**独立懒加载 chunk**。
- [ ] 同一文档仅含时序图时，Network 面板绝不加载流程图/思维导图 chunk；切换亮暗主题时 SVG 配色实时无闪烁更新。

---

## Milestone 4：补齐其余 5 种图表微引擎（类图 / 状态图 / ER 图 / 甘特图 / 饼图）

### 目标交付物
严格遵循 `docs/DIAGRAM_ENGINE.md` 规格，实现以下 5 个独立懒加载图种微引擎（均支持 Mermaid + PlantUML 约定语法，并补齐单元测试）：
1. `src/lib/diagrams/engines/class/`（复用 `sugiyama`，UML 三段式类盒 + 6 种关系箭头与多重性）
2. `src/lib/diagrams/engines/state/`（复用 `sugiyama`，起止实心/双圈状态 + 复合嵌套状态）
3. `src/lib/diagrams/engines/er/`（复用 `sugiyama`，实体表属性 PK/FK 徽标 + 鸦爪 Crow's Foot 符号）
4. `src/lib/diagrams/engines/gantt/`（日期/依赖解析 + 分组时间轴 + 里程碑）
5. `src/lib/diagrams/engines/pie/`（现代饼图/环形图 + 占比标签 + 图例）

### 验收标准
- [ ] 8 种图表在亮/暗双主题下无文字截断、无重叠、无 XSS 漏洞。
- [ ] 全部 8 种图表各有独立 chunk，且对应 Vitest 用例全绿。
- [ ] 输入未支持语法（如 Mermaid `gitGraph` 或 PlantUML `!include`）正确展示优雅降级提示卡片与折叠源码，不报错不崩页面。

---

## Milestone 5：本地文件 I/O、IndexedDB 多草稿管理与 UI 体验精修

### 目标交付物
1. `src/lib/storage/idb.ts`（完整实现 `documents`、`settings`、`diagram_cache` 三表与有界 LRU 清理）。
2. `src/lib/storage/file-io.ts`（File System Access API 打开/原地保存 + 跨浏览器降级导入导出 + 拖拽打开大文件保护提示）。
3. `Sidebar.svelte` 补全「草稿」Tab（新建、重命名、复制、删除、切换、未保存状态圆点、自动草稿保存）。
4. 编写一篇高颜值内置 **Welcome 演示文档**（集中展示 Markdown、LaTeX 公式、代码高亮、脚注与全部 8 种自研 Mermaid/PlantUML 图表）。
5. 完善全部快捷键（`Cmd/Ctrl+S/O/B/I/K/E/\` 等）、阅读排版风格切换（Minimal / GitHub / Document）、专注模式、以及 Service Worker 新版发现轻提示条。

### 验收标准
- [ ] 刷新浏览器后，上次编辑草稿、主题、排版风格、分栏宽度 100% 自动恢复。
- [ ] 再次加载同一份含多张图表的文档时，图表直接命中 IndexedDB `diagram_cache` 毫秒级渲染。

---

## Milestone 6：四大懒加载导出系统（HTML / PDF / PNG / DOCX）

### 目标交付物
1. `src/lib/export/export-utils.ts`（视口外图表并发预渲染队列 + 进度条 + 取消支持 + SVG 主题样式固化）。
2. `src/lib/export/export-html.ts`（单文件自包含 HTML，可选带折叠 TOC，零外链）。
3. `src/lib/export/export-pdf.ts` + `src/styles/print.css`（原生矢量打印容器 + 分页防腰斩 + 打印完即刻销毁临时 DOM 回收内存）。
4. `src/lib/export/export-png.ts`（单图 2x/3x 高清 PNG + 全文防 Canvas 溢出自动分页，多页懒加载 `fflate` 打 ZIP）。
5. `src/lib/export/export-docx.ts`（懒加载 `docx`，完整映射标题/样式/表格/代码块/原生脚注/2x 图表 PNG/公式）。
6. `ExportDialog.svelte`（格式选择、主题/DPI 选项、实时进度条、取消按钮）。

### 验收标准
- [ ] 正常编辑页面加载时，Network 面板确认**未下载 `vendor-docx` 与导出模块**。
- [ ] 四种格式（HTML / PDF / PNG / DOCX）均成功导出并可正常打开查看，包含全部图表（含未滚到过的离屏图表）、公式、代码高亮与脚注，无空白占位符。

---

## Milestone 7：极限性能压测、缓存验证与最终交付体检

### 目标交付物
1. 编写超大文档压测脚本/内置测试入口（如生成 50,000 行含 80 张混合图表与数学公式的 `.md` 压测文件）。
2. 核查并优化构建产物体积、首屏 chunk 大小、Worker 取消队列、内存泄漏（反复切换文档 20 次无 Heap 持续上涨）。
3. 本地预览生产构建（`pnpm run preview`）完整验证 Service Worker 离线模式与零外部请求 CSP 合规性。
4. 编写精简清晰的项目 `README.md`（启动、构建、部署与缓存配置说明）。

### 验收标准
- [ ] 所有单测通过、`svelte-check` 0 警告/0 错误、`pnpm run build` 成功。
- [ ] 首屏核心 gzip 体积、超大文件流畅度、零外部请求、二次访问 SW 零重下包全部达标。
