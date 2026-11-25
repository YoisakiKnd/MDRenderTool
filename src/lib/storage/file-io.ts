const types = [{ description: 'Markdown 或纯文本', accept: { 'text/plain': ['.md', '.markdown', '.txt'] } }];
export const markdownFilename = /\.(?:md|markdown|txt)$/i;

type Picker = Window & {
  showOpenFilePicker?: (options: { types: typeof types; multiple: boolean }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options: { types: typeof types; suggestedName: string }) => Promise<FileSystemFileHandle>;
};

export function safeFilename(value: string, extension: string): string {
  const name = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().replace(/\.+$/, '').slice(0, 125) || 'MDRenderTool';
  return name.toLowerCase().endsWith(extension.toLowerCase()) ? name : name + extension;
}

export function isCancellation(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export async function chooseMarkdownFile(): Promise<{ file: File; handle?: FileSystemFileHandle } | undefined> {
  const picker = window as Picker;
  if (picker.showOpenFilePicker) {
    try {
      const [handle] = await picker.showOpenFilePicker({ types, multiple: false });
      return handle ? { file: await handle.getFile(), handle } : undefined;
    } catch (error) {
      if (isCancellation(error)) return undefined;
      if (!(error instanceof DOMException) || !['SecurityError', 'NotAllowedError', 'NotSupportedError'].includes(error.name)) throw error;
    }
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt,text/markdown,text/plain';
    input.onchange = () => resolve(input.files?.[0] ? { file: input.files[0] } : undefined);
    input.oncancel = () => resolve(undefined);
    input.click();
  });
}

export async function saveMarkdownFile(
  title: string,
  content: string,
  existing?: FileSystemFileHandle,
): Promise<{ saved: boolean; handle?: FileSystemFileHandle }> {
  const suggestedName = safeFilename(title, title.match(markdownFilename)?.[0] ?? '.md');
  const picker = window as Picker;
  let handle = existing;
  try {
    if (!handle && picker.showSaveFilePicker) handle = await picker.showSaveFilePicker({ types, suggestedName });
    if (handle) {
      const writable = await handle.createWritable();
      try {
        await writable.write(content);
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => undefined);
        throw error;
      }
      return { saved: true, handle };
    }
  } catch (error) {
    if (isCancellation(error)) return { saved: false };
    if (!(error instanceof DOMException) || !['SecurityError', 'NotAllowedError', 'NotSupportedError'].includes(error.name)) throw error;
  }

  downloadBlob(new Blob([content], { type: 'text/markdown;charset=utf-8' }), suggestedName);
  return { saved: true };
}

const downloads = new Set<string>();

export function downloadBlob(blob: Blob, filename: string): void {
  if (downloads.size >= 16) {
    const oldest = downloads.values().next().value;
    if (oldest) {
      URL.revokeObjectURL(oldest);
      downloads.delete(oldest);
    }
  }
  const url = URL.createObjectURL(blob);
  downloads.add(url);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => {
    if (downloads.delete(url)) URL.revokeObjectURL(url);
  }, 1_000);
}
