<script lang="ts">
  import { onMount } from 'svelte';
  import { X } from 'lucide-svelte';
  import type { ThemeMode } from '../core/protocol';
  import type { DiagramClient } from '../diagrams/client';
  import { prepareAllBlocksForExport, type ExportDocument, type ExportFormat, type ExportJob, type ExportOptions } from '../export/export-utils';
  import Button from './ui/Button.svelte';

  let { theme, diagrams, snapshot, onClose }: {
    theme: ThemeMode; diagrams: Pick<DiagramClient, 'render'>; snapshot: (signal: AbortSignal) => Promise<ExportDocument>;
    onClose: () => void;
  } = $props();

  let dialog: HTMLDialogElement;
  let format = $state<ExportFormat>('html');
  let selectedTheme = $state<ThemeMode>('light');
  let dpi = $state<2 | 3>(2);
  let toc = $state(true);
  let transparent = $state(false);
  let busy = $state(false);
  let errorText = $state('');
  let status = $state({ label: '', done: 0, total: 0 });
  let cancel: AbortController | undefined;

  const formats: Array<{ value: ExportFormat; label: string }> = [
    { value: 'html', label: 'HTML' },
    { value: 'pdf', label: 'PDF' },
    { value: 'png', label: 'PNG' },
    { value: 'docx', label: 'DOCX' },
  ];
  const loaders = {
    html: () => import('../export/export-html'),
    pdf: () => import('../export/export-pdf'),
    png: () => import('../export/export-png'),
    docx: () => import('../export/export-docx'),
  };

  const progressPercent = $derived(status.total > 0 ? Math.min(100, Math.round((status.done / status.total) * 100)) : 0);

  onMount(() => {
    selectedTheme = theme;
    dialog.showModal();
    return () => { cancel?.abort(); dialog.close(); };
  });

  function close(event?: Event): void {
    event?.preventDefault();
    if (busy) cancel?.abort();
    else onClose();
  }

  async function start(): Promise<void> {
    if (busy) return;
    busy = true;
    errorText = '';
    status = { label: '等待当前文档渲染', done: 0, total: 0 };
    cancel = new AbortController();
    const signal = cancel.signal;
    const options: ExportOptions = { format, theme: format === 'docx' ? 'light' : selectedTheme, dpi, toc, transparent };
    const progress: ExportJob['progress'] = (label, done, total) => { status = { label, done, total }; };
    try {
      const source = await snapshot(signal);
      const blocks = await prepareAllBlocksForExport(source.blocks, diagrams, options.theme, signal, progress);
      signal.throwIfAborted();
      const exporter = await loaders[options.format]();
      signal.throwIfAborted();
      await exporter.exportDocument({ ...source, blocks, options, signal, progress });
      onClose();
    } catch (error) {
      if (signal.aborted) {
        errorText = '已取消导出';
      } else {
        errorText = error instanceof Error ? error.message : '导出失败';
      }
    } finally {
      busy = false;
      cancel = undefined;
    }
  }
</script>

<dialog class="workspace-dialog export-dialog" bind:this={dialog} aria-label="导出文档" oncancel={close}>
  <div class="sheet-header">
    <h2 class="dialog-title">导出文档</h2>
    <Button class="icon-button" aria-label="关闭" onclick={close}><X size={15} /></Button>
  </div>
  <form onsubmit={(event) => { event.preventDefault(); void start(); }}>
    <div class="sheet-body">
      <div class="field-group">
        <span class="field-label">导出格式</span>
        <div class="option-grid" role="group" aria-label="导出格式">
          {#each formats as item (item.value)}
            <button type="button" class="option-pill" disabled={busy} aria-pressed={format === item.value}
              onclick={() => { format = item.value; }}>
              {item.label}
            </button>
          {/each}
        </div>
      </div>

      {#if format !== 'docx'}
        <div class="field-group">
          <span class="field-label">导出主题</span>
          <div class="option-grid" role="group" aria-label="导出主题">
            <button type="button" class="option-pill" disabled={busy} aria-pressed={selectedTheme === 'light'}
              onclick={() => { selectedTheme = 'light'; }}>浅色</button>
            <button type="button" class="option-pill" disabled={busy} aria-pressed={selectedTheme === 'dark'}
              onclick={() => { selectedTheme = 'dark'; }}>深色</button>
          </div>
        </div>
      {/if}

      {#if format === 'html'}
        <label class="toggle-row">
          <span>包含可折叠目录导航</span>
          <input type="checkbox" disabled={busy} bind:checked={toc} />
        </label>
      {/if}

      {#if format === 'png'}
        <div class="field-group">
          <span class="field-label">输出清晰度</span>
          <div class="option-grid" role="group" aria-label="输出清晰度">
            <button type="button" class="option-pill" disabled={busy} aria-pressed={dpi === 2} onclick={() => { dpi = 2; }}>2× 高清</button>
            <button type="button" class="option-pill" disabled={busy} aria-pressed={dpi === 3} onclick={() => { dpi = 3; }}>3× 超清</button>
          </div>
        </div>
        <label class="toggle-row">
          <span>透明背景</span>
          <input type="checkbox" disabled={busy} bind:checked={transparent} />
        </label>
      {/if}

      {#if busy}
        <div class="export-progress" role="status">
          <span>{status.label}{status.total ? ` (${status.done} / ${status.total})` : ''}</span>
          <div class="progress-track">
            {#if status.total > 0}
              <div class="progress-fill" style:width={progressPercent + '%'}></div>
            {:else}
              <div class="progress-fill indeterminate"></div>
            {/if}
          </div>
        </div>
      {/if}

      {#if errorText}<p class="export-error" role="status">{errorText}</p>{/if}
    </div>

    <div class="sheet-footer">
      <Button type="button" onclick={close}>{busy ? '取消导出' : '取消'}</Button>
      <Button type="submit" class="primary-button" disabled={busy}>{format === 'pdf' ? '打开系统打印' : '开始导出'}</Button>
    </div>
  </form>
</dialog>
