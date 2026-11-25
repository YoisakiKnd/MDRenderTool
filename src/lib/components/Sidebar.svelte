<script lang="ts">
  import type { TocItem } from '../core/protocol';
  import type { DraftSummary } from '../storage/idb';
  import type DraftPane from './DraftPane.svelte';

  let { toc, activeLine, jump, drafts, activeDraft, unsaved, create, select, rename, duplicate, remove }: {
    toc: TocItem[]; activeLine: number; jump: (line: number) => void;
    drafts: DraftSummary[]; activeDraft?: string; unsaved: boolean;
    create: () => void; select: (id: string) => void; rename: (id: string, name: string) => void;
    duplicate: (id: string) => void; remove: (id: string) => void;
  } = $props();
  let tab = $state<'outline' | 'drafts'>('outline');
  let Drafts = $state<typeof DraftPane>();
  let loadFailed = $state(false);
  const id = $props.id();

  const active = $derived.by(() => {
    let start = 0;
    let end = toc.length;
    while (start < end) {
      const middle = (start + end) >>> 1;
      if (toc[middle].line <= activeLine) start = middle + 1;
      else end = middle;
    }
    return toc[start - 1]?.line;
  });

  $effect(() => {
    if (tab !== 'drafts' || Drafts) return;
    void import('./DraftPane.svelte').then((module) => { Drafts = module.default; }).catch(() => { loadFailed = true; });
  });

  function switchTab(next: 'outline' | 'drafts'): void { tab = next; }
  function tabKey(event: KeyboardEvent): void {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'outline' : event.key === 'End' || tab === 'outline' ? 'drafts' : 'outline';
    switchTab(next);
    document.getElementById(id + '-' + next)?.focus();
  }

</script>

<aside class="workspace-sidebar" aria-label="文档导航">
  <div class="ui-tabs workspace-tabs" role="tablist" aria-label="文档导航">
    <button class="ui-tab" role="tab" data-state={tab === 'outline' ? 'active' : 'inactive'} id={id + '-outline'}
      aria-controls={id + '-outline-panel'} tabindex={tab === 'outline' ? 0 : -1} aria-selected={tab === 'outline'}
      onkeydown={tabKey} onclick={() => switchTab('outline')}>大纲</button>
    <button class="ui-tab" role="tab" data-state={tab === 'drafts' ? 'active' : 'inactive'} id={id + '-drafts'}
      aria-controls={id + '-drafts-panel'} tabindex={tab === 'drafts' ? 0 : -1} aria-selected={tab === 'drafts'}
      onkeydown={tabKey} onclick={() => switchTab('drafts')}>草稿</button>
  </div>
  <div role="tabpanel" aria-labelledby={id + '-outline'} id={id + '-outline-panel'} hidden={tab !== 'outline'}>
    {#if !toc.length}
      <p class="sidebar-empty">添加标题后，大纲会显示在这里。</p>
    {:else}
      <nav aria-label="文档标题">
        {#each toc as item (item.slug)}
          <button class="outline-item" style:padding-inline-start={Math.min(5, item.level - 1) * 10 + 9 + 'px'}
            aria-current={active === item.line ? 'location' : undefined} onclick={() => jump(item.line)}>
            {item.text}
          </button>
        {/each}
      </nav>
    {/if}
  </div>
  <div role="tabpanel" aria-labelledby={id + '-drafts'} id={id + '-drafts-panel'} hidden={tab !== 'drafts'}>
    {#if Drafts}
      <Drafts {drafts} {activeDraft} {unsaved} {create} {select} {rename} {duplicate} {remove} />
    {:else if loadFailed}
      <p class="sidebar-empty">草稿面板无法加载。</p>
    {/if}
  </div>
</aside>
