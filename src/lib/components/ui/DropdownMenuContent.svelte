<script lang="ts">
  import { DropdownMenu } from 'bits-ui';
  import type { ComponentProps } from 'svelte';

  let { class: className, sideOffset = 8, ...props }: ComponentProps<typeof DropdownMenu.Content> = $props();
</script>

<DropdownMenu.Portal>
  <DropdownMenu.Content {...props} {sideOffset} class={['ui-menu', className]} />
</DropdownMenu.Portal>
