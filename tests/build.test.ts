import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { appShellManifest, katexWoff2Only, manualChunks } from '../build/vite-plugins';

describe('immutable build', () => {
  it.each<[string, string | undefined]>([
    ['node_modules/svelte/src/index.js', 'vendor-svelte'],
    ['node_modules/@codemirror/view/dist/index.js', 'vendor-codemirror'],
    ['node_modules/.pnpm/katex@1/node_modules/katex/dist/katex.mjs', 'vendor-katex'],
    ['node_modules/docx/dist/index.mjs', 'vendor-docx'],
    ...['sequence', 'flowchart', 'class', 'state', 'er', 'mindmap', 'gantt', 'pie'].map((type) =>
      [`src/lib/diagrams/engines/${type}/index.ts`, `diagram-${type}`] as [string, string]),
    ['src/lib/diagrams/layouts/sugiyama.ts', 'diagram-layout-dag'],
    ['src/lib/diagrams/layouts/tree.ts', 'diagram-layout-tree'],
    ['src/lib/diagrams/registry.ts', undefined],
  ])('assigns %s to %s', (path, expected) => {
    expect(manualChunks(`/project/${path}?raw`)).toBe(expected);
  });

  it('precaches the static graph and keeps lazy modules and their woff2 off the shell', async () => {
    const worker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
    const root = await realpath(await mkdtemp(join(tmpdir(), 'mdrt-build-')));
    const write = async (path: string, contents: string) => {
      const file = join(root, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, contents);
    };

    try {
      await Promise.all([
        write('index.html', '<html><head></head><body><script type="module" src="/app.ts"></script></body></html>'),
        write('public/sw.js', worker),
        write('app.ts', "import './core.css'; document.body.onclick = () => void import('./lazy');"),
        write('core.css', 'body { color: black }'),
        write('lazy.ts', "import './node_modules/katex/dist/katex.min.css'; document.body.textContent = 'loaded';"),
        write('node_modules/katex/dist/katex.min.css',
          '@font-face{font-family:KaTeX;src:url(./fonts/math.woff2) format("woff2"),url(./fonts/math.woff) format("woff"),url(./fonts/math.ttf) format("truetype")}'),
        write('node_modules/katex/dist/fonts/math.woff2', 'woff2 fixture'),
      ]);

      await build({
        configFile: false,
        root,
        base: '/notes/',
        logLevel: 'silent',
        plugins: [katexWoff2Only(), appShellManifest()],
        build: { assetsInlineLimit: 0, copyPublicDir: false },
      });

      const dist = join(root, 'dist');
      const manifest = JSON.parse(await readFile(join(dist, 'asset-manifest.json'), 'utf8')) as {
        version: string;
        shell: string[];
        assets: string[];
      };
      expect(manifest.shell).toContain('index.html');
      expect(manifest.shell.some((file) => /index-.*\.css$/.test(file))).toBe(true);
      expect(manifest.shell.some((file) => /index-.*\.js$/.test(file))).toBe(true);
      expect(manifest.shell.some((file) => /lazy|woff/.test(file))).toBe(false);
      expect(manifest.assets.some((file) => /lazy-.*\.js$/.test(file))).toBe(true);
      expect(manifest.assets.filter((file) => /\.(?:woff2?|ttf)$/.test(file))).toEqual([
        expect.stringMatching(/^assets\/math-.*\.woff2$/),
      ]);
      expect(manifest.assets).toEqual((await readdir(join(dist, 'assets'))).map((file) => `assets/${file}`).sort());
      expect(await readFile(join(dist, 'index.html'), 'utf8')).toContain(manifest.version);
      expect(await readFile(join(dist, 'sw.js'), 'utf8')).toContain(JSON.stringify(manifest, null, 2));
    } finally {
      await rm(root, { recursive: true });
    }
  });
});
