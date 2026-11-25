import { describe, expect, it } from 'vitest';
import { detectDiagram } from '../src/lib/diagrams/detector';
import { measureText } from '../src/lib/diagrams/text-metrics';
import { sugiyama } from '../src/lib/diagrams/layouts/sugiyama';
import { layoutTree } from '../src/lib/diagrams/layouts/tree';
import { renderDiagram } from '../src/lib/diagrams/registry';

const examples = [
  ['mermaid', 'sequence', 'sequenceDiagram\nactor U as 用户\nparticipant A as App\nautonumber\nU->>+A: 打开\nalt 命中缓存\nA-->>-U: 内容\nelse 等待\nA->>A: 计算\nend\nNote over U,A: 本地渲染'],
  ['plantuml', 'sequence', '@startuml\nactor "用户" as U\ndatabase Store\nU -> Store: 保存\nnote right of Store\n已写入\nend note\n== 完成 ==\n@enduml'],
  ['mermaid', 'flowchart', 'flowchart LR\nsubgraph S [输入]\nsubgraph nested [节点]\nA["输入"] --> B{检查}\nend\nend\nB -->|是| C[(缓存)] --> A\nC --> C\nclassDef ok fill:#fff,stroke:#426\nclass C ok'],
  ['plantuml', 'flowchart', '@startuml\nstart\n:读取 Markdown;\nif (有缓存) then (是)\n:读取;\nelse (否)\n:渲染;\nendif\nstop\n@enduml'],
  ['mermaid', 'mindmap', 'mindmap\n  Root((文档))\n    Editor[编辑]\n      搜索\n    Preview(预览)'],
  ['plantuml', 'mindmap', '@startmindmap\n* 工作台\n++ 编辑\n-- 阅读\n--- 样式\n@endmindmap'],
  ["mermaid", "class", "classDiagram\nnamespace 文件 {\nclass Store {\n+int id\n+save() bool\n}\n}\nStore \"1\" o-- \"*\" Document : 草稿\nDocument <|.. Draft"],
  ["plantuml", "class", "@startuml\npackage \"数据层\" {\ninterface \"仓库\" as Repository {\n+write()\n}\n}\nclass Writer\nRepository <|.. Writer\n@enduml"],
  ["mermaid", "state", "stateDiagram-v2\n[*] --> Ready\nstate \"同步\" as Ready {\n[*] --> Write\nWrite --> [*]\n}\nReady --> [*] : 完成"],
  ["plantuml", "state", "@startuml\n[*] --> A\nstate \"运行中\" as A\nA : 保存中\nnote right of A\n正在写入\nend note\nA --> [*]\n@enduml"],
  ["mermaid", "er", "erDiagram\nUSER {\nint id PK \"标识\"\n}\nUSER ||--o{ DRAFT : owns\nDRAFT {\nint user_id FK\n}"],
  ["plantuml", "er", "@startuml\nentity \"用户\" as u {\n* id : int <<PK>>\n--\nname : varchar\n}\nentity \"草稿\" as d\nu ||--o{ d : 归属\n@enduml"],
  ["mermaid", "gantt", "gantt\ntitle 发布\ndateFormat DD/MM/YYYY\nsection 测试\n基线 :done, baseline, 01/11/2026, 1w\n上线 :milestone, release, after baseline, 0d"],
  ["plantuml", "gantt", "@startgantt\nProject starts 2026-11-01\n-- 验收 --\n[测试] lasts 2 days\n[发布] starts at [测试]'s end\n[发布] lasts 6 hours\n@endgantt"],
  ["mermaid", "pie", "pie showData\ntitle 测试结果\n\"已完成\" : 92.5\n\"待处理\" : 7.5"],
  ["plantuml", "pie", "@startpie\ntitle 占比\n\"本地写入\" : 1\n\"远端\" : 0\n@endpie"],
] as const;

describe('diagram rendering', () => {
  it.each(examples)('detects and renders %s %s', async (dialect, type, text) => {
    expect(detectDiagram(dialect, text)).toEqual({ dialect, type });
    const result = await renderDiagram(dialect, text, 'dark');
    const light = await renderDiagram(dialect, text, 'light');
    expect(light.svg).toBe(result.svg);
    expect(result.status, result.reason).toBe('ok');
    expect(result).toMatchObject({ diagramType: type, svg: expect.stringMatching(/<svg.*mdrt-diagram/), width: expect.any(Number), height: expect.any(Number) });
    expect(result.svg).not.toMatch(/NaN|Infinity/);
  });

  it('denies remote source directives and escapes untrusted diagram labels', async () => {
    expect(detectDiagram('plantuml', '@startuml\n!include https://example.test/file\n@enduml').type).toBe('unsupported');
    expect((await renderDiagram('mermaid', 'gitGraph\ncommit', 'light')).status).toBe('unsupported');
    const result = await renderDiagram('mermaid', 'flowchart TB\nA["<script>测试</script>"] --> B', 'light');
    expect(result.svg).toContain('&lt;script&gt;');
    expect(result.svg).not.toContain('<script>');
  });

  it('rejects cyclic and impossible Gantt dates and invalid pie totals', async () => {
    for (const source of [
      'gantt\nA : a, after b, 1d\nB : b, after a, 1d',
      'gantt\nA : 2026-02-31, 1d',
      'pie\n"none": 0',
    ]) expect((await renderDiagram('mermaid', source, 'light')).status).toBe('error');
  });

  it('reports the source line for malformed diagrams', async () => {
    const result = await renderDiagram('mermaid', 'sequenceDiagram\nactor user\nmisspelled', 'light');
    expect(result).toMatchObject({ status: 'error', errorLine: 3 });
  });

  it('detects PlantUML diagram types even after long skinparam headers', () => {
    const header = Array.from({ length: 20 }, (_, i) => `skinparam rule${i} #fff`).join('\n');
    const source = `@startuml\n${header}\nparticipant Alice\nAlice -> Bob: hi\n@enduml`;
    expect(detectDiagram('plantuml', source)).toEqual({ dialect: 'plantuml', type: 'sequence' });
  });
});

describe('shared layout engines', () => {
  it('wraps CJK and handles manual newlines', () => {
    const cjk = measureText('中日韩中日韩<br />wide text', 12, false, 44);
    expect(cjk.lines).toEqual(['中日韩', '中日韩', 'wide', 'text']);
    expect(measureText('MW').width).toBeGreaterThan(measureText('il').width);
  });

  it('routes cycles, parallel edges, self-loops, cross-rank edges and nested groups', () => {
    const nodes = ['A','B','C'].map((id) => ({ id, width: 50, height: 25 }));
    const edges = [
      {from:'A',to:'B'}, {from:'A',to:'B'}, {from:'B',to:'C'}, {from:'C',to:'A'}, {from:'A',to:'C'}, {from:'C',to:'C'},
    ];
    const layout = sugiyama({ nodes, edges, direction: 'LR', groups: [
      {id:'all',nodeIds:['A','B','C']}, {id:'nested',nodeIds:['A','B']},
    ] });
    expect(layout.routes[3].reversed).toBe(true);
    expect(layout.routes[4].points).toHaveLength(3);
    expect(layout.routes[5].points).toHaveLength(4);
    expect(layout.routes[0].path).not.toBe(layout.routes[1].path);
    expect(layout.nodes.get('B')!.x).toBeGreaterThan(layout.nodes.get('A')!.x);
    expect(layout.groupBoxes.size).toBe(2);
  });

  it('allocates opposing branches and prevents sibling overlap', () => {
    const child = (id: string, side: -1 | 1) => ({ id, width: 32, height: 20, children: [], side });
    const root = { id: 'root', width: 55, height: 20, children: [child('a', -1), child('b', 1), child('c', 1)] };
    const { boxes, sides } = layoutTree(root);
    expect(sides.get('a')).toBe(-1);
    expect(boxes.get('a')!.x).toBeLessThan(boxes.get('root')!.x);
    expect(boxes.get('b')!.y + 20).toBeLessThan(boxes.get('c')!.y);
  });
});
