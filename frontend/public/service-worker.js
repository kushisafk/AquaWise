const SHELL_CACHE = "aquawise-shell-v1";
const API_CACHE = "aquawise-api-v1";
const SHELL_URLS = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icons/aquawise-192.png",
  "/icons/aquawise-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => ![SHELL_CACHE, API_CACHE].includes(key))
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

async function reportResponse(type) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ type });
  }
}

async function networkFirst(request, cacheName, fallbackUrl, reportFresh = false) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      if (reportFresh) await reportResponse("aquawise-fresh-response");
      return response;
    }
    const cached = await cache.match(request) || (fallbackUrl && await cache.match(fallbackUrl));
    if (cached) {
      await reportResponse("aquawise-stale-response");
      const headers = new Headers(cached.headers);
      headers.set("X-AquaWise-Stale", "true");
      return new Response(await cached.arrayBuffer(), {
        status: cached.status,
        statusText: cached.statusText,
        headers
      });
    }
    return response;
  } catch {
    const cached = await cache.match(request) || (fallbackUrl && await cache.match(fallbackUrl));
    if (!cached) throw new Error("AquaWise is offline and no saved copy is available.");
    await reportResponse("aquawise-stale-response");
    const headers = new Headers(cached.headers);
    headers.set("X-AquaWise-Stale", "true");
    return new Response(await cached.arrayBuffer(), {
      status: cached.status,
      statusText: cached.statusText,
      headers
    });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/events")) return;

  // Never intercept or cache localhost dev assets, Vite internals, or source files
  if (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.pathname.startsWith("/@") ||
    url.pathname.includes("/node_modules/") ||
    url.pathname.endsWith(".tsx") ||
    url.pathname.endsWith(".ts")
  ) {
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, API_CACHE, undefined, true));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE, "/"));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});

// ============================================================
// WEB PUSH NOTIFICATIONS
// ============================================================

self.addEventListener("push", (event) => {
  let data = {
    title: "AquaWise Alert",
    body: "New field update available.",
    url: "/",
  };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }

  const notificationId = data.id || data.notificationId;
  const targetUrl = data.url || (notificationId ? `/?notificationId=${notificationId}` : "/");

  const options = {
    body: data.body || data.detail || "Field telemetry or recommendation updated.",
    icon: "/icons/aquawise-192.png",
    badge: "/favicon.svg",
    tag: data.tag || (notificationId ? `aquawise-notif-${notificationId}` : "aquawise-alert"),
    data: {
      url: targetUrl,
      notificationId: notificationId,
      title: data.title,
      detail: data.detail || data.body,
      at: data.at,
    },
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(data.title || "AquaWise Alert", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const notifData = event.notification.data || {};
  const targetUrl = notifData.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // If a window is already open, focus it and navigate / post message
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.postMessage({
            type: "aquawise-notification-click",
            notificationId: notifData.notificationId,
            url: targetUrl,
          });
          if ("navigate" in client) {
            client.navigate(targetUrl);
          }
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
