import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface SampleDiagram { fence: string; source: string }

function readExamples(welcome: string): SampleDiagram[] {
  return [...welcome.matchAll(/^```(mermaid|plantuml)\n([\s\S]+?)^```$/gm)]
    .map(([, fence, source]) => ({ fence, source }));
}

export function generateStress(welcome: string, lineCount: number, diagramCount: number): string {
  if (!Number.isSafeInteger(lineCount) || lineCount < 1_000 || lineCount > 150_000 ||
      !Number.isSafeInteger(diagramCount) || diagramCount < 0 || diagramCount > 200) {
    throw new RangeError('Choose 1,000–150,000 lines and 0–200 diagrams');
  }
  const examples = readExamples(welcome);
  if (!examples.length) throw new Error('No diagram examples in the welcome document');

  const lines = ['# MDRenderTool stress document', ''];
  const interval = Math.floor(lineCount / (diagramCount + 1));
  let plotted = 0;
  while (lines.length < lineCount) {
    if (plotted < diagramCount && lines.length >= interval * (plotted + 1)) {
      const { fence, source } = examples[plotted % examples.length];
      const remark = fence === 'plantuml' ? "'" : '%%';
      const sample = [
        `## 图表与公式 ${plotted + 1}`, '', '```' + fence,
        remark + ' Stress sample ' + (plotted + 1), ...source.trimEnd().split('\n'), '```', '',
        '本节的离线公式示例为 $E=mc^2$。', '',
      ];
      if (sample.length > lineCount - lines.length) {
        throw new RangeError('Increase the line count to fit all diagram samples');
      }
      lines.push(...sample);
      plotted++;
    } else {
      const text = `Paragraph ${lines.length + 1}. Buffered reading tests cover local rendering, shared caches, and navigation. 文档预览保持可读。`;
      lines.push(text);
      if (lines.length < lineCount) lines.push('');
    }
  }
  if (plotted !== diagramCount) throw new RangeError('Increase the line count to fit all diagram samples');
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [requestedLines = '50000', destination = 'mdrt-stress.md', requestedDiagrams = '80'] = process.argv.slice(2);
  const welcome = await readFile(new URL('../src/content/welcome.md', import.meta.url), 'utf8');
  const output = generateStress(welcome, Number(requestedLines), Number(requestedDiagrams));
  await writeFile(destination, output);
  console.log(`${resolve(destination)} · ${requestedLines} lines · ${requestedDiagrams} diagrams · ${Buffer.byteLength(output)} bytes`);
}
