<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { FenwickTree } from '../core/fenwick';
  import { LRUCache } from '../core/lru';
  import { lineAtOffset, offsetAtLine, visibleWindow } from '../core/scroll-sync';
  import type DiagramBlock from './DiagramBlock.svelte';
  import type { DiagramClient } from '../diagrams/client';
  import type { ThemeMode, FootnoteEntry, ParsedBlock } from '../core/protocol';
  import type { Settings } from '../storage/idb';

  let { blocks, notes, prose, diagrams, theme, onScroll, onNavigate }: {
    blocks: ParsedBlock[];
    notes: Record<string, FootnoteEntry>;
    prose: Settings['prose'];
    diagrams: Pick<DiagramClient, 'render'>;
    theme: ThemeMode;
    onScroll: (line: number) => void;
    onNavigate: (line: number) => void;
  } = $props();

  let viewport: HTMLDivElement;
  let applied = $state.raw<ParsedBlock[]>([]);
  let scrollTop = $state(0);
  let viewportHeight = $state(0);
  let revision = $state(0);
  let note = $state<{ note: FootnoteEntry; left: number; top: number }>();
  let layoutProse: Settings['prose'] | undefined;
  let width = 0;
  let tree = new FenwickTree(0);
  let heights = new Float64Array(0);
  let observer: ResizeObserver | undefined;
  let resize: ResizeObserver | undefined;
  let noteTimer: ReturnType<typeof setTimeout> | undefined;
  let programmaticScrollTop: number | undefined;
  const measured = new LRUCache<string, number>({ maxEntries: 4_000, maxBytes: 4_000 * 80 });
  const mounted = new Set<HTMLElement>();
  const [start, end] = $derived.by(() => {
    if (revision >= 0) return visibleWindow(tree, scrollTop, viewportHeight);
    return [0, 0];
  });
  const visible = $derived(applied.slice(start, end));
  let Diagram = $state<typeof DiagramBlock>();
  let diagramLoad: Promise<void> | undefined;
  let diagramUnavailable = $state(false);
  $effect(() => {
    if (!visible.some((block) => block.diagram)) return;
    diagramLoad ??= import('./DiagramBlock.svelte').then((module) => { Diagram = module.default; }).catch(() => {
      diagramLoad = undefined;
      diagramUnavailable = true;
    });
  });
  const total = $derived(revision >= 0 ? tree.totalHeight() : 0);
  const offset = $derived(revision >= 0 ? tree.prefixSum(start) : 0);

  function rebuild(next: ParsedBlock[]): void {
    heights = Float64Array.from(next, (block) => measured.get(block.hash) ?? block.estimatedHeight);
    tree = new FenwickTree(heights);
    applied = next;
    revision++;
  }

  $effect.pre(() => {
    if (layoutProse !== prose) {
      layoutProse = prose;
      measured.clear();
    }
    const next = blocks;
    untrack(() => rebuild(next));
  });

  function watchBlock(element: HTMLElement) {
    mounted.add(element);
    observer?.observe(element);
    return { destroy() { mounted.delete(element); observer?.unobserve(element); } };
  }

  function onMeasure(entries: ResizeObserverEntry[]): void {
    const first = tree.findIndexByOffset(viewport.scrollTop);
    let correction = 0;
    let changed = false;
    for (const entry of entries) {
      const element = entry.target as HTMLElement;
      const index = Number(element.dataset.index);
      const block = applied[index];
      if (!mounted.has(element) || !block || element.dataset.hash !== block.hash) continue;
      const height = Math.max(1, entry.borderBoxSize?.[0]?.blockSize ?? element.offsetHeight);
      const delta = height - heights[index];
      if (Math.abs(delta) < .01) continue;
      heights[index] = height;
      measured.set(block.hash, height, 80);
      tree.update(index, delta);
      if (index < first) correction += delta;
      changed = true;
    }
    if (!changed) return;
    revision++;
    if (correction) setScrollTop(viewport.scrollTop + correction);
    else scrollTop = viewport.scrollTop;
  }

  function setScrollTop(next: number): void {
    const before = viewport.scrollTop;
    viewport.scrollTop = next;
    const after = viewport.scrollTop;
    scrollTop = after;
    if (Math.abs(after - before) >= 0.5) programmaticScrollTop = after;
  }

  function dismissSoon(): void {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { note = undefined; }, 180);
  }

  function showNote(link: HTMLElement): void {
    const id = link.dataset.footnoteId;
    if (!id || !notes[id]) return;
    clearTimeout(noteTimer);
    const bounds = link.getBoundingClientRect();
    note = {
      note: notes[id],
      left: Math.max(8, Math.min(bounds.left, innerWidth - 336)),
      top: Math.max(8, Math.min(bounds.bottom + 8, innerHeight - 148)),
    };
  }

  function handleFocus(event: Event): void {
    const link = (event.target as HTMLElement).closest<HTMLElement>('[data-footnote-id]');
    if (link) showNote(link);
  }

  function handleLink(event: MouseEvent): void {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!link) return;
    if (link.dataset.footnoteId) {
      event.preventDefault();
      showNote(link);
      return;
    }
    let id: string;
    try { id = decodeURIComponent(link.hash.slice(1)); } catch { return; }
    const heading = applied.find((block) => block.heading?.slug === id);
    if (heading) {
      event.preventDefault();
      onNavigate(heading.startLine);
    } else if (id.startsWith('fnref')) {
      const reference = document.getElementById(id);
      if (reference) {
        event.preventDefault();
        reference.scrollIntoView({ block: 'center' });
        reference.focus({ preventScroll: true });
      }
    }
  }

  function scrolled(): void {
    const current = viewport.scrollTop;
    scrollTop = current;
    note = undefined;
    if (programmaticScrollTop !== undefined && Math.abs(current - programmaticScrollTop) < 1.5) {
      programmaticScrollTop = undefined;
      return;
    }
    programmaticScrollTop = undefined;
    if (applied.length) onScroll(lineAtOffset(applied, tree, current));
  }

  onMount(() => {
    observer = new ResizeObserver(onMeasure);
    for (const element of mounted) observer.observe(element);
    resize = new ResizeObserver(([entry]) => {
      if (!entry.contentRect.width) return;
      viewportHeight = entry.contentRect.height;
      if (width && Math.abs(width - entry.contentRect.width) > 1) {
        const line = lineAtOffset(applied, tree, viewport.scrollTop);
        measured.clear();
        rebuild(applied);
        scrollToLine(line);
      }
      width = entry.contentRect.width;
    });
    resize.observe(viewport);
    viewport.addEventListener('pointerover', handleFocus);
    viewport.addEventListener('focusin', handleFocus);
    viewport.addEventListener('pointerout', dismissSoon);
    viewport.addEventListener('focusout', dismissSoon);
    viewport.addEventListener('click', handleLink);
    return () => {
      observer?.disconnect();
      resize?.disconnect();
      clearTimeout(noteTimer);
      viewport.removeEventListener('pointerover', handleFocus);
      viewport.removeEventListener('focusin', handleFocus);
      viewport.removeEventListener('pointerout', dismissSoon);
      viewport.removeEventListener('focusout', dismissSoon);
      viewport.removeEventListener('click', handleLink);
    };
  });

  export function scrollToLine(line: number): void {
    if (!viewport) return;
    setScrollTop(offsetAtLine(applied, tree, line));
  }

  export function getTopLine(): number {
    return viewport ? lineAtOffset(applied, tree, viewport.scrollTop) : 1;
  }

  function openDefinition(): void {
    const line = note?.note.line;
    note = undefined;
    if (line) onNavigate(line);
  }
</script>

<div class="preview-scroll" bind:this={viewport} onscroll={scrolled}>
  <div class="preview-document" style:height={total + 'px'}>
    <div class="preview-window" style:transform={'translateY(' + offset + 'px)'}>
      {#each visible as block (block.index + ':' + block.hash)}
        <div class="preview-block prose" data-prose={prose} data-kind={block.kind} data-index={block.index} data-hash={block.hash} use:watchBlock>
          {#if block.kind === 'diagram' && block.diagram}
            {#if Diagram}
              <Diagram diagram={block.diagram} startLine={block.startLine} client={diagrams} {theme} navigate={onNavigate} />
            {:else if diagramUnavailable}
              <details class="diagram-fallback">
                <summary>图表组件无法加载 · 查看原始代码</summary>
                <pre><code>{block.diagram.source}</code></pre>
              </details>
            {:else}
              <div class="diagram-loading" role="status">正在准备图表预览</div>
            {/if}
          {:else}
            {@html block.html ?? ''}
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>

{#if note}
  <div class="footnote-popover prose" data-prose={prose} style:left={note.left + 'px'} style:top={note.top + 'px'}
    onpointerenter={() => clearTimeout(noteTimer)} onpointerleave={dismissSoon} role="region" aria-label={'脚注 ' + note.note.label}>
    {@html note.note.html}
    {#if note.note.line}<button class="ui-button footnote-jump" onclick={openDefinition}>跳转至定义行</button>{/if}
  </div>
{/if}
