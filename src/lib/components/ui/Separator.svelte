<script lang="ts">
  import { Separator } from 'bits-ui';
  import type { ComponentProps } from 'svelte';

  let { class: className, ...props }: ComponentProps<typeof Separator.Root> = $props();
</script>

<Separator.Root {...props} class={['ui-separator', className]} />
