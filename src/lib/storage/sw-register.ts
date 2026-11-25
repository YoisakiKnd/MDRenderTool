export interface ServiceWorkerCallbacks {
  onReady: () => void;
  onUpdate: (applyUpdate: () => void) => void;
  onError: (error: unknown) => void;
}

export function registerServiceWorker({ onReady, onUpdate, onError }: ServiceWorkerCallbacks): () => void {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return () => undefined;

  const serviceWorker = navigator.serviceWorker;
  const watched = new Set<ServiceWorker>();
  let active = true;
  let registration: ServiceWorkerRegistration | undefined;
  let announced: ServiceWorker | null = null;
  let reloadOnChange = false;

  function reportWaiting(): void {
    const waiting = registration?.waiting;
    if (!active || !waiting || !serviceWorker.controller || waiting === announced) return;
    announced = waiting;

    onUpdate(() => {
      if (!active || reloadOnChange) return;
      if (serviceWorker.controller === waiting) {
        window.location.reload();
      } else if (registration?.waiting === waiting) {
        waiting.postMessage({ type: 'SKIP_WAITING' });
        reloadOnChange = true;
      }
    });
  }

  function onStateChange(event: Event): void {
    const worker = event.currentTarget as ServiceWorker;
    reportWaiting();
    if (worker.state === 'activated' || worker.state === 'redundant') {
      if (worker.state === 'redundant' && !serviceWorker.controller) {
        onError(new Error('Service worker could not install the App Shell'));
      }
      worker.removeEventListener('statechange', onStateChange);
      watched.delete(worker);
    }
  }

  function watchInstalling(): void {
    const installing = registration?.installing;
    if (!installing || watched.has(installing)) return;
    watched.add(installing);
    installing.addEventListener('statechange', onStateChange);
  }

  function onControllerChange(): void {
    if (!serviceWorker.controller) return;
    if (reloadOnChange) window.location.reload();
    else onReady();
  }

  serviceWorker.addEventListener('controllerchange', onControllerChange);
  void serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
    .then((registered) => {
      if (!active) return;
      registration = registered;
      registration.addEventListener('updatefound', watchInstalling);
      watchInstalling();
      reportWaiting();
      if (serviceWorker.controller) onReady();
    })
    .catch((error: unknown) => {
      if (active) onError(error);
    });

  return () => {
    active = false;
    registration?.removeEventListener('updatefound', watchInstalling);
    serviceWorker.removeEventListener('controllerchange', onControllerChange);
    for (const worker of watched) worker.removeEventListener('statechange', onStateChange);
    watched.clear();
  };
}
