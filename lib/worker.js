const CACHE = 'v1';

const ASSETS = ['/application.js', '/worker.js', '/manifest.json'];

let websocket = null;
let connected = false;
let connecting = false;
let reconnectTimer = null;

const send = (packet) => {
  if (!connected) return false;
  websocket.send(JSON.stringify(packet));
  return true;
};

const broadcast = async (packet, exclude = null) => {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const client of clients) {
    if (client !== exclude) {
      client.postMessage(packet);
    }
  }
};

const updateCache = async () => {
  const cache = await caches.open(CACHE);
  for (const asset of ASSETS) {
    await cache.add(asset);
  }
};

self.addEventListener('install', (event) => {
  const install = async () => {
    await updateCache();
    await self.skipWaiting();
  };
  event.waitUntil(install());
});

const serveFromCache = async (request) => {
  const cache = await caches.open(CACHE);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) return cachedResponse;
  return null;
};

const fetchFromNetwork = async (request) => {
  const networkResponse = await fetch(request);
  if (networkResponse.status === 200) {
    const cache = await caches.open(CACHE);
    await cache.put(request, networkResponse.clone());
  }
  return networkResponse;
};

const offlineFallback = async (request) => {
  const cachedResponse = await serveFromCache(request);
  if (cachedResponse) return cachedResponse;
  if (request.mode === 'navigate') {
    const cache = await caches.open(CACHE);
    const fallbackResponse = await cache.match('/index.html');
    if (fallbackResponse) {
      return fallbackResponse;
    }
  }
  return new Response('Offline - Content not available', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain' },
  });
};

const cleanupCache = async () => {
  const cacheNames = await caches.keys();
  const deletePromises = cacheNames
    .filter((cacheName) => cacheName !== CACHE)
    .map(async (cacheName) => {
      await caches.delete(cacheName);
    });
  await Promise.all(deletePromises);
};

const updateCacheHandler = async (event) => {
  try {
    await updateCache();
    event.source.postMessage({ type: 'cacheUpdated' });
  } catch (error) {
    event.source.postMessage({
      type: 'cacheUpdateFailed',
      error: error.message,
    });
  }
};

self.addEventListener('fetch', async (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;
  const respond = async () => {
    try {
      const cachedResponse = await serveFromCache(request);
      if (cachedResponse) return cachedResponse;
      return await fetchFromNetwork(request);
    } catch {
      return await offlineFallback(request);
    }
  };
  event.respondWith(respond());
});

self.addEventListener('activate', (event) => {
  const activate = async () => {
    await Promise.all([cleanupCache(), self.clients.claim()]);
  };
  event.waitUntil(activate());
});

const connect = async () => {
  if (connected || connecting) return;
  connecting = true;

  const protocol = self.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${self.location.host}`;
  websocket = new WebSocket(url);

  websocket.onopen = () => {
    connected = true;
    connecting = false;
    broadcast({ type: 'status', connected: true });
  };

  websocket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    broadcast(message);
  };

  websocket.onclose = () => {
    connected = false;
    broadcast({ type: 'status', connected: false });
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  };

  websocket.onerror = (error) => {
    console.error('Service Worker: websocket error', error);
    broadcast({ type: 'error', error: error.message });
  };
};

const messageHandlers = {
  online: () => connect(),
  offline: () => {
    if (connected) websocket.close();
  },
  message: (event) => {
    const packet = { type: 'message', content: event.data.content };
    send(packet);
    broadcast(packet, event.source);
  },
  ping: (event) => {
    event.source.postMessage({ type: 'pong' });
  },
  updateCache: updateCacheHandler,
};

self.addEventListener('message', (event) => {
  const { type } = event.data;
  const handler = messageHandlers[type];
  if (handler) handler(event);
});

connect();
