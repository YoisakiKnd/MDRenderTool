# MDRenderTool — 核心架构与工程总规范 (`SPEC.md`)

> 本文档是整个项目的**最高准则（Single Source of Truth）**。所有架构实现、依赖引入、缓存策略与代码编写必须严格遵守本规范中的红线约束。

---

## 1. 项目定位

**MDRenderTool** 是一款 **100% 纯前端、零后端、零外部第三方请求、极致低内存与高性能** 的网页版双栏实时 Markdown 编辑器与多图表渲染工具。

核心特性：
- **双栏实时编辑 + 预览**：CodeMirror 6 编辑器 + 自研虚拟滚动预览区 + 精确双向同步滚动。
- **按画图类型拆分的自研微引擎**：兼容 **Mermaid** 与 **PlantUML** 常用语法，通过「方言解析 → 统一 IR → 按图种独立微引擎（Web Worker 内计算布局并输出 SVG）」架构，首批支持 **8 种高频图表**（时序、流程、类、状态、ER、思维导图、甘特、饼图），冷门/未覆盖语法优雅降级提示。
- **全能技术文档排版**：GFM、LaTeX 数学公式（KaTeX）、自研超轻代码高亮、脚注（正文悬浮预览 + 文末列表）、可折叠目录大纲（TOC）。
- **四大导出能力**：HTML（单文件自包含）、PDF（原生矢量打印）、PNG（单图高清 + 长图防 Canvas 溢出自动切片）、DOCX（按需懒加载原生 Word 文档）。
- **超大文件支持**：面向万行级 / 多 MB 级文档设计，采用 Web Worker 全离线计算 + 块级增量 Diff + 虚拟列表挂载 + 有界 LRU 缓存。
- **极致本地缓存（二次打开免重下包）**：Immutable Hash 分包 + 自托管 Service Worker 持久化缓存 + IndexedDB 草稿与渲染结果缓存，支持离线访问。

---

## 2. 不可违背的工程红线（HARD RULES）

1. **严格零外部网络请求（Zero Third-Party Requests）**：
   - 禁止任何外部 CDN（禁止 jsDelivr、unpkg、cdnjs、Google Fonts、公共 kroki.io / plantuml.com）。
   - 所有 JS、CSS、WASM、图标、字体（正文/等宽/KaTeX `woff2`）**必须 100% 自托管打包在构建产物中**。
   - 生产环境必须可通过严格 CSP 校验：
     `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self';`
2. **禁止引入重型巨无霸依赖**：
   - **禁止**引入 `mermaid`、`@plantuml/core`、`monaco-editor`、`mathjax`、`shiki`（含 `onig.wasm`）、`html2canvas`、`jspdf`、`d3`、`cytoscape`、`elkjs`。
   - 任何新增 npm 依赖必须符合“实在没必要自己写且足够轻”的原则。
3. **主线程零阻塞原则**：
   - Markdown 解析、块切分、内容哈希、TOC/脚注提取、代码词法高亮、**8 种图表的解析/布局/SVG 生成** 全部运行在 **Web Worker** 中。
   - UI 主线程仅负责编辑器交互、虚拟列表 DOM 挂载与滚动同步。
4. **严格按需懒加载（Code Splitting）**：
   - 首屏初始化绝不加载未使用的图表微引擎、KaTeX、以及任何导出模块（HTML/PNG/DOCX）。
   - 仅当文档实际包含某类图表/数学公式、或用户点击导出时，才动态 `import()` 对应 chunk。
5. **有界内存与防泄漏**：
   - 所有缓存（内存 LRU、IndexedDB 缓存、Blob URL）必须设置硬上限与淘汰清理逻辑。
   - 组件卸载或文档切换时必须释放 `ResizeObserver`、`IntersectionObserver`、定时器及 `URL.revokeObjectURL`。

---

## 3. 性能与资源预算（Performance & Memory Budgets）

| 指标 | 目标值 | 验收条件 |
| :--- | :--- | :--- |
| 首屏核心 JS（不含懒加载块） | ≤ 180 KB (gzip) | Vite `build` 产物体积检查 |
| 单个图表微引擎体积 | 5 KB ~ 25 KB (gzip) | 独立 chunk，按图种动态加载 |
| 常规文档（< 50KB）编辑延迟 | < 50 ms（端到端更新） | 状态栏实测渲染耗时 |
| 超大文档（50,000 行 / ~3MB）打开时间 | < 500 ms 首屏可见 | 虚拟列表仅挂载可见区 DOM |
| 超大文档滚动帧率 | ≥ 55 FPS | Chrome DevTools Performance |
| 超大文档常驻内存（含 100 张图） | ≤ 150 MB JS Heap | 内存 LRU 上限生效，无 DOM 节点爆炸 |
| 二次访问冷启动（命中本地缓存） | 0 字节网络重下静态包 | Service Worker Cache Storage 命中 |

---

## 4. 锁定技术栈与允许依赖清单

### 4.1 构建与运行时
- **Package Manager**: `pnpm`（或 `npm`，保持锁文件干净）
- **Build Tool**: `Vite 6` + `TypeScript 5`（strict 模式开启）
- **UI Framework**: `Svelte 5`（使用 Runes: `$state`, `$derived`, `$effect`, `$props`），纯 SPA 模式（无需 SvelteKit SSR）
- **Styling & UI**:
  - `Tailwind CSS v4`
  - `shadcn-svelte`（基于 `bits-ui` 无头组件，源码生成至 `src/lib/components/ui/`，按需引入，不装重型整包组件库）
  - `lucide-svelte`（按需具名导入图标）

### 4.2 精简第三方业务依赖（白名单）
| 依赖 | 用途 | 加载策略 |
| :--- | :--- | :--- |
| `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/lang-markdown`, `@codemirror/search`, `@codemirror/autocomplete` | 编辑器内核（仅装核心最小集） | 首屏核心加载 |
| `markdown-it`, `markdown-it-footnote` | CommonMark / GFM + 脚注词法 Tokenizer | 运行于 Web Worker |
| `katex` | LaTeX 数学公式渲染（仅保留 `woff2` 字体自托管） | 仅文档含数学公式时懒加载 |
| `docx` | 导出原生 `.docx` Word 文档 | 仅用户点击“导出 DOCX”时懒加载 |
| `fflate` | 超长 PNG 分片打包 ZIP（极轻 ~8KB） | 仅导出分片长图时懒加载 |

> 其余能力（8 种图表引擎、布局算法、代码词法高亮、虚拟滚动、同步滚动、HTML/PDF/PNG 导出、LRU 缓存、IndexedDB 封装、Service Worker）**全部用纯 TypeScript 自研实现**。

---

## 5. 本地缓存架构（避免每次加载重下包）

为了确保用户首次加载极快、后续访问**零重新下载静态包**且支持完全离线使用，实施 **三层本地缓存体系**：

### Layer 1: 构建产物 Immutable Hash 分包（Vite）
- `vite.config.ts` 中配置 `rollupOptions.output.manualChunks`，明确分离：
  - `vendor-svelte`（Svelte 运行时）
  - `vendor-codemirror`（CodeMirror 核心）
  - `vendor-katex`（KaTeX，懒加载）
  - `vendor-docx`（DOCX 导出，懒加载）
  - `diagram-layout-dag`（共享 Sugiyama 有向图布局核，懒加载）
  - `diagram-layout-tree`（共享树布局核，懒加载）
  - `diagram-sequence` / `diagram-flowchart` / `diagram-class` / `diagram-state` / `diagram-er` / `diagram-mindmap` / `diagram-gantt` / `diagram-pie`（按图种拆独立 chunk）
- 所有静态资源文件名带内容哈希（`assets/[name]-[hash].[ext]`）。
- `katex` 字体构建插件或配置需过滤掉 `.ttf` 和 `.woff`，**仅保留 `.woff2`**，减少 ~70% 字体包体积。

### Layer 2: 自托管 Service Worker（`public/sw.js` 或 Vite 注入清单）
采用原生极简 Service Worker（避免重型 Workbox 运行时，手写 ~120 行清晰可控）：
1. **构建期清单生成**：Vite 自定义小插件在 `build` 结束后自动生成 `dist/asset-manifest.json`（包含构建版本号 `version` 与核心 App Shell 文件列表）。
2. **缓存分区**：
   - `mdrt-shell-${version}`：存放 `index.html` 与核心 App Shell（Network-First 降级 Cache，保证有网时能发现新版，断网秒开）。
   - `mdrt-immutable-v1`：存放所有带内容哈希的 `/assets/*`（JS chunk、CSS、KaTeX `woff2` 字体、Worker 脚本）。采用 **Cache-First（命中即直接本地返回，绝不发网络请求）**！
3. **懒加载包永久复用**：用户第一次用到 `katex` 或 `diagram-flowchart` 或 `vendor-docx` 时，SW 自动将其拦截写入 `mdrt-immutable-v1`；此后无论刷新还是隔周重新打开页面，均直接从本地磁盘 `Cache Storage` 零延迟读取。
4. **安全更新与垃圾清理**：
   - 新版 SW 在 `activate` 时对比 `asset-manifest.json`，清理不再被引用的旧版本 `shell` 和过期哈希文件，防止磁盘无限膨胀。
   - 检测到新版 SW 进入 `waiting` 状态时，前端底部弹出一个不打扰的轻量提示条：「发现新版本，点击刷新生效」（点击后发送 `SKIP_WAITING` 并刷新）。
5. **开发环境注意**：`import.meta.env.DEV` 下**不注册 Service Worker**，避免干扰开发热更新（HMR）。

### Layer 3: IndexedDB 应用数据与渲染持久化缓存
使用极简自封装 `src/lib/storage/idb.ts`（零依赖，Promise 化封装），数据库名 `mdrt-db`，包含 3 个 Object Store：
1. `documents`：保存本地草稿与多标签文档 `{ id, title, content, updatedAt, cursorLine, scrollTop, fileHandleName? }`。
2. `settings`：保存主题（light/dark）、排版风格、分栏宽度比例、视图模式等轻量配置。
3. `diagram_cache`：持久化渲染好的图表 SVG 缓存（键：`{engineVersion}:{diagramType}:{themeMode}:{contentHash}`，值：`{ svg, width, height, lastAccessedAt, byteSize }`）。
   - **硬上限**：最多 **200 条** 或总占用 **≤ 8 MB**，写入超限时按 `lastAccessedAt` 批量淘汰最旧条目。
   - **收益**：用户再次打开包含上百张图的大型文档时，无需重新计算布局，直接毫秒级秒出缓存 SVG。

### 部署缓存头参考模板（需输出在仓库根目录 `deploy/` 下）
- `deploy/nginx.conf`：
  - `/` 与 `/index.html`、`sw.js`、`asset-manifest.json`：`Cache-Control: no-cache`
  - `/assets/`：`Cache-Control: public, max-age=31536000, immutable`
  - 开启 `gzip` / `brotli` 压缩 + 严格 CSP 响应头。
- `deploy/_headers`（适配 Cloudflare Pages / Netlify 静态托管的同款缓存头与 CSP 规则）。

---

## 6. 推荐仓库目录结构

```text
MDRenderTool/
├── docs/                          # 设计规格文档（本项目规范）
├── deploy/                        # Nginx / 静态托管缓存与 CSP 配置模板
│   ├── nginx.conf
│   └── _headers
├── public/
│   ├── favicon.svg
│   └── sw.js                      # 自托管极简 Service Worker
├── src/
│   ├── main.ts
│   ├── App.svelte
│   ├── app.css                    # Tailwind v4 + 亮暗主题 & 图表 CSS 变量
│   ├── styles/
│   │   ├── prose.css              # 三套阅读排版主题 (Minimal / GitHub / Document)
│   │   ├── highlight.css          # 代码高亮配色变量 (Light / Dark)
│   │   └── print.css              # PDF 原生矢量导出专用 @media print 样式
│   ├── lib/
│   │   ├── components/
│   │   │   ├── ui/                # shadcn-svelte 精简组件 (按需安装)
│   │   │   ├── Toolbar.svelte
│   │   │   ├── Sidebar.svelte     # TOC 大纲 + 本地草稿列表
│   │   │   ├── EditorPane.svelte  # CodeMirror 6 封装
│   │   │   ├── PreviewPane.svelte # 虚拟滚动预览器 + 脚注悬浮窗
│   │   │   ├── DiagramBlock.svelte# 图表容器 (工具条/降级提示/Lightbox入口)
│   │   │   ├── DiagramLightbox.svelte # 全屏缩放/拖拽查看器
│   │   │   ├── StatusBar.svelte   # 字数/行数/耗时/缓存更新提示
│   │   │   └── ExportDialog.svelte# 导出进度与选项弹窗
│   │   ├── core/
│   │   │   ├── hash.ts            # FNV-1a 64-bit / 32-bit 极速哈希
│   │   │   ├── lru.ts             # 通用有界内存 LRU 缓存 (支持字节数上限 + 释放回调)
│   │   │   ├── fenwick.ts         # 树状数组 / 前缀和高度索引 (O(log N) 虚拟滚动)
│   │   │   ├── scroll-sync.ts     # Editor <-> Preview 双向同步滚动引擎
│   │   │   └── protocol.ts        # 主线程 <-> Worker 强类型通信协议
│   │   ├── worker/
│   │   │   ├── render.worker.ts   # 主解析与渲染 Web Worker 入口
│   │   │   ├── markdown-parser.ts # markdown-it 包装 + 分块 + 行号映射 + TOC/脚注提取
│   │   │   ├── highlighter.ts     # 自研轻量规则表代码高亮器 (15+ 语言)
│   │   │   └── math-renderer.ts   # KaTeX 懒加载封装 (支持 Worker 内 renderToString)
│   │   ├── diagrams/
│   │   │   ├── types.ts           # 统一 IR 与 DiagramEngine 接口定义
│   │   │   ├── registry.ts        # 按图种动态 import() 注册表
│   │   │   ├── detector.ts        # 极轻图种与方言识别器 (Mermaid / PlantUML)
│   │   │   ├── text-metrics.ts    # 纯数值/CJK感知文本宽高估算器 (Worker 安全)
│   │   │   ├── svg-builder.ts     # 轻量安全 SVG 字符串构建器 (防 XSS 转义)
│   │   │   ├── layouts/
│   │   │   │   ├── sugiyama.ts    # 自研分层有向图布局引擎 (流程/类/状态/ER 共享)
│   │   │   │   └── tree.ts        # 自研 Reingold-Tilford 树布局引擎 (思维导图)
│   │   │   └── engines/
│   │   │       ├── sequence/      # parser.ts + layout.ts + painter.ts
│   │   │       ├── flowchart/
│   │   │       ├── class/
│   │   │       ├── state/
│   │   │       ├── er/
│   │   │       ├── mindmap/
│   │   │       ├── gantt/
│   │   │       └── pie/
│   │   ├── export/
│   │   │   ├── export-utils.ts    # 全文档图表预渲染队列 (带进度回调)
│   │   │   ├── export-html.ts     # 单文件自包含 HTML 导出
│   │   │   ├── export-pdf.ts      # 专用打印容器 + 原生矢量 PDF 导出
│   │   │   ├── export-png.ts      # 单图 SVG->PNG + 全文长图防溢出分片 ZIP
│   │   │   └── export-docx.ts     # 懒加载 docx AST -> OOXML 导出
│   │   ├── storage/
│   │   │   ├── idb.ts             # IndexedDB 封装 (documents / settings / diagram_cache)
│   │   │   ├── file-io.ts         # File System Access API + 拖拽/降级导入导出
│   │   │   └── sw-register.ts     # Service Worker 注册与新版更新通知
│   │   └── stores/
│   │       └── app.svelte.ts      # Svelte 5 Runes 全局响应式状态
├── tests/                         # Vitest 单元测试 (Parser / Layout / Hash / LRU / Virtual)
├── vite.config.ts
├── tsconfig.json
└── package.json
```
