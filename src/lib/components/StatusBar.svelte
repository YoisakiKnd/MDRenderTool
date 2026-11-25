<script lang="ts">
  import type { DocStats } from '../core/protocol';
  import Button from './ui/Button.svelte';
  let { line, column, stats, cache, message, update }: {
    line: number; column: number; stats: DocStats; cache: string;
    message: string; update: (() => void) | null;
  } = $props();
</script>

<footer class="status-bar workspace-status">
  <div class="status-metrics">
    <span>行 {line}，列 {column}</span>
    <span class="status-sep" aria-hidden="true">·</span>
    <span>{stats.wordCount.toLocaleString()} 字</span>
    <span class="status-sep" aria-hidden="true">·</span>
    <span>{stats.lineCount.toLocaleString()} 行</span>
    <span class="status-sep" aria-hidden="true">·</span>
    <span>{stats.blockCount.toLocaleString()} 块</span>
    <span class="status-sep" aria-hidden="true">·</span>
    <span>{stats.parseMs.toFixed(1)} ms</span>
  </div>
  <div class="status-metrics">
    {#if message}<span role="status">{message}</span>{/if}
    {#if message && cache}<span class="status-sep" aria-hidden="true">·</span>{/if}
    {#if cache}
      <span class="status-cache">
        {#if cache === '离线可用'}<span class="status-dot" aria-hidden="true"></span>{/if}
        {cache}
      </span>
    {/if}
    {#if update}<Button class="update-button" onclick={update}>发现新版本，点击刷新</Button>{/if}
  </div>
</footer>
