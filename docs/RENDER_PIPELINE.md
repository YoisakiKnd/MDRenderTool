# 渲染管线、大文件虚拟化与内存治理规范 (`RENDER_PIPELINE.md`)

> 本文档定义 MDRenderTool 支撑 **50,000+ 行超大 Markdown 文档** 依然保持低内存和高帧率的核心算法、通信协议与防泄漏红线。

---

## 1. 全链路数据流概览

```text
[CodeMirror 6 文本变更]
       │ (自适应防抖: <50KB→40ms, 50KB~500KB→120ms, >500KB→220ms)
       ▼
[主线程 Scheduler] ── postMessage(PARSE_DOC, { docVersion, text }) ──▶ [Web Worker]
                                                                            │
   1. markdown-it.parse(text) 生成 Token 流 (仅在 Worker 内存中)              │
   2. 按顶级块 (Top-Level Block) 聚合，记录 [startLine, endLine]              │
   3. 计算每块内容哈希 hash = fnv1a(rawSlice + blockMeta)                    │
   4. 与 Worker 内上次 blocks 做块级 Diff：                                   │
      - 哈希未变的块：复用缓存的 renderedHtml / diagramMeta                   │
      - 变化的普通块：立即渲染 HTML + 代码高亮 + KaTeX(按需)                  │
      - 变化的图表块：仅产出轻量占位符元数据（不阻塞首轮解析返回！）           │
   5. 提取 TOC 标题树 + 脚注定义表 footnotesMap                               │
       │
       ▼ postMessage(PARSE_RESULT, { docVersion, blocks, toc, footnotes, parseMs })
[主线程 PreviewPane]
   1. 若 docVersion < latestDocVersion 则丢弃过时结果（防竞态乱序）
   2. 更新 VirtualList 的 blocks 元数据与前缀和高度索引（保留未变块的实测高度！）
   3. 仅对当前视口 + overscan 范围内可见的 DiagramBlock 发起 RENDER_DIAGRAM 请求
       │
       ▼ (并发队列控制 + 双层缓存: 内存 LRU -> IndexedDB -> Worker 渲染)
[DiagramBlock 挂载 SVG] ── ResizeObserver 上报真实高度 ──▶ 更新 Fenwick Tree
```

**关键设计决策**：
- **解析与图表渲染解耦**：首轮 `PARSE_DOC` 绝不等待文档里 100 张图表全部算完，而是毫秒级先返回所有文本块 + 图表元数据占位，让用户立刻看到文字和滚动条；紧接着主线程只对**当前屏幕上能看到的几张图**请求渲染！
- **避免重复传输巨型 HTML**：如果块哈希与上次相同，Worker 返回轻量 `{ id, unchanged: true, startLine, endLine }`（增量 patch），主线程直接复用原有渲染 HTML，极大降低 `postMessage` 序列化开销与 GC 压力。

---

## 2. 主线程 ↔ Worker 通信协议 (`src/lib/core/protocol.ts`)

```ts
export type BlockKind =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'blockquote'
  | 'table'
  | 'code'
  | 'diagram'
  | 'math'
  | 'hr'
  | 'footnote_section'
  | 'html';

export interface ParsedBlock {
  /** 稳定块索引 (0..N-1) */
  index: number;
  /** 内容哈希 (用于 Diff、复用高度、缓存键) */
  hash: string;
  kind: BlockKind;
  /** 对应编辑器源码 1-based 闭区间 [startLine, endLine] */
  startLine: number;
  endLine: number;
  /** 估算初始高度 (px)，用于首次挂载前虚拟滚动占位 */
  estimatedHeight: number;
  /** 普通块/代码/公式块已渲染好的安全 HTML；diagram 块为空字符串 */
  html?: string;
  /** 仅当 unchanged=true 时，主线程复用旧块的 html 与已测高度 */
  unchanged?: boolean;
  /** 仅 kind === 'diagram' 时存在 */
  diagram?: {
    fenceLang: string;        // 'mermaid' | 'plantuml' | 'puml' | ...
    detectedType: string;     // 'sequence' | 'flowchart' | ... | 'unsupported'
    source: string;           // 原始图表源码
    sourceHash: string;       // 图表源码哈希
  };
  /** 仅 kind === 'heading' 时存在 */
  heading?: {
    level: 1 | 2 | 3 | 4 | 5 | 6;
    text: string;
    slug: string;
  };
}

export interface TocItem {
  blockIndex: number;
  line: number;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  slug: string;
}

export interface FootnoteEntry {
  id: string;        // 如 "1" 或 "note-a"
  label: string;     // 显示编号
  html: string;      // 渲染后的单条脚注 HTML（供正文 Hover 悬浮气泡直接显示）
  line: number;      // 脚注定义所在行
}

// Main -> Worker
export type WorkerRequest =
  | { type: 'PARSE_DOC'; docVersion: number; text: string; themeMode: 'light' | 'dark' }
  | {
      type: 'RENDER_DIAGRAM';
      requestId: string;
      fenceLang: string;
      source: string;
      sourceHash: string;
      themeMode: 'light' | 'dark';
    }
  | { type: 'CANCEL_DIAGRAMS'; requestIds: string[] };

// Worker -> Main
export type WorkerResponse =
  | {
      type: 'PARSE_RESULT';
      docVersion: number;
      blocks: ParsedBlock[];
      toc: TocItem[];
      footnotes: Record<string, FootnoteEntry>;
      stats: {
        wordCount: number;
        charCount: number;
        lineCount: number;
        blockCount: number;
        parseMs: number;
      };
    }
  | {
      type: 'DIAGRAM_RESULT';
      requestId: string;
      sourceHash: string;
      status: 'ok' | 'unsupported' | 'error';
      diagramType?: string;
      svg?: string;
      width?: number;
      height?: number;
      reason?: string;
      renderMs: number;
    };
```

---

## 3. Markdown 分块与安全规则 (`src/lib/worker/markdown-parser.ts`)

1. **安全防 XSS（硬约束）**：
   - `markdown-it` 配置 `html: false`（默认转义原始 HTML 标签，防止脚本注入；如未来开放有限安全 HTML 白名单，必须经过严格标签/属性白名单清洗，严禁 `on*` 事件属性与 `javascript:` 协议）。
   - 所有链接的 `href` 校验协议白名单：`http:`, `https:`, `mailto:`, `#`。
2. **顶级块切分与行号提取**：
   - 利用 `markdown-it` 顶级 Token（`level === 0` 且带 `token.map = [startLine0, endLine0]`）将文档切分为连续的 `ParsedBlock[]`。
   - 遇到围栏代码块（`fence`）：
     - 语言属于图表集合（`mermaid`, `plantuml`, `puml`, `uml`, `sequence`, `flowchart`, `mindmap`, `gantt`, `pie`, `er`, `class`, `state`）→ 归类为 `kind: 'diagram'`。
     - 语言为 `math` / `latex` / `tex` → 归类为 `kind: 'math'`。
     - 其他代码语言 → 调用自研 `highlighter.ts` 生成带 `<span class="hl-*">` 的安全 HTML。
3. **LaTeX 数学公式支持（自托管 KaTeX）**：
   - 编写极轻的 `markdown-it` 内联/块级公式规则：
     - 行内：`$...$`（要求首 `$` 后无空格、尾 `$` 前无空格，且尾 `$` 后非数字，避免误伤价格如 `$100`）。
     - 块级：`$$...$$`（独占行或独立块）。
   - **按需懒加载**：在 Worker 中检测当前文档是否出现公式 token；若出现且 KaTeX 尚未加载，动态 `await import('katex')` 并调用 `katex.renderToString(tex, { displayMode, throwOnError: false, strict: 'ignore' })`。文档无公式时绝不加载 KaTeX！
   - 样式表 `katex/dist/katex.min.css` 仅在主线程收到文档含公式标志后按需注入（或独立小 CSS chunk），且字体构建时剔除非 `woff2` 文件。
4. **脚注支持**：
   - 集成 `markdown-it-footnote`。
   - 在解析阶段，把脚注引用 `<a href="#fn1">` 附加 `data-footnote-id="1"` 属性；提取每条脚注的渲染 HTML 存入 `footnotes` 字典。
   - 预览区用户鼠标悬停/点击脚注编号时，立即从 `footnotes[id]` 弹出轻量悬浮卡片（Popover），无需滚到 5 万行底部；同时文末也保留标准 `footnote_section` 块。

---

## 4. 自研超轻规则驱动代码高亮器 (`src/lib/worker/highlighter.ts`)

为了彻底摆脱 Shiki 的体积和 WASM 内存开销，同时在大文件里达到 **< 1ms** 高亮速度，自研纯 TS 单遍正则词法高亮器：

- **设计原理**：
  - 每种语言定义一张声明式优先级规则表：`Array<{ token: TokenType; pattern: RegExp }>`。
  - Token 类型固定精简为 9 类（对应 CSS 变量，自动适配亮/暗主题）：
    `comment` | `string` | `keyword` | `number` | `type` | `function` | `operator` | `punctuation` | `attr`
  - 单遍扫描输出转义后的 `<span class="hl-{token}">...</span>`，避免多轮正则回溯导致卡顿（**严禁使用易触发 ReDoS 的嵌套量词正则**）。
  - 单块代码超过 **2,000 行** 或 **100 KB** 时，自动降级为纯文本渲染并提示“超大代码块已跳过语法高亮以保障流畅”。
- **首批内置语言（含别名映射，总压缩体积 ≤ 15KB）**：
  - `javascript` (`js`, `jsx`, `mjs`), `typescript` (`ts`, `tsx`), `python` (`py`), `go` (`golang`), `rust` (`rs`), `java`, `c`, `cpp` (`c++`, `cc`), `csharp` (`cs`), `sql`, `json`, `yaml` (`yml`), `html` (`xml`, `svg`, `svelte`), `css` (`scss`), `bash` (`sh`, `zsh`, `shell`), `markdown` (`md`), `diff`。

---

## 5. 预览区虚拟滚动引擎（`PreviewPane.svelte` + `src/lib/core/fenwick.ts`）

这是支持 **5 万行大文档** 不卡顿、不爆内存的核心模块。

### 5.1 数据结构：Fenwick Tree（树状数组）维护块高度
- 设文档共有 `N` 个块：
  - `heights: Float64Array(N)`：记录每个块的当前高度（未挂载过用 `estimatedHeight`，挂载后用 `ResizeObserver` 实测值替换）。
  - `FenwickTree(N)`：
    - `update(i, delta)`：`O(log N)` 更新第 `i` 块高度变化。
    - `prefixSum(i)`：`O(log N)` 查询第 `i` 块顶部的绝对 `offsetTop`。
    - `findIndexByOffset(scrollTop)`：`O(log N)` 二分查找当前 `scrollTop` 命中的首个可见块索引 `startIdx`。
    - `totalHeight()`：`O(log N)` 获取整个预览区虚拟总高度（撑起滚动条）。

### 5.2 视口窗口与滚动锚定（Scroll Anchoring）
- **可见窗口计算**：
  - 由 `scrollTop` 与 `viewportHeight` 查出 `[firstVisible, lastVisible]`。
  - 上下各扩展 `OVERSCAN = 10` 个块（或上下各 800px），得到挂载区间 `[mountStart, mountEnd]`。
  - DOM 中仅使用 Svelte `{#each visibleBlocks as block (block.index)}` 渲染该区间内的块，顶部用 `transform: translateY(${topOffset}px)` 绝对定位在高度为 `totalHeight` 的 spacer 容器内。
- **防抖动滚动锚定（关键！）**：
  - 当视口**上方**某个已经滚过去的块高度发生变化（比如图表异步渲染完高度从估算的 240px 变成 380px，差值 `delta = +140px`），必须同步执行 `container.scrollTop += delta`，防止用户正在阅读的内容突然往下跳！
  - 视口**下方**块高度变化不调整 `scrollTop`。

### 5.3 双向精确同步滚动 (`src/lib/core/scroll-sync.ts`)
- **防死循环锁**：维护 `activeScrollSource: 'editor' | 'preview' | null`，某侧触发滚动后持有锁 `150ms`（滚动静止后释放），期间忽略另一侧由程序触发的 `scroll` 事件。
- **Editor → Preview**：
  1. 从 CodeMirror 6 获取当前视口顶部的源码行号 `topLine`（含行内小数进度 `lineFraction`）。
  2. 在 `blocks` 数组中按 `startLine` 二分查找 (`O(log N)`) 命中的块 `b`。
  3. 计算块内进度 `ratio = (topLine - b.startLine) / Math.max(1, b.endLine - b.startLine + 1)`。
  4. 目标位置 `targetTop = fenwick.prefixSum(b.index) + heights[b.index] * ratio`，平滑设置预览容器 `scrollTop`。
- **Preview → Editor**：
  1. 根据预览区 `scrollTop` 用 `fenwick.findIndexByOffset(scrollTop)` 找到块 `b` 与块内比例 `ratio`。
  2. 反算目标行 `targetLine = Math.round(b.startLine + ratio * (b.endLine - b.startLine))`。
  3. 调用 CodeMirror 6 `editorView.scrollDOM.scrollTop = editorView.lineBlockAt(linePos).top`。

---

## 6. 内存管理与图表渲染调度红线

1. **有界内存 LRU 缓存 (`src/lib/core/lru.ts`)**：
   - 图表 SVG 内存缓存上限：**最多 80 条** 或 **总字节数 ≤ 4 MB**（以先到者为准）。
   - 淘汰条目时触发清理钩子（如撤销关联的 `Blob URL`）。
2. **双层图表缓存查询顺序**：
   - `L1 内存 LRU`（< 0.1ms 同步命中） → `L2 IndexedDB diagram_cache`（~2ms 异步命中） → `L3 Web Worker 微引擎计算`（2~15ms，算完回写 L1 + L2）。
3. **快速滚动取消机制（防排队堆积）**：
   - 当用户快速拖动滚动条掠过 50 张图表时，离开挂载窗口的 `DiagramBlock` 卸载时立即发送 `CANCEL_DIAGRAMS` 给 Worker；Worker 维护待渲染队列，收到取消后直接丢弃尚未执行的任务，只优先渲染当前停留在屏幕上的图表！
4. **单次更新防内存抖动**：
   - 大文件编辑时，切勿把整篇文档字符串频繁拷贝进多个 Svelte `$state` 中；**CodeMirror 6 的 `EditorState.doc` 是文档内容的唯一真相源**，仅在防抖触发同步时调用 `state.doc.toString()` 发送给 Worker，或定期写入 IndexedDB 草稿。
