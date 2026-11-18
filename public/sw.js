/* ServiceHub Kenya - service worker
   Rings the phone for incoming calls (and shows missed calls) when ServiceHub is in the
   background, the screen is off, or the browser tab is closed. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

const RING = [900, 400, 900, 400, 900, 400, 900, 400, 900, 400, 900, 400, 900];

async function visibleClient() {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return list.find((c) => c.visibilityState === "visible") || null;
}

async function closeTag(tag) {
  const ns = await self.registration.getNotifications({ tag });
  ns.forEach((n) => n.close());
}

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }

  event.waitUntil((async () => {
    if (d.type === "call") {
      if (d.expiresAt && Date.now() > d.expiresAt) return; // delivered too late, the call is over
      const open = await visibleClient();
      if (open) { open.postMessage({ type: "call_push", data: d }); return; } // the page rings itself
      const video = d.callType === "video";
      return self.registration.showNotification(video ? "Incoming video call" : "Incoming voice call", {
        body: `${d.callerName || "Someone"} is calling you on ServiceHub`,
        tag: "call-" + d.callId,
        renotify: true,
        requireInteraction: true,
        silent: false,
        vibrate: RING,
        icon: "/icons/icon-192.png",
        badge: "/icons/badge-72.png",
        timestamp: Date.now(),
        actions: [
          { action: "decline", title: "Decline" },
          { action: "accept", title: "Answer" },
        ],
        data: d,
      });
    }

    if (d.type === "call_missed") {
      await closeTag("call-" + d.callId);
      return self.registration.showNotification(d.callType === "video" ? "Missed video call" : "Missed voice call", {
        body: `${d.callerName || "Someone"} called you on ServiceHub`,
        tag: "missed-" + d.callId,
        icon: "/icons/icon-192.png",
        badge: "/icons/badge-72.png",
        timestamp: Date.now(),
        data: d,
      });
    }

    return self.registration.showNotification(d.title || "ServiceHub Kenya", {
      body: d.body || "", icon: "/icons/icon-192.png", badge: "/icons/badge-72.png", data: d,
    });
  })());
});

async function focusOrOpen(url, message) {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const client = list.find((c) => new URL(c.url).origin === self.location.origin);
  if (client) {
    client.postMessage(message);
    try { await client.focus(); } catch (e) {}
    return;
  }
  await self.clients.openWindow(url);
}

self.addEventListener("notificationclick", (event) => {
  const d = event.notification.data || {};
  event.notification.close();

  if (d.type === "call") {
    if (event.action === "decline") {
      event.waitUntil(fetch("/api/calls/decline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId: d.callId, token: d.declineToken }),
      }).catch(() => {}));
      return;
    }
    const action = event.action === "accept" ? "accept" : "open";
    event.waitUntil(focusOrOpen(`/?call=${encodeURIComponent(d.callId)}&action=${action}`, { type: "call_action", action, callId: d.callId }));
    return;
  }

  if (d.type === "call_missed") {
    event.waitUntil(focusOrOpen(`/?chat=${encodeURIComponent(d.conversationId)}`, { type: "open_chat", conversationId: d.conversationId, name: d.callerName }));
    return;
  }

  event.waitUntil(focusOrOpen("/", { type: "open" }));
});
