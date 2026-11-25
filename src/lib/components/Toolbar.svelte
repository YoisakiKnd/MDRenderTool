<script lang="ts">
  import { Columns2, Download, FileText, Focus, FolderOpen, Moon, PanelLeft, PenLine, Save, Sun, Type } from 'lucide-svelte';
  import type { ViewMode } from '../stores/app.svelte';
  import Button from './ui/Button.svelte';

  let { mode, setMode, sidebar, toggleSidebar, dark, toggleTheme, title, dirty, open, save, preferences, exportFile, focus, toggleFocus }: {
    mode: ViewMode; setMode: (mode: ViewMode) => void; sidebar: boolean; toggleSidebar: () => void; dark: boolean;
    toggleTheme: () => void; title: string; dirty: boolean; open: () => void; save: () => void; preferences: () => void; exportFile: () => void;
    focus: boolean; toggleFocus: () => void;
  } = $props();
  const modes = [
    { value: 'editor', title: '编辑', icon: PenLine },
    { value: 'split', title: '双栏', icon: Columns2 },
    { value: 'preview', title: '预览', icon: FileText },
  ] as const;
</script>

<header class="app-bar workspace-toolbar">
  <div class="toolbar-left">
    <div class="bar-actions document-heading">
      <Button class="icon-button sidebar-toggle" aria-label="切换侧栏" title="切换侧栏 (⌘\)" aria-pressed={sidebar} onclick={toggleSidebar}>
        <PanelLeft size={16} />
      </Button>
      <strong class="document-title" title={title}>{title}</strong>
      {#if dirty}<span class="unsaved-dot" title="草稿有未保存的修改" aria-label="草稿有未保存的修改"></span>{/if}
    </div>
    <span class="toolbar-divider" aria-hidden="true"></span>
    <div class="bar-actions file-actions">
      <Button aria-label="打开" title="打开本地文件 (⌘O)" onclick={open}><FolderOpen size={14} /><span>打开</span></Button>
      <Button aria-label="保存" title="保存 Markdown 文件 (⌘S)" onclick={save}><Save size={14} /><span>保存</span></Button>
    </div>
  </div>

  <div class="view-modes" role="group" aria-label="视图模式">
    {#each modes as option (option.value)}
      <Button class="mode-button" aria-pressed={mode === option.value} onclick={() => setMode(option.value)}>
        <option.icon size={13.5} aria-hidden="true" /><span>{option.title}</span>
      </Button>
    {/each}
  </div>

  <div class="toolbar-right">
    <div class="bar-actions preferences-actions">
      <Button class="icon-button" aria-label="阅读排版" title="阅读排版" onclick={preferences}><Type size={15} /></Button>
      <Button class="icon-button" aria-label="切换亮暗主题" title="切换亮暗主题" onclick={toggleTheme}>
        {#if dark}<Moon size={15} />{:else}<Sun size={15} />{/if}
      </Button>
      <Button class="icon-button focus-toggle" aria-label="专注模式" title="专注模式" aria-pressed={focus} onclick={toggleFocus}><Focus size={15} /></Button>
    </div>
    <span class="toolbar-divider" aria-hidden="true"></span>
    <Button class="toolbar-export" aria-label="导出" title="导出文档 (⌘E)" onclick={exportFile}><Download size={14} /><span>导出</span></Button>
  </div>
</header>
