/* The manifest is embedded by Vite so each worker keeps its own build's inventory. */
const manifest = /* __MDRT_MANIFEST__ */ null;
const scope = self.registration.scope;
const immutableCacheName = 'mdrt-immutable-v1';
const shellPrefix = 'mdrt-shell-';
const shellCacheName = shellPrefix + manifest.version;
const indexUrl = new URL('index.html', scope).href;
const assetUrls = new Set(manifest.assets.map((path) => new URL(path, scope).href));

async function fetchLocal(url, cache) {
  const response = await fetch(url, { cache, redirect: 'error' });
  if (!response.ok) throw new Error(`Unable to cache ${url}: ${response.status}`);
  return response;
}

async function cacheAsset(url) {
  const cache = await caches.open(immutableCacheName);
  const cached = await cache.match(url);
  if (cached) return cached;

  const response = await fetchLocal(url, 'default');
  await cache.put(url, response.clone()).catch((error) => {
    console.warn('MDRenderTool could not store the static asset', error);
  });
  return response;
}

async function installShell() {
  const shell = await caches.open(shellCacheName);
  const index = await fetchLocal(indexUrl, 'no-cache');
  const content = await index.clone().text();
  if (!content.includes(`name="mdrt-build" content="${manifest.version}"`)) {
    throw new Error('App Shell changed during installation');
  }

  const immutable = await caches.open(immutableCacheName);
  const coreAssets = manifest.shell.filter((path) => path !== 'index.html');
  await Promise.all(coreAssets.map(async (path) => {
    const url = new URL(path, scope).href;
    if (!await immutable.match(url)) {
      await immutable.put(url, await fetchLocal(url, 'default'));
    }
  }));
  // Commit the offline entry after every core dependency is stored.
  await shell.put(indexUrl, index);
}

async function cleanOldBuilds() {
  const names = await caches.keys();
  const immutable = await caches.open(immutableCacheName);
  const keys = await immutable.keys();
  await Promise.all([
    ...names.filter((name) => name.startsWith(shellPrefix) && name !== shellCacheName)
      .map((name) => caches.delete(name)),
    ...keys.filter((key) => !assetUrls.has(key.url)).map((key) => immutable.delete(key)),
  ]);
}

async function navigate(request) {
  try {
    return await fetchLocal(request, 'no-cache');
  } catch {
    const shell = await caches.open(shellCacheName);
    return await shell.match(indexUrl) ?? Response.error();
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(installShell());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(cleanOldBuilds().then(async () => {
    await self.clients.claim();
    // Core navigation remains available offline even before either panel has been opened.
    const panels = manifest.assets.filter((path) => /^assets\/(?:DraftPane|PreferencesDialog)-/.test(path));
    await Promise.allSettled(panels.map((path) => cacheAsset(new URL(path, scope).href)));
  }));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const resource = url.origin + url.pathname;
  if (request.mode === 'navigate' && (resource === scope || resource === indexUrl)) {
    event.respondWith(navigate(request));
  } else if (assetUrls.has(resource) && !request.headers.has('Range')) {
    event.respondWith(cacheAsset(resource));
  }
});
