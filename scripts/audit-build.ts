import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const dist = process.argv[2] ?? 'dist';
const manifest = JSON.parse(await readFile(join(dist, 'asset-manifest.json'), 'utf8')) as {
  version: string; shell: string[]; assets: string[];
};

const files = (await readdir(join(dist, 'assets'))).map((file) => 'assets/' + file).sort();
assert.deepEqual(files, manifest.assets);
assert.ok(manifest.shell.includes('index.html'));
assert.ok(manifest.shell.every((file) => file === 'index.html' || files.includes(file)));
assert.ok(files.every((file) => /-[\w-]{8}\.[a-z\d]+$/i.test(file)), 'Expected content hashes on assets');
assert.ok(!files.some((file) => /\.(?:ttf|woff|otf|eot)$/i.test(file)), 'Only WOFF2 fonts are emitted');

for (const name of ['sequence', 'flowchart', 'class', 'state', 'er', 'mindmap', 'gantt', 'pie']) {
  const chunks = files.filter((file) => new RegExp(`^assets/diagram-${name}-[\\w-]+\\.js$`).test(file));
  assert.equal(chunks.length, 1, `Expected one chunk for ${name}`);
}
const lazy = /\/(?:diagram-|vendor-(?:katex|docx)|export-|editor-(?:markdown|search|syntax)|KaTeX_)/;
assert.ok(!manifest.shell.some((file) => lazy.test(file)), 'App Shell unexpectedly precaches a lazy chunk');
for (const format of ['html', 'pdf', 'png', 'docx']) {
  assert.ok(files.some((file) => file.startsWith(`assets/export-${format}-`)));
}

let rawBytes = 0;
let gzipBytes = 0;
let coreJs = 0;
let workerJs = 0;
const chunks: Array<{ file: string; raw: number; gzip: number }> = [];
for (const file of [...files, 'index.html', 'sw.js', 'asset-manifest.json']) {
  const bytes = await readFile(join(dist, file));
  const gzip = gzipSync(bytes).length;
  rawBytes += bytes.length;
  gzipBytes += gzip;
  if (file.endsWith('.js') && manifest.shell.includes(file)) {
    coreJs += gzip;
    if (file.includes('render.worker')) workerJs += gzip;
  }
  if (!/\.(?:js|html|svg|css|json)$/.test(file)) continue;
  const text = bytes.toString('utf8');
  assert.ok(!/(?:\b(?:src|href)\s*=\s*["'](?:https?:)?\/\/|\burl\(\s*["']?(?:https?:)?\/\/|@import\s+["'](?:https?:)?\/\/|\b(?:fetch|import)\(\s*["']https?:\/\/)/i.test(text),
    `External resource reference in ${file}`);
  if (/\.(?:js|css)$/.test(file)) chunks.push({ file, raw: bytes.length, gzip });
}

console.table(chunks);
console.log(JSON.stringify({
  version: manifest.version, hashedAssets: files.length, shellFiles: manifest.shell.length,
  coreJsGzip: coreJs, browserJsGzip: coreJs - workerJs, workerJsGzip: workerJs, rawBytes, gzipBytes,
}, null, 2));
assert.ok(coreJs <= 180_000, `Core JavaScript exceeds the 180 KB gzip budget: ${coreJs}`);
