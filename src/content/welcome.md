# 用 Markdown 写清楚一件事

欢迎来到 MDRenderTool。左边记录原始想法，右边检查成稿。用大纲跳到任一章节，或把本地 Markdown 文件拖进编辑器。修改会自动保存为当前浏览器的草稿。[^local]

| 操作 | 快捷键 |
| --- | --- |
| 打开文件 | Ctrl / Cmd + O |
| 保存文件 | Ctrl / Cmd + S |
| 切换视图 | Ctrl / Cmd + Shift + P |
| 显示或隐藏侧栏 | Ctrl / Cmd + \\ |

- [x] 检查标题、表格与脚注
- [ ] 试着修改一个节点，观察预览

## 编辑到预览

### 时序图

```mermaid
sequenceDiagram
  actor W as 写作者
  participant E as 编辑器
  participant R as 渲染 Worker
  W->>E: 修改标题
  E->>+R: 提交当前文档
  R-->>-E: 返回变化的块
  Note over W,E: 预览仅挂载可见内容
```

### 流程图

```mermaid
flowchart LR
  A[图表源码] --> B{命中缓存?}
  B -->|是| C[(读取 SVG)]
  B -->|否| D[本地计算布局]
  C --> E[显示预览]
  D --> E
```

### 思维导图

```plantuml
@startmindmap
* 技术笔记
++ 记录
+++ 命令与示例
++ 验证
+++ 可复现步骤
-- 分享
--- 阅读排版
@endmindmap
```

## 描述数据与状态

### 类图

```mermaid
classDiagram
  class Document {
    +String id
    +save() boolean
  }
  class Draft {
    +Date updatedAt
  }
  Document <|-- Draft
```

### 状态图

```mermaid
stateDiagram-v2
  [*] --> Editing
  state "编辑中" as Editing
  state "已保存" as Saved
  Editing --> Saved : 自动保存
  Saved --> Editing : 继续修改
  Saved --> [*]
```

### 实体关系图

```plantuml
@startuml
entity "文档" as Doc {
  * id : string <<PK>>
  --
  title : string
}
entity "预览块" as Block {
  * hash : string <<PK>>
  docId : string <<FK>>
}
Doc ||--o{ Block : 包含
@enduml
```

## 计划与复盘

### 甘特图

```mermaid
gantt
  title 文档发布计划
  dateFormat YYYY-MM-DD
  section 准备
  初稿 :done, draft, 2026-11-23, 2d
  复核 :active, review, after draft, 3d
  发布 :milestone, release, after review, 0d
```

### 饼图

```mermaid
pie showData
  title 一篇技术说明的结构
  "正文" : 55
  "示例" : 25
  "图表" : 20
```

## 公式和代码

行内式 $E=mc^2$，块级式如下。

$$
\sum_{k=1}^{n} k = \frac{n(n+1)}{2}
$$

```ts
const title = "本地 Markdown";
const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(title));
console.log(new Uint8Array(digest));
```

[^local]: 草稿与界面偏好写入当前浏览器的 IndexedDB。使用「保存」可另外生成可携带的 Markdown 文件。
