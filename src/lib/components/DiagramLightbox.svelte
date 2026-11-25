<script lang="ts">
  import { onMount } from 'svelte';
  import { Maximize, Minus, Plus, X } from 'lucide-svelte';
  import Button from './ui/Button.svelte';

  let { svg, width, height, onClose }: { svg: string; width: number; height: number; onClose: () => void } = $props();
  let dialog: HTMLDialogElement;
  let stage: HTMLDivElement;
  let zoom = $state(1);
  let pan = $state({ x: 0, y: 0 });
  let dragging: { x: number; y: number; px: number; py: number } | undefined;

  function fit(): void {
    zoom = Math.min(4, Math.max(.25, Math.min((stage.clientWidth - 45) / width, (stage.clientHeight - 45) / height)));
    pan = { x: 0, y: 0 };
  }

  function resize(delta: number): void { zoom = Math.max(.25, Math.min(4, zoom * delta)); }

  function drag(event: PointerEvent): void {
    if (event.button !== 0) return;
    stage.setPointerCapture(event.pointerId);
    dragging = { x: event.clientX, y: event.clientY, px: pan.x, py: pan.y };
  }

  function move(event: PointerEvent): void {
    if (!dragging) return;
    pan = { x: dragging.px + event.clientX - dragging.x, y: dragging.py + event.clientY - dragging.y };
  }

  onMount(() => {
    const wheel = (event: WheelEvent) => { event.preventDefault(); resize(Math.exp(-event.deltaY / 500)); };
    dialog.showModal();
    fit();
    stage.addEventListener('wheel', wheel, { passive: false });
    return () => {
      stage.removeEventListener('wheel', wheel);
      dialog.close();
    };
  });
</script>

<dialog class="diagram-lightbox" bind:this={dialog} aria-label="查看图表" oncancel={onClose}>
  <header>
    <Button aria-label="缩小" onclick={() => resize(.8)}><Minus size={17} /></Button>
    <span>{Math.round(zoom * 100)}%</span>
    <Button aria-label="放大" onclick={() => resize(1.25)}><Plus size={17} /></Button>
    <Button aria-label="适应屏幕" onclick={fit}><Maximize size={17} /></Button>
    <Button aria-label="关闭图表" onclick={onClose}><X size={17} /></Button>
  </header>
  <div class="diagram-stage" role="group" aria-label="图表画布" bind:this={stage}
    onpointerdown={drag} onpointermove={move} onlostpointercapture={() => { dragging = undefined; }}>
    <div class="diagram-zoom" style:width={width + 'px'} style:height={height + 'px'}
      style:transform={`translate(${pan.x}px, ${pan.y}px) scale(${zoom})`}>
      {@html svg}
    </div>
  </div>
</dialog>
