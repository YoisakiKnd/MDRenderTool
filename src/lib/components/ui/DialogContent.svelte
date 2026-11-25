<script lang="ts">
  import { Dialog } from 'bits-ui';
  import type { ComponentProps } from 'svelte';

  let { class: className, ...props }: ComponentProps<typeof Dialog.Content> = $props();
</script>

<Dialog.Portal>
  <Dialog.Overlay class="ui-dialog-overlay" />
  <Dialog.Content {...props} class={['ui-dialog', className]} />
</Dialog.Portal>
