<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';

  let { children, class: className, type = 'button', ...props }: HTMLButtonAttributes = $props();
</script>

<button {...props} {type} class={['ui-button', className]}>
  {@render children?.()}
</button>
