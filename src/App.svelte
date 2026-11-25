<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import EditorPane from './lib/components/EditorPane.svelte';
  import PreviewPane from './lib/components/PreviewPane.svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import StatusBar from './lib/components/StatusBar.svelte';
  import Toolbar from './lib/components/Toolbar.svelte';
  import type ExportDialog from './lib/components/ExportDialog.svelte';
  import type { ExportDocument } from './lib/export/export-utils';
  import type PreferencesDialog from './lib/components/PreferencesDialog.svelte';
  import type { DiagramClient } from './lib/diagrams/client';
  import { ScrollSync } from './lib/core/scroll-sync';
  import type { DocStats, ParsedBlock, ParseResult, WorkerRequest, WorkerResponse } from './lib/core/protocol';
  import {
    getDocument, listDocuments, putDocument, removeDocument, setSetting,
    type DraftSummary, type LocalDocument, type Settings,
  } from './lib/storage/idb';
  import { chooseMarkdownFile, markdownFilename, saveMarkdownFile } from './lib/storage/file-io';
  import { registerServiceWorker } from './lib/storage/sw-register';
  import { WorkspacePreferences, type ViewMode } from './lib/stores/app.svelte';

  let { settings, systemTheme }: { settings: Partial<Settings>; systemTheme: MediaQueryList } = $props();
  const preferences = new WorkspacePreferences(untrack(() => settings));
  let systemDark = $state(untrack(() => systemTheme.matches));
  const dark = $derived(preferences.theme === 'system' ? systemDark : preferences.theme === 'dark');
  const sidebarVisible = $derived(preferences.sidebar && !preferences.focus);
  let Preferences = $state<typeof PreferencesDialog>();
  let Exporter = $state<typeof ExportDialog>();

  let editor: EditorPane;
  let preview: PreviewPane;
  let workspace: HTMLElement;
  let worker: Worker | undefined;
  let diagramClient: DiagramClient | undefined;
  let diagramClientLoad: Promise<DiagramClient> | undefined;
  const diagrams: Pick<DiagramClient, 'render'> = {
    async render(source, theme, signal) {
      diagramClientLoad ??= import('./lib/diagrams/client').then(({ DiagramClient }) => {
        return diagramClient = new DiagramClient((request) => {
          if (!worker) throw new Error('渲染 Worker 未连接');
          worker.postMessage(request);
        });
      }).catch((error: unknown) => { diagramClientLoad = undefined; throw error; });
      const renderer = await diagramClientLoad;
      signal.throwIfAborted();
      return renderer.render(source, theme, signal);
    },
  };
  let parseTimer: ReturnType<typeof setTimeout> | undefined;
  let nextVersion = 0;
  let displayedVersion: number | undefined;
  let failedVersion = -1;
  let result = $state.raw<Omit<ParseResult, 'blocks'>>();
  let blocks = $state.raw<ParsedBlock[]>([]);
  let message = $state('');
  let savedMessage = $state('');
  let cache = $state('');
  let update = $state<(() => void) | null>(null);
  let active = $state.raw<DraftSummary>();
  let drafts = $state.raw<DraftSummary[]>([]);
  let fileHandle: FileSystemFileHandle | undefined;
  let dirty = $state(false);
  let revision = 0;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saveChain = Promise.resolve(true);
  let intent = 0;
  let restoring: { scrollTop: number; previewLine: number } | undefined;
  let ready = false;
  let alive = false;
  let line = $state(1);
  let column = $state(1);
  let activeLine = $state(1);
  const scrollSync = new ScrollSync();
  const emptyStats: DocStats = { lineCount: 1, wordCount: 0, charCount: 0, blockCount: 0, parseMs: 0 };
  let mathStyle: Promise<unknown> | undefined;

  $effect.pre(() => { document.documentElement.classList.toggle('dark', dark); });

  function schedule(length: number, flush = false): void {
    const version = ++nextVersion;
    clearTimeout(parseTimer);
    const delay = flush ? 0 : length < 50_000 ? 40 : length < 500_000 ? 120 : 220;
    parseTimer = setTimeout(() => {
      const request: WorkerRequest = {
        type: 'PARSE_DOC', docVersion: version, baseVersion: displayedVersion,
        text: editor.getText(), themeMode: dark ? 'dark' : 'light',
      };
      worker?.postMessage(request);
    }, delay);
  }

  function applyResult(next: ParseResult): void {
    if (next.hasMath) {
      void (mathStyle ??= import('katex/dist/katex.min.css')).catch(() => {
        mathStyle = undefined;
        message = '数学公式样式加载失败';
      });
    }
    const old = next.blocks.some((block) => block.unchanged)
      ? new Map(blocks.map((block) => [block.hash, block]))
      : undefined;
    blocks = old ? next.blocks.map((block) => {
      const previous = block.unchanged ? old.get(block.hash) : undefined;
      return previous ? { ...block, html: previous.html, diagram: previous.diagram } : block;
    }) : next.blocks;
    displayedVersion = next.docVersion;
    const { blocks: _blocks, ...metadata } = next;
    result = metadata;
    const position = restoring;
    if (position) {
      void tick().then(() => {
        if (restoring !== position) return;
        scrollSync.reset();
        scrollSync.accept(preferences.mode === 'preview' ? 'preview' : 'editor');
        editor.restoreScrollTop(position.scrollTop);
        preview.scrollToLine(position.previewLine);
        restoring = undefined;
      });
    }
  }

  function handleMessage({ data }: MessageEvent<WorkerResponse>): void {
    if (data.type === 'DIAGRAM_RESULT') diagramClient?.receive(data);
    if (data.type === 'PARSE_RESULT' && data.docVersion === nextVersion) applyResult(data);
    if (data.type === 'PARSE_ERROR' && data.docVersion === nextVersion) {
      message = data.reason;
      failedVersion = data.docVersion;
      restoring = undefined;
    }
  }

  function navigate(target: number): void {
    scrollSync.reset();
    scrollSync.accept('editor');
    activeLine = target;
    editor.scrollToLine(target, true);
    preview.scrollToLine(target);
  }

  function onEditorScroll(target: number): void {
    if (restoring || preferences.mode === 'preview' || !scrollSync.accept('editor')) return;
    activeLine = target;
    if (preferences.mode === 'split' && blocks.length) preview.scrollToLine(target);
    queueSave();
  }

  function onPreviewScroll(target: number): void {
    if (restoring || preferences.mode === 'editor' || !scrollSync.accept('preview')) return;
    activeLine = target;
    if (preferences.mode === 'split') editor.scrollToLine(target);
    queueSave();
  }

  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    void setSetting(key, value).catch(() => { message = '未能保存界面偏好'; });
  }

  function setMode(next: ViewMode): void {
    if (preferences.mode === next) return;
    const target = preferences.mode === 'preview' ? preview.getTopLine() : editor.readTopLine();
    preferences.mode = next;
    updateSetting('mode', next);
    void tick().then(() => {
      editor.refresh();
      scrollSync.reset();
      if (next !== 'preview') editor.scrollToLine(target);
      if (next !== 'editor') preview.scrollToLine(target);
    });
  }

  function toggleSidebar(): void {
    if (preferences.focus) preferences.focus = false;
    else preferences.sidebar = !preferences.sidebar;
    updateSetting('sidebar', preferences.sidebar);
  }

  function dragSplit(event: PointerEvent): void {
    if (event.isPrimary && event.button === 0) (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function moveSplit(event: PointerEvent): void {
    if (!(event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) return;
    const { left, width } = workspace.getBoundingClientRect();
    preferences.split = Math.max(25, Math.min(75, 100 * (event.clientX - left) / width));
  }

  function persistSplit(): void { updateSetting('split', preferences.split); }
  function splitKey(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') preferences.split = 25;
    else if (event.key === 'End') preferences.split = 75;
    else preferences.split = Math.max(25, Math.min(75, preferences.split + (event.key === 'ArrowLeft' ? -3 : 3)));
    persistSplit();
  }

  function setTheme(theme: Settings['theme']): void {
    preferences.theme = theme;
    updateSetting('theme', theme);
  }
  function setProse(prose: Settings['prose']): void {
    preferences.prose = prose;
    updateSetting('prose', prose);
  }

  async function showPreferences(): Promise<void> {
    try { Preferences = (await import('./lib/components/PreferencesDialog.svelte')).default; }
    catch { message = '无法打开排版设置'; }
  }

  async function showExport(): Promise<void> {
    if (!active) return;
    try { Exporter = (await import('./lib/components/ExportDialog.svelte')).default; }
    catch { message = '无法打开导出面板'; }
  }

  async function exportSnapshot(signal: AbortSignal): Promise<ExportDocument> {
    const id = active?.id;
    const deadline = performance.now() + 20_000;
    while (!result || displayedVersion !== nextVersion) {
      signal.throwIfAborted();
      if (active?.id !== id || failedVersion === nextVersion || performance.now() > deadline) {
        throw new Error('未能取得当前文档的完整渲染结果。');
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
    }
    signal.throwIfAborted();
    if (active?.id !== id) throw new Error('当前文档已切换。');
    return {
      title: active?.title ?? 'Markdown',
      blocks,
      toc: result.toc,
      footnotes: result.footnotes,
      hasMath: result.hasMath,
      prose: preferences.prose,
    };
  }

  function newDraft(title = '未命名文档', content = '', handle?: FileSystemFileHandle): LocalDocument {
    return { id: crypto.randomUUID(), title, content, updatedAt: Date.now(), cursorLine: 1, scrollTop: 0,
      fileHandle: handle, fileHandleName: handle?.name };
  }

  function updateList(summary: DraftSummary): void {
    drafts = [summary, ...drafts.filter((draft) => draft.id !== summary.id)].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function installDocument(draft: LocalDocument, newDocument = false): void {
    clearTimeout(saveTimer);
    restoring = { scrollTop: draft.scrollTop, previewLine: draft.previewLine ?? draft.cursorLine };
    active = { id: draft.id, title: draft.title, updatedAt: draft.updatedAt };
    fileHandle = draft.fileHandle;
    if (newDocument) updateList(active);
    dirty = newDocument;
    ++revision;
    result = undefined;
    blocks = [];
    message = '';
    savedMessage = newDocument ? '正在保存草稿' : '已自动保存';
    activeLine = restoring.previewLine;
    displayedVersion = undefined;
    editor.setDocument(draft.content, draft.cursorLine);
    schedule(draft.content.length, true);
    updateSetting('activeDocumentId', draft.id);
    if (newDocument) void flushDraft();
  }

  function queueSave(contentChange = false): void {
    if (!ready || !active || restoring) return;
    clearTimeout(saveTimer);
    revision++;
    if (contentChange) {
      dirty = true;
      savedMessage = '正在保存草稿';
    }
    saveTimer = setTimeout(() => { void flushDraft(true); }, 1_000);
  }

  function flushDraft(force = false): Promise<boolean> {
    clearTimeout(saveTimer);
    if (!active || (!dirty && !force)) return saveChain;
    const stamp = revision;
    const version = active;
    const record: LocalDocument = {
      ...version, updatedAt: Date.now(), content: editor.getText(), cursorLine: line,
      scrollTop: restoring?.scrollTop ?? editor.getScrollTop(), previewLine: restoring?.previewLine ?? (preferences.mode === 'editor' ? editor.readTopLine() : preview.getTopLine()),
      fileHandleName: fileHandle?.name, fileHandle,
    };
    saveChain = saveChain.then(async () => {
      try {
        await putDocument(record);
        const { id, title, updatedAt } = record;
        updateList({ id, title, updatedAt });
        if (active?.id === id && stamp === revision) {
          active = { id, title, updatedAt };
          dirty = false;
          savedMessage = '已自动保存';
        }
        return true;
      } catch {
        message = '草稿保存失败，请保存为本地文件';
        return false;
      }
    });
    return saveChain;
  }

  function contentChanged(length: number): void {
    restoring = undefined;
    schedule(length);
    queueSave(true);
  }

  async function switchTo(draft: LocalDocument, isNew: boolean, token: number): Promise<void> {
    if (token !== intent) return;
    let saved = await flushDraft(true);
    while (dirty && saved && token === intent) saved = await flushDraft();
    if (!alive || token !== intent || (!saved && dirty)) return;
    installDocument(draft, isNew);
  }

  async function create(): Promise<void> {
    if (ready) await switchTo(newDraft(), true, ++intent);
  }

  async function select(id: string): Promise<void> {
    if (!ready || id === active?.id) return;
    const token = ++intent;
    try {
      const draft = await getDocument(id);
      if (draft) await switchTo(draft, false, token);
    } catch { message = '无法读取该草稿'; }
  }

  async function rename(id: string, title: string): Promise<void> {
    try {
      if (id === active?.id) {
        active = { ...active, title };
        ++revision;
        dirty = true;
        await flushDraft(true);
      } else {
        const prior = await getDocument(id);
        if (!prior) return;
        const updated = { ...prior, title, updatedAt: Date.now() };
        await putDocument(updated);
        updateList({ id, title, updatedAt: updated.updatedAt });
      }
    } catch { message = '草稿重命名失败'; }
  }

  async function duplicate(id: string): Promise<void> {
    const token = ++intent;
    try {
      const current = active;
      const draft = id === current?.id
        ? newDraft(current.title + ' 副本', editor.getText())
        : await getDocument(id).then((entry) => entry && newDraft(entry.title + ' 副本', entry.content));
      if (draft) await switchTo(draft, true, token);
    } catch { message = '无法复制草稿'; }
  }

  async function remove(id: string): Promise<void> {
    const draft = drafts.find((entry) => entry.id === id);
    if (!draft || !window.confirm(`删除本地草稿「${draft.title}」？`)) return;
    const token = ++intent;
    try {
      const wasActive = id === active?.id;
      if (wasActive) clearTimeout(saveTimer);
      await saveChain;
      if (token !== intent) return;
      const replacement = wasActive ? drafts.find((entry) => entry.id !== id) : undefined;
      const next = replacement ? await getDocument(replacement.id) : undefined;
      if (token !== intent) return;
      if (wasActive) clearTimeout(saveTimer);
      await removeDocument(id);
      drafts = drafts.filter((entry) => entry.id !== id);
      if (id === active?.id && token === intent) installDocument(next ?? newDraft(), !next);
    } catch {
      message = '无法删除该草稿';
      if (id === active?.id && dirty) queueSave();
    }
  }

  async function openFile(file: File, handle?: FileSystemFileHandle): Promise<void> {
    if (!ready) return;
    if (!markdownFilename.test(file.name)) { message = '请选择 Markdown 或纯文本文件'; return; }
    if (file.size > 10 * 1024 * 1024 && !window.confirm('文件超过 10 MB，继续打开？')) return;
    const token = ++intent;
    try {
      const text = await file.text();
      await switchTo(newDraft(file.name, text, handle), true, token);
    } catch { message = '无法读取该文件'; }
  }

  async function pickFile(): Promise<void> {
    try {
      const selected = await chooseMarkdownFile();
      if (selected) await openFile(selected.file, selected.handle);
    } catch { message = '无法打开文件'; }
  }

  async function saveFile(): Promise<void> {
    if (!active) return;
    const id = active.id;
    try {
      const saved = await saveMarkdownFile(active.title, editor.getText(), fileHandle);
      if (!saved.saved || active?.id !== id) return;
      if (saved.handle) fileHandle = saved.handle;
      if (await flushDraft(true)) message = '已保存 Markdown 文件';
    } catch { message = '无法保存 Markdown 文件'; }
  }

  function shortcuts(event: KeyboardEvent): void {
    if (event.key === 'Escape' && preferences.focus && !document.querySelector('dialog[open]')) {
      preferences.focus = false;
      return;
    }
    if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.isComposing) return;
    const key = event.key.toLowerCase();
    if (key === 's') { event.preventDefault(); void saveFile(); }
    else if (key === 'o') { event.preventDefault(); void pickFile(); }
    else if (key === 'e') { event.preventDefault(); void showExport(); }
    else if (key === '\\') { event.preventDefault(); toggleSidebar(); }
    else if (event.shiftKey && key === 'p') {
      event.preventDefault();
      setMode(preferences.mode === 'editor' ? 'split' : preferences.mode === 'split' ? 'preview' : 'editor');
    }
  }

  async function installWelcome(): Promise<void> {
    const welcome = await import('./content/welcome.md?raw').then((source) => source.default).catch(() => '');
    if (alive) installDocument(newDraft(welcome ? '欢迎使用 MDRenderTool' : '未命名文档', welcome), true);
  }

  async function initialize(): Promise<void> {
    try {
      const rows = await listDocuments();
      const selected = rows.find((draft) => draft.id === settings.activeDocumentId) ?? rows[0];
      const draft = selected ? await getDocument(selected.id) : undefined;
      if (!alive) return;
      drafts = rows;
      if (draft) installDocument(draft);
      else await installWelcome();
    } catch {
      if (alive) await installWelcome();
    } finally {
      ready = alive;
    }
  }

  onMount(() => {
    alive = true;
    worker = new Worker(new URL('./lib/worker/render.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = handleMessage;
    worker.onerror = () => { message = '渲染进程无法启动'; };
    const readSystemTheme = () => { systemDark = systemTheme.matches; };
    const saveOnHide = () => { if (document.visibilityState === 'hidden' && active) void flushDraft(true); };
    systemTheme.addEventListener('change', readSystemTheme);
    document.addEventListener('visibilitychange', saveOnHide);
    const unregister = registerServiceWorker({
      onReady: () => { cache = '离线可用'; },
      onUpdate: (applyUpdate) => { update = () => { void flushDraft(true).then((saved) => { if (saved || !dirty) applyUpdate(); }); }; },
      onError: () => { cache = '离线缓存不可用'; },
    });
    void initialize();
    return () => {
      alive = ready = false;
      unregister();
      clearTimeout(parseTimer);
      clearTimeout(saveTimer);
      diagramClient?.close();
      worker?.terminate();
      worker = undefined;
      document.removeEventListener('visibilitychange', saveOnHide);
      systemTheme.removeEventListener('change', readSystemTheme);
    };
  });
</script>

<svelte:window onkeydown={shortcuts} />
<Toolbar mode={preferences.mode} {setMode} sidebar={sidebarVisible} {toggleSidebar} {dark}
  toggleTheme={() => setTheme(dark ? 'light' : 'dark')} title={active?.title ?? 'MDRenderTool'} {dirty} open={pickFile} save={saveFile}
  preferences={showPreferences} exportFile={showExport} focus={preferences.focus} toggleFocus={() => { preferences.focus = !preferences.focus; }} />
<div class="workbench" class:has-sidebar={sidebarVisible}>
  {#if sidebarVisible}
    <Sidebar toc={result?.toc ?? []} {activeLine} jump={navigate} {drafts} activeDraft={active?.id}
      unsaved={dirty} {create} {select} {rename} {duplicate} {remove} />
  {/if}
  <main class="panes" class:split-mode={preferences.mode === 'split'} bind:this={workspace} style:--split={preferences.split + '%'}>
    <section class="editor-pane" aria-label="编辑器" hidden={preferences.mode === 'preview'}>
      <EditorPane bind:this={editor} onChange={contentChanged} onScroll={onEditorScroll} onPosition={(nextLine, nextColumn) => {
        line = nextLine;
        column = nextColumn;
        queueSave();
      }} onFile={openFile} onFeatureError={(error) => { message = error; }} />
    </section>
    {#if preferences.mode === 'split'}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (Focusable ARIA splitter.) -->
      <div class="split-handle" role="separator" aria-label="调整分栏宽度" aria-orientation="vertical"
        aria-valuemin="25" aria-valuemax="75" aria-valuenow={Math.round(preferences.split)} tabindex="0"
        onpointerdown={dragSplit} onpointermove={moveSplit} onlostpointercapture={persistSplit}
        ondblclick={() => { preferences.split = 50; persistSplit(); }} onkeydown={splitKey}></div>
    {/if}
    <section class="preview-pane" aria-label="预览" hidden={preferences.mode === 'editor'}>
      <PreviewPane bind:this={preview} {blocks} notes={result?.footnotes ?? {}} prose={preferences.prose}
        {diagrams} theme={dark ? 'dark' : 'light'} onScroll={onPreviewScroll} onNavigate={navigate} />
    </section>
  </main>
</div>
{#if !preferences.focus}
  <StatusBar {line} {column} stats={result?.stats ?? emptyStats} {cache} message={message || savedMessage} {update} />
{/if}
{#if Preferences}
  <Preferences theme={preferences.theme} prose={preferences.prose} onTheme={setTheme} onProse={setProse} onClose={() => { Preferences = undefined; }} />
{/if}

{#if Exporter}
  <Exporter theme={dark ? 'dark' : 'light'} {diagrams} snapshot={exportSnapshot} onClose={() => { Exporter = undefined; }} />
{/if}
