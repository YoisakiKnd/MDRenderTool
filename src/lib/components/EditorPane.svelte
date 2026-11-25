<script lang="ts">
  import { onMount } from 'svelte';
  import { Compartment, EditorSelection, EditorState, Transaction, type Extension } from '@codemirror/state';
  import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
  import {
    cursorDocEnd, cursorDocStart, deleteCharBackward, deleteCharForward, history, historyKeymap,
    insertNewlineKeepIndent, selectAll, selectDocEnd, selectDocStart,
  } from '@codemirror/commands';

  let { onChange, onScroll, onPosition, onFile, onFeatureError }: {
    onChange: (length: number) => void;
    onScroll: (line: number) => void;
    onPosition: (line: number, column: number) => void;
    onFile: (file: File) => void;
    onFeatureError: (message: string) => void;
  } = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;
  const languageSlot = new Compartment();
  const searchSlot = new Compartment();
  let languageExtension: Extension = [];
  let searchExtension: Extension = [];
  let languageLoad: Promise<void> | undefined;
  let searchLoad: Promise<typeof import('./editor-search')> | undefined;

  function configureLanguage(): void {
    languageLoad ??= import('./editor-syntax')
      .then(({ sourceSyntax }) => {
        languageExtension = sourceSyntax;
        view?.dispatch({ effects: languageSlot.reconfigure(languageExtension) });
      })
      .catch(() => { languageLoad = undefined; onFeatureError('编辑器语法扩展无法加载'); });
  }

  function openSearch(): boolean {
    searchLoad ??= import('./editor-search').then((module) => {
      searchExtension = module.searchExtension;
      view?.dispatch({ effects: searchSlot.reconfigure(searchExtension) });
      return module;
    });
    void searchLoad.then((module) => { if (view) module.openSearchPanel(view); }).catch(() => {
      searchLoad = undefined;
      onFeatureError('编辑器查找扩展无法加载');
    });
    return true;
  }

  function surround(before: string, after = before): boolean {
    if (!view) return false;
    const doc = view.state.doc;
    const change = view.state.changeByRange((range) => {
      const selected = doc.sliceString(range.from, range.to);
      return {
        changes: { from: range.from, to: range.to, insert: before + selected + after },
        range: EditorSelection.range(range.from + before.length, range.to + before.length),
      };
    });
    view.dispatch({ ...change, annotations: Transaction.userEvent.of('input') });
    return true;
  }

  const baseExtensions = [
    lineNumbers(), drawSelection(), highlightActiveLine(), history(),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': 'Markdown 源码' }),
    keymap.of([
      { key: 'Mod-b', run: () => surround('**') },
      { key: 'Mod-i', run: () => surround('*') },
      { key: 'Mod-k', run: () => surround('[', '](https://)') },
      { key: 'Mod-`', run: () => surround('`') },
      { key: 'Mod-f', run: openSearch },
      { key: 'Mod-a', run: selectAll },
      { key: 'Enter', run: insertNewlineKeepIndent },
      { key: 'Backspace', run: deleteCharBackward },
      { key: 'Delete', run: deleteCharForward },
      { key: 'Mod-Home', mac: 'Mod-ArrowUp', run: cursorDocStart, shift: selectDocStart },
      { key: 'Mod-End', mac: 'Mod-ArrowDown', run: cursorDocEnd, shift: selectDocEnd },
      ...historyKeymap,
    ]),
    EditorView.domEventHandlers({
      focus: configureLanguage,
      scroll: () => { onScroll(readTopLine()); },
      dragover: (event) => {
        if (!event.dataTransfer?.types.includes('Files')) return false;
        event.preventDefault();
        return true;
      },
      drop: (event) => {
        const file = event.dataTransfer?.files.item(0);
        if (!file) return false;
        event.preventDefault();
        onFile(file);
        return true;
      },
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange(update.state.doc.length);
      if (update.selectionSet || update.docChanged) reportPosition();
    }),
  ];

  function extensions(): Extension {
    return [baseExtensions, languageSlot.of(languageExtension), searchSlot.of(searchExtension)];
  }

  onMount(() => {
    view = new EditorView({ state: EditorState.create({ extensions: extensions() }), parent: host });
    return () => {
      view?.destroy();
      view = undefined;
    };
  });

  export function getText(): string {
    return view?.state.doc.toString() ?? '';
  }

  export function setDocument(text: string, cursorLine = 1): void {
    if (!view) return;
    const state = EditorState.create({ doc: text, extensions: extensions() });
    const line = state.doc.line(Math.max(1, Math.min(state.doc.lines, cursorLine)));
    view.setState(state.update({ selection: { anchor: line.from } }).state);
    reportPosition();
  }

  function reportPosition(): void {
    if (!view) return;
    const position = view.state.selection.main.head;
    const line = view.state.doc.lineAt(position);
    onPosition(line.number, position - line.from + 1);
  }

  export function readTopLine(): number {
    if (!view) return 1;
    const offset = Math.max(0, view.scrollDOM.getBoundingClientRect().top - view.documentTop);
    const block = view.lineBlockAtHeight(offset);
    const line = view.state.doc.lineAt(block.from).number;
    return line + Math.min(.999, Math.max(0, (offset - block.top) / Math.max(1, block.height)));
  }

  export function scrollToLine(value: number, select = false): void {
    if (!view) return;
    const number = Math.max(1, Math.min(view.state.doc.lines, Math.floor(value)));
    const line = view.state.doc.line(number);
    if (select) {
      view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start' }) });
      return;
    }
    const block = view.lineBlockAt(line.from);
    view.scrollDOM.scrollTop = block.top + view.documentPadding.top + Math.max(0, value - number) * block.height;
  }

  export function getScrollTop(): number {
    return view?.scrollDOM.scrollTop ?? 0;
  }

  export function restoreScrollTop(scrollTop: number): void {
    view?.requestMeasure({
      read: () => scrollTop,
      write: (offset, current) => { current.scrollDOM.scrollTop = offset; },
    });
  }

  export function refresh(): void {
    view?.requestMeasure();
  }
</script>

<div class="editor-host" bind:this={host}></div>
