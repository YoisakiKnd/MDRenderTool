<script lang="ts">
  import { Tabs } from 'bits-ui';
  import type { ComponentProps } from 'svelte';

  let { class: className, ...props }: ComponentProps<typeof Tabs.List> = $props();
</script>

<Tabs.List {...props} class={['ui-tabs', className]} />
