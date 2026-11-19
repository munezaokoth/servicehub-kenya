/* ServiceHub Kenya - app shell
   Inside the Android app: the phone's Back button works like a normal app - it closes dialogs,
   then the open chat, then goes Home, then minimises (never ends a call, and calls keep ringing).
   On Android phones in the browser: a one-time banner offering the app. */
(function () {
  "use strict";
  const C = window.Capacitor;
  const native = !!(C && C.isNativePlatform && C.isNativePlatform());

  if (native) {
    document.documentElement.classList.add("in-app");
    const App = C.Plugins && C.Plugins.App;
    if (App && App.addListener) {
      App.addListener("backButton", () => {
        // 1. Never leave an active call by accident
        const call = document.getElementById("shc-call");
        if (call && call.classList.contains("open")) return;
        // 2. Close an open dialog
        const modals = Array.from(document.querySelectorAll(".modal.active"));
        if (modals.length) { modals[modals.length - 1].classList.remove("active"); return; }
        // 3. Phone chat view -> back to the conversation list
        const chat = document.querySelector("#chat .chat-container.shc-open");
        if (chat && typeof window.closeChatView === "function") { window.closeChatView(); return; }
        // 4. Mobile menu open -> close it
        const nav = document.querySelector(".nav-menu.active, .mobile-menu.active, nav .active-menu");
        if (nav) { nav.classList.remove("active", "active-menu"); return; }
        // 5. Any page other than Home -> Home
        const home = document.getElementById("home");
        if (home && !home.classList.contains("active") && typeof window.showSection === "function") { window.showSection("home"); window.scrollTo(0, 0); return; }
        // 6. Home -> put the app in the background (stays signed in and keeps receiving calls)
        if (App.minimizeApp) App.minimizeApp(); else if (App.exitApp) App.exitApp();
      });
    }
    // Status bar matches the brand
    try { const SB = C.Plugins.StatusBar; if (SB) { SB.setBackgroundColor({ color: "#0b2a5b" }); SB.setStyle({ style: "DARK" }); } } catch (e) {}
    return;
  }

  // Android browser visitors: offer the app once every 14 days
  const isAndroid = /Android/i.test(navigator.userAgent);
  if (!isAndroid || document.documentElement.classList.contains("in-app")) return;
  let last = 0; try { last = Number(localStorage.getItem("sh_app_banner") || 0); } catch (e) {}
  if (Date.now() - last < 14 * 24 * 3600 * 1000) return;

  function show() {
    if (document.getElementById("sh-app-banner")) return;
    const b = document.createElement("div");
    b.id = "sh-app-banner";
    b.setAttribute("role", "dialog");
    b.style.cssText = "position:fixed;left:10px;right:10px;bottom:max(10px,env(safe-area-inset-bottom));z-index:2147481000;background:#0b2a5b;color:#fff;border-radius:16px;padding:12px 12px 12px 14px;display:flex;align-items:center;gap:12px;box-shadow:0 12px 32px rgba(0,0,0,.35);font-size:.9rem;max-width:560px;margin:0 auto";
    b.innerHTML = '<img src="/icons/icon-96.png" alt="" width="44" height="44" style="border-radius:10px;background:#fff;flex-shrink:0">' +
      '<div style="flex:1;min-width:0"><b style="display:block">ServiceHub Kenya app</b><span style="opacity:.85">Faster, and your phone rings for calls.</span></div>' +
      '<a href="/download/android" id="sh-app-get" style="background:#22c55e;color:#fff;border-radius:999px;padding:9px 14px;font-weight:700;text-decoration:none;white-space:nowrap">Get app</a>' +
      '<button type="button" id="sh-app-x" aria-label="Close" style="background:none;border:0;color:#fff;font-size:1.3rem;opacity:.7;padding:4px 6px;cursor:pointer">×</button>';
    document.body.appendChild(b);
    const done = () => { try { localStorage.setItem("sh_app_banner", String(Date.now())); } catch (e) {} b.remove(); };
    document.getElementById("sh-app-x").onclick = done;
    document.getElementById("sh-app-get").addEventListener("click", () => setTimeout(done, 300));
  }
  window.addEventListener("load", () => setTimeout(show, 4000));
})();
