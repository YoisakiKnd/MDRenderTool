# MDRenderTool

一款 **100% 纯前端、零外部依赖、极致低内存、支持超大文件** 的网页版双栏实时 Markdown 编辑器与多图表渲染工作台。

采用 **Svelte 5 + CodeMirror 6 + Web Worker 全离线渲染管线 + 自研按图种拆分微引擎**，彻底告别重型图表包（无 `mermaid` / `@plantuml/core` / `monaco-editor`），首屏核心 JS 压至 **~180 KB (gzip)**，并具备三层本地缓存，支持完全离线打开与秒级复用。

---

## 核心特性

- **双栏实时编辑与大文件虚拟化**
  - CodeMirror 6（B-tree 文本模型 + 原生视口虚拟化）搭配基于 **Fenwick Tree（树状数组）** 的预览区虚拟滚动，支持数万行级文档流畅滚动与 `O(log N)` 双向精确同步滚动。
  - Markdown 解析、块级内容哈希 Diff、代码词法高亮、LaTeX 公式与图表布局绘制**全部运行在 Web Worker**，主线程零阻塞。
- **自研按画图类型拆分的 8 大图表微引擎（兼容 Mermaid & PlantUML 常用语法）**
  - 统一中间表示（IR）+ 共享 **Sugiyama 分层有向图布局核** & **Reingold-Tilford 双向树布局核**，每个图种独立分包（仅 **1.3 ~ 3.2 KB gzip**）按需懒加载：
    - 时序图（Sequence）、流程图 / 活动图（Flowchart）、类图（Class）、状态图（State）、ER 图（ER）、思维导图（Mindmap）、甘特图（Gantt）、饼图（Pie）
  - 遇到未收录的冷门图表语法时优雅降级提示并展示原始源码；已渲染图表支持全屏滚轮缩放/拖拽查看、复制 SVG 及单图高清 PNG 导出。
- **完整技术文档排版能力**
  - 支持 GFM 表格与任务列表、**LaTeX 数学公式**（KaTeX 按需懒加载，仅自托管 `woff2` 字体）、自研 15+ 语言超轻代码词法高亮、**脚注**（正文悬浮气泡预览 + 文末脚注区）与可折叠联动 **TOC 大纲**。
- **四大懒加载导出系统**
  - **HTML**：零外链单文件自包含 HTML（可选折叠目录）。
  - **PDF**：原生矢量打印管线 + 精细 `@media print` 分页与防截断样式（文字可复制、无失真、不爆内存）。
  - **PNG**：单图 2×/3× 高清导出；整篇长文自动按安全 Canvas 高度分页并懒加载 `fflate` 打包 ZIP，防白屏崩溃。
  - **DOCX**：点击时按需懒加载 `docx`，映射原生 Word 标题、列表、表格、代码块、脚注与高清图表/公式图片。
- **三层本地缓存（二次打开免重下包）**
  - **Immutable Hash 分包** + **自托管极简 Service Worker**（App Shell 离线可用，懒加载 chunk 永久 Cache-First 复用）+ **IndexedDB**（自动保存本地多草稿、界面偏好与有界 LRU 图表渲染缓存）。
- **macOS 原生桌面风格界面**
  - 纯白一体阅读画布 + 浅灰侧栏 + 亮/暗双主题自动适配 + 极简 / GitHub / 书刊三套排版风格 + 专注模式 + File System Access API 本地文件读写。

---

## 安全设计

- **零外部第三方请求**：全站无外部 CDN、无 Google Fonts、无外链图床，可通过严格 CSP（`default-src 'self'`）校验。
- **防 XSS 与注入**：关闭 Markdown 原始 HTML 渲染，严格校验链接协议白名单，屏蔽外链图片与 SVG 图片，KaTeX 锁定 `trust: false` 与宏展开上限，所有 SVG 文本节点与属性严格 XML 转义并过滤非法控制字符。
- **防 DoS 保护**：单块图表限制最大行数与字符数、大代码块自动跳过高亮、流程图节点/连线设置上限且采用 `O(n)` 线性语句拆分。

---

## 快速开始

需要 **Node.js 22.18+** 与 **pnpm**。

```bash
# 安装依赖
pnpm install --frozen-lockfile

# 启动本地开发服务器
pnpm dev
```

首次打开会自动加载内置欢迎示例文档（涵盖 GFM、LaTeX、脚注与全部 8 种自研图表）。支持直接拖拽 `.md` / `.markdown` / `.txt` 文件至编辑器打开。

### 常用命令

```bash
pnpm test                # 运行全部 Vitest 单元测试
pnpm run check           # svelte-check + TypeScript 严格类型检查
pnpm run build           # 生产构建（含 chunk 拆包与 SW 清单注入）
pnpm run audit:build     # 审计算法/依赖产物体积与分包清单
pnpm run preview         # 本地预览生产构建与离线 Service Worker
pnpm run stress 50000 /tmp/mdrt-stress.md 80   # 生成 5 万行 + 80 张图的压测文档
```

---

## 快捷键

| 快捷键 | 功能 |
| :--- | :--- |
| `Ctrl / Cmd + O` | 打开本地 Markdown 文件 |
| `Ctrl / Cmd + S` | 保存 Markdown 文件 |
| `Ctrl / Cmd + E` | 打开导出面板 |
| `Ctrl / Cmd + \` | 展开 / 收起左侧大纲与草稿栏 |
| `Ctrl / Cmd + Shift + P` | 循环切换 仅编辑 / 双栏 / 仅预览 |
| `Ctrl / Cmd + F` | 编辑器内查找与替换 |
| `Ctrl / Cmd + B / I / K / \`` | 加粗 / 斜体 / 链接 / 行内代码 |
| `Esc` | 退出专注模式或关闭弹窗 |

---

## 静态部署

执行 `pnpm run build` 后将 `dist/` 目录部署到任意 HTTPS 静态托管服务即可：

- **Nginx**：参考 [deploy/nginx.conf](deploy/nginx.conf)（已预置 `/assets/` 长期不可变缓存头、严格 CSP、Gzip 与可选 Brotli 注释模板）。
- **Cloudflare Pages / Netlify**：部署时将 [deploy/_headers](deploy/_headers) 复制到发布根目录即可生效。

---

## 架构文档

完整的架构设计、渲染管线、8 大图表引擎 IR 规范与任务清单见 [`docs/`](docs/) 目录：

- [docs/SPEC.md](docs/SPEC.md) — 总规范、性能预算与三层缓存体系
- [docs/RENDER_PIPELINE.md](docs/RENDER_PIPELINE.md) — Worker 通信协议、虚拟滚动与同步滚动
- [docs/DIAGRAM_ENGINE.md](docs/DIAGRAM_ENGINE.md) — 统一 IR、Sugiyama / Tree 布局算法与 8 种图表规范
- [docs/UI_AND_EXPORT.md](docs/UI_AND_EXPORT.md) — 界面交互与四大导出模块设计

---

## License

[MIT](LICENSE)
