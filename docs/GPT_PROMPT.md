# 激活 GPT 开始编码的 Prompt 指南 (`GPT_PROMPT.md`)

> 本文件包含 **首轮激活 Prompt**（复制发给 GPT 开启项目）以及 **每阶段推进 Prompt**（逐个 Milestone 验收并推进，防止 GPT 一次性写太长导致偷工减料或跳过细节）。

---

## 一、首轮激活 Prompt（直接复制给 GPT）

```markdown
你现在是本仓库（MDRenderTool）的首席全栈/前端架构师与核心开发者。
我们的产品方案和全部技术规格已经敲定，并存放在仓库的 `docs/` 目录下。

在编写任何一行代码之前，请你**务必先完整通读以下 5 份规格文档**，把它们作为开发的唯一最高准则：
1. `docs/SPEC.md` —— 项目总览、不可违背的工程红线、依赖白名单、三层本地缓存体系与目录结构
2. `docs/RENDER_PIPELINE.md` —— Web Worker 通信协议、增量分块哈希、Fenwick Tree 虚拟滚动、双向同步滚动与轻量代码高亮
3. `docs/DIAGRAM_ENGINE.md` —— 按图种拆分的 8 大自研微引擎、统一 IR、Sugiyama/Tree 布局核与 SVG 主题规范
4. `docs/UI_AND_EXPORT.md` —— Svelte 5 + shadcn-svelte 界面设计、本地持久化与四大懒加载导出系统
5. `docs/TASKS.md` —— Milestone 1 ~ 7 分阶段任务书与验收清单

### 必须死守的 6 条硬红线（违反任意一条视为返工）：
1. **严格零外部网络请求**：禁止引入任何外部 CDN、Google Fonts 或第三方在线图表服务；所有 JS/CSS/WASM/KaTeX `woff2` 字体必须 100% 自托管打包。
2. **禁止引入重型包**：绝对禁止安装 `mermaid`、`@plantuml/core`、`monaco-editor`、`mathjax`、`shiki`、`html2canvas`、`jspdf`、`d3`、`cytoscape`、`elkjs`。图表严格按图种自研微引擎，仅允许使用 `docs/SPEC.md` 白名单中的精简依赖。
3. **主线程零阻塞**：Markdown 解析、代码高亮、8 种图表解析/布局/SVG 生成全部运行在 Web Worker 中，严禁在图表引擎中使用任何 DOM API（如 `getBBox()`）。
4. **严格按需懒加载 + 本地持久化缓存**：8 种图表微引擎、KaTeX、`docx`、导出模块必须各自独立 chunk 按需 `import()`；配置 Immutable Hash 分包 + 自托管 Service Worker + IndexedDB 缓存，确保用户二次打开无需重新下载资源包。
5. **超大文件不卡不爆内存**：预览区必须使用基于 Fenwick Tree 的虚拟滚动 + 有界内存 LRU 缓存，严禁直接把整篇大文档全量挂载到 DOM。
6. **高质量、零占位敷衍**：不允许留 `TODO`、空函数、假数据或未实现分支；每个模块都要写干净的 TypeScript（strict 模式 0 错误）和对应的 Vitest 单元测试。

### 当前执行指令：
请先通读上述 5 份文档，简短确认你对架构与红线的理解后，**立即开始执行并完整交付 `Milestone 1`**（不要跳到 Milestone 2）。

完成 Milestone 1 后，请自行运行：
- 单元测试（`pnpm test`）
- 类型检查（`pnpm run check`）
- 生产构建（`pnpm run build`）并检查产物 chunk 与零外链情况

全部通过后，向我汇报：
1. 本阶段完成的文件清单与核心设计要点
2. 各项测试、类型检查与构建产物体积的实测结果
3. 对照 `docs/TASKS.md` Milestone 1 验收清单的逐项核对结果

等我确认后，再进入 Milestone 2。
```

---

## 二、后续阶段推进 Prompt（每个 Milestone 验收完复制使用）

把 `<N>` 替换成 `2`、`3`、`4`、`5`、`6`、`7` 即可：

```markdown
Milestone <N-1> 验收通过，现在请严格按照 `docs/` 规范文档继续执行 **`Milestone <N>`**。

执行要求：
1. 开工前复查 `docs/TASKS.md` 中 Milestone <N> 的全部目标交付物与对应设计文档细节，不要遗漏任何子项或边界场景。
2. 严守零外链、白名单依赖、Worker 离线计算、独立 chunk 懒加载与有界内存红线。
3. 为本阶段核心逻辑补齐 Vitest 单元测试。
4. 完成后运行 `pnpm test`、`pnpm run check`、`pnpm run build`，确认 0 报错并检查新增 chunk 是否正确拆分，然后对照 `docs/TASKS.md` 的 Milestone <N> 验收清单逐项向我汇报。
```

---

## 三、如果发现 GPT 偷懒或偏离规范时的纠偏 Prompt（备用）

```markdown
停一下，请对照 `docs/SPEC.md`、`docs/RENDER_PIPELINE.md` 和 `docs/DIAGRAM_ENGINE.md` 自查刚才的实现，发现可能存在以下偏差，请逐项核实并修复：
1. 是否存在 `TODO` / 简化占位逻辑 / 未覆盖的语法分支？
2. 是否引入了白名单之外的包或外部 URL？
3. 新增模块是否已正确拆分为独立懒加载 chunk（检查 `dist/assets/`）？
4. 所有缓存、Observer、Worker 队列与 Blob URL 是否有上限和销毁清理逻辑？

修复完成后重新运行测试、类型检查与构建并汇报结果。
```
