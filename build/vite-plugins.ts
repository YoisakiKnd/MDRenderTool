import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

const diagramTypes = /\/src\/lib\/diagrams\/engines\/(sequence|flowchart|class|state|er|mindmap|gantt|pie)\//;

export function manualChunks(id: string): string | undefined {
  const path = id.replaceAll('\\', '/').split('?')[0];
  if (path.includes('/node_modules/')) {
    if (path.includes('/node_modules/svelte/')) return 'vendor-svelte';
    if (path.includes('/node_modules/@codemirror/lang-markdown/')) return 'editor-markdown';
    if (path.includes('/node_modules/@codemirror/search/')) return 'editor-search';
    if (path.includes('/node_modules/@codemirror/')) return 'vendor-codemirror';
    if (path.includes('/node_modules/katex/')) return 'vendor-katex';
    if (path.includes('/node_modules/docx/')) return 'vendor-docx';
  }

  const diagramType = diagramTypes.exec(path)?.[1];
  if (diagramType) return `diagram-${diagramType}`;
  if (path.endsWith('/src/lib/diagrams/layouts/sugiyama.ts')) return 'diagram-layout-dag';
  if (path.endsWith('/src/lib/diagrams/layouts/tree.ts')) return 'diagram-layout-tree';
}

export function katexWoff2Only(): Plugin {
  return {
    name: 'mdrt:katex-woff2-only',
    enforce: 'pre',
    transform(css, id) {
      if (!/\/node_modules\/katex\/dist\/katex(?:\.min)?\.css$/.test(id.split('?')[0])) return;
      // Filter each font's fallback list before Vite resolves and emits its URLs.
      return css.replace(/(@font-face\s*\{[^}]*?\bsrc\s*:\s*)([^;}]+)(?=[;}])/g,
        (declaration: string, prefix: string, sources: string) => {
          const woff2 = sources.split(',').find((source) => /\.woff2["']?\s*\)/.test(source));
          if (!woff2) this.error(`No self-hosted woff2 source in ${declaration}`);
          return prefix + woff2.trim();
        });
    },
  };
}

export function collectWorkerShell(files: Set<string>): Plugin {
  return {
    name: 'mdrt:worker-shell',
    generateBundle(_options, bundle) {
      const visit = (file: string): void => {
        if (files.has(file)) return;
        files.add(file);
        const chunk = bundle[file];
        if (chunk?.type === 'chunk') chunk.imports.forEach(visit);
      };
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && chunk.facadeModuleId?.endsWith('/render.worker.ts')) visit(chunk.fileName);
      }
    },
  };
}

export function appShellManifest(workerFiles = new Set<string>()): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'mdrt:app-shell-manifest',
    apply: 'build',
    enforce: 'post',
    configResolved(resolved) {
      config = resolved;
    },
    generateBundle: {
      order: 'post',
      async handler(_options, bundle) {
        const worker = await readFile(resolve(config.root, 'public/sw.js'), 'utf8');
        const html = bundle['index.html'];
        if (html?.type !== 'asset' || typeof html.source !== 'string') {
          this.error('Missing index.html in the App Shell build');
        }

        const assets = Object.keys(bundle).filter((file) => file.startsWith('assets/')).sort();
        const shell = new Set(['index.html']);
        const visit = (file: string): void => {
          if (shell.has(file)) return;
          const output = bundle[file];
          if (!output) return;
          shell.add(file);
          if (output.type !== 'chunk') return;
          output.imports.forEach(visit);
          output.viteMetadata?.importedCss.forEach(visit);
          output.viteMetadata?.importedAssets.forEach(visit);
        };

        // Vite emits the actual entry, preload, CSS and favicon URLs into HTML.
        const base = config.base;
        for (const [, url] of html.source.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
          if (url.startsWith(base)) visit(url.slice(base.length));
        }

        workerFiles.forEach(visit);

        const version = createHash('sha256').update(worker).update(html.source)
          .update(JSON.stringify(assets)).digest('hex').slice(0, 20);
        const manifest = JSON.stringify({ version, shell: [...shell].sort(), assets }, null, 2);
        html.source = html.source.replace('<head>', `<head>\n    <meta name="mdrt-build" content="${version}" />`);
        this.emitFile({ type: 'asset', fileName: 'asset-manifest.json', source: manifest + '\n' });
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: worker.replace('/* __MDRT_MANIFEST__ */ null', manifest),
        });
      },
    },
  };
}
