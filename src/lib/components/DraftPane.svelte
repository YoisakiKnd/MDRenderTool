<script lang="ts">
  import { Copy, Pencil, Plus, Trash2 } from 'lucide-svelte';
  import type { DraftSummary } from '../storage/idb';
  import Button from './ui/Button.svelte';

  let { drafts, activeDraft, unsaved, create, select, rename, duplicate, remove }: {
    drafts: DraftSummary[]; activeDraft?: string; unsaved: boolean;
    create: () => void; select: (id: string) => void; rename: (id: string, name: string) => void;
    duplicate: (id: string) => void; remove: (id: string) => void;
  } = $props();
  let editing = $state<string>();
  let name = $state('');

  function startRename(draft: DraftSummary): void {
    editing = draft.id;
    name = draft.title;
  }

  function edit(element: HTMLInputElement) {
    element.focus();
    element.select();
  }

  function commitName(event: SubmitEvent, draft: DraftSummary): void {
    event.preventDefault();
    if (name.trim()) rename(draft.id, name.trim());
    editing = undefined;
  }
</script>

<Button class="create-draft" onclick={create}><Plus size={15} /> 新建文档</Button>
    <ul class="draft-list" aria-label="本地草稿">
      {#each drafts as draft (draft.id)}
        <li class:current={draft.id === activeDraft}>
          {#if editing === draft.id}
            <form onsubmit={(event) => commitName(event, draft)}>
              <input aria-label="草稿名称" bind:value={name} maxlength="125" use:edit
                onkeydown={(event) => { if (event.key === 'Escape') editing = undefined; }} />
            </form>
          {:else}
            <button class="draft-select" title={draft.title} aria-current={draft.id === activeDraft ? 'page' : undefined}
              onclick={() => select(draft.id)}>
              {#if draft.id === activeDraft && unsaved}<span class="unsaved-dot" aria-label="未自动保存"></span>{/if}
              <span>{draft.title}</span>
            </button>
            <div class="draft-actions">
              <Button class="icon-button" aria-label={'重命名 ' + draft.title} title="重命名" onclick={() => startRename(draft)}><Pencil size={12} /></Button>
              <Button class="icon-button" aria-label={'复制 ' + draft.title} title="复制" onclick={() => duplicate(draft.id)}><Copy size={12} /></Button>
              <Button class="icon-button" aria-label={'删除 ' + draft.title} title="删除" onclick={() => remove(draft.id)}><Trash2 size={12} /></Button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
