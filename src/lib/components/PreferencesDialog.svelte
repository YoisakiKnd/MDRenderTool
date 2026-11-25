<script lang="ts">
  import { onMount } from 'svelte';
  import { X } from 'lucide-svelte';
  import type { Settings } from '../storage/idb';
  import Button from './ui/Button.svelte';

  let { theme, prose, onTheme, onProse, onClose }: {
    theme: Settings['theme']; prose: Settings['prose'];
    onTheme: (theme: Settings['theme']) => void;
    onProse: (prose: Settings['prose']) => void;
    onClose: () => void;
  } = $props();
  let dialog: HTMLDialogElement;

  const proseOptions: Array<{ value: Settings['prose']; label: string }> = [
    { value: 'minimal', label: '极简' },
    { value: 'github', label: 'GitHub' },
    { value: 'document', label: '书刊' },
  ];
  const themeOptions: Array<{ value: Settings['theme']; label: string }> = [
    { value: 'system', label: '跟随系统' },
    { value: 'light', label: '浅色' },
    { value: 'dark', label: '深色' },
  ];

  onMount(() => {
    dialog.showModal();
    return () => dialog.close();
  });
</script>

<dialog class="workspace-dialog" bind:this={dialog} aria-label="阅读排版" oncancel={onClose}>
  <div class="sheet-header">
    <h2 class="dialog-title">外观与排版</h2>
    <Button class="icon-button" aria-label="关闭" onclick={onClose}><X size={15} /></Button>
  </div>
  <div class="sheet-body">
    <div class="field-group">
      <span class="field-label">阅读排版风格</span>
      <div class="option-grid" role="group" aria-label="阅读排版风格">
        {#each proseOptions as option (option.value)}
          <button type="button" class="option-pill" aria-pressed={prose === option.value} onclick={() => onProse(option.value)}>
            {option.label}
          </button>
        {/each}
      </div>
    </div>
    <div class="field-group">
      <span class="field-label">界面外观</span>
      <div class="option-grid" role="group" aria-label="界面外观">
        {#each themeOptions as option (option.value)}
          <button type="button" class="option-pill" aria-pressed={theme === option.value} onclick={() => onTheme(option.value)}>
            {option.label}
          </button>
        {/each}
      </div>
    </div>
  </div>
  <div class="sheet-footer">
    <Button class="primary-button" onclick={onClose}>完成</Button>
  </div>
</dialog>
