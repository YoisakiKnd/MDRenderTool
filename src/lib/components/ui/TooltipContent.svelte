<script lang="ts">
  import { Tooltip } from 'bits-ui';
  import type { ComponentProps } from 'svelte';

  let { class: className, sideOffset = 8, ...props }: ComponentProps<typeof Tooltip.Content> = $props();
</script>

<Tooltip.Portal>
  <Tooltip.Content role="tooltip" {...props} {sideOffset} class={['ui-tooltip', className]} />
</Tooltip.Portal>
