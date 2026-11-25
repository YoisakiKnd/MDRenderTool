<script lang="ts">
  import { onDestroy } from 'svelte';
  import { CircleAlert, Copy, Download, Maximize } from 'lucide-svelte';
  import type { DiagramSource, ThemeMode } from '../core/protocol';
  import type { DiagramClient } from '../diagrams/client';
  import Button from './ui/Button.svelte';
  import DiagramLightbox from './DiagramLightbox.svelte';

  let { diagram, startLine, client, theme, navigate }: {
    diagram: DiagramSource; startLine: number; client: Pick<DiagramClient, 'render'>; theme: ThemeMode; navigate: (line: number) => void;
  } = $props();
  type Answer = Awaited<ReturnType<DiagramClient['render']>>;
  let answer = $state.raw<Answer>();
  let expanded = $state(false);
  let copyStatus = $state('');
  let pngMenu = $state(false);
  let transparent = $state(true);
  let downloadTask: AbortController | undefined;
  onDestroy(() => downloadTask?.abort());

  async function download(dpi: 2 | 3): Promise<void> {
    if (!answer?.svg || !answer.width || !answer.height) return;
    downloadTask?.abort();
    const task = downloadTask = new AbortController();
    const graphic = { svg: answer.svg, width: answer.width, height: answer.height };
    pngMenu = false;
    try {
      const { exportDiagramPng } = await import('../export/export-png');
      await exportDiagramPng(graphic, answer?.diagramType ?? '图表', theme, dpi, transparent, task.signal);
      if (!task.signal.aborted) copyStatus = '已生成 PNG';
    } catch {
      if (!task.signal.aborted) copyStatus = 'PNG 导出失败';
    }
  }

  $effect(() => {
    const current = diagram;
    const currentTheme = theme;
    const rendering = new AbortController();
    void client.render(current, currentTheme, rendering.signal).then((result) => {
      if (!rendering.signal.aborted) answer = result;
    }).catch((error: unknown) => {
      if (!rendering.signal.aborted) answer = { status: 'error', reason: error instanceof Error ? error.message : '图表渲染失败', renderMs: 0 };
    });
    return () => rendering.abort();
  });

  async function copy(): Promise<void> {
    if (!answer?.svg) return;
    try {
      await navigator.clipboard.writeText(answer.svg);
      copyStatus = '已复制';
    } catch {
      copyStatus = '复制失败';
    }
  }
</script>

{#if answer?.status === 'ok' && answer.svg && answer.width && answer.height}
  <div class="diagram-block">
    <div class="diagram-tools">
      <Button aria-label="全屏查看" title="全屏查看" onclick={() => { expanded = true; }}><Maximize size={16} /></Button>
      <Button aria-label="复制 SVG 源码" title="复制 SVG 源码" onclick={copy}><Copy size={16} /></Button>
      <Button aria-label="导出图表 PNG" title="导出图表 PNG" aria-expanded={pngMenu} onclick={() => { pngMenu = !pngMenu; }}><Download size={16} /></Button>
      {#if pngMenu}
        <div class="diagram-png-options">
          <label><input type="checkbox" bind:checked={transparent} /> 透明背景</label>
          <Button onclick={() => download(2)}>2× PNG</Button>
          <Button onclick={() => download(3)}>3× PNG</Button>
        </div>
      {/if}
      {#if copyStatus}<span role="status">{copyStatus}</span>{/if}
    </div>
    {@html answer.svg}
    {#if expanded}<DiagramLightbox svg={answer.svg} width={answer.width} height={answer.height} onClose={() => { expanded = false; }} />{/if}
  </div>
{:else if answer}
  <div class="diagram-fallback">
    <div class="diagram-diagnostic"><CircleAlert size={17} />
      <strong>{answer.status === 'unsupported' ? '暂不支持该图表类型或语法' : '图表语法有误'}</strong>
    </div>
    <p>{answer.reason}</p>
    {#if answer.errorLine}
      <Button onclick={() => navigate(startLine + (answer?.errorLine ?? 1))}>跳转至错误行</Button>
    {/if}
    <details>
      <summary>查看原始代码</summary>
      <pre><code>{diagram.source}</code></pre>
    </details>
  </div>
{:else}
  <div class="diagram-loading" role="status">正在渲染图表</div>
{/if}
