/* ServiceHub Kenya - voice & video calls (v2)
   - Two-way audio for voice AND video calls (remote audio element), TURN relay support
   - ICE candidates queued until the call is set up (no lost candidates = no silent calls)
   - Ringback tone for the caller, ringtone + vibration + full-screen alert for the person called
   - Keeps the screen awake while ringing / in a call (Wake Lock)
   - Push alerts: the phone rings even when ServiceHub is in the background or closed
   - Busy / declined / no answer / missed handling, call history in the chat, reconnect on network drops
   - Video: camera on/off, front/back camera switch */
(function () {
  "use strict";

  const RING_TIMEOUT_MS = 45000;
  const S = {
    call: null,          // { id, conversationId, peerName, type, role, state, offer }
    pc: null, local: null, remote: null,
    pendingIce: [], localIceBuffer: [],
    incoming: null,      // { callId, conversationId, callerName, callType, offer, candidates }
    timer: null, seconds: 0, connectedOnce: false,
    muted: false, camOff: false, facing: "user",
    wakeLock: null, iceCache: null, iceCacheAt: 0,
    restartTries: 0, discTimer: null, autoAction: null,
    attachedSocket: null,
  };

  /* ───────────────────────── helpers ───────────────────────── */
  const $ = (id) => document.getElementById(id);
  const sock = () => (typeof socket !== "undefined" ? socket : null);
  const me = () => (typeof currentUser !== "undefined" ? currentUser : window.currentUser) || {};
  const api = () => (typeof API_BASE !== "undefined" ? API_BASE : window.API_BASE || "/api");
  const token = () => { try { return typeof getToken === "function" ? getToken() : localStorage.getItem("sh_token"); } catch (e) { return null; } };
  const notify = (m, t) => { try { showNotification(m, t || "info"); } catch (e) { console.log(m); } };
  const initials = (n) => String(n || "?").split(" ").filter(Boolean).map((x) => x[0]).join("").toUpperCase().slice(0, 2) || "?";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const inApp = () => !!(window.Capacitor || document.documentElement.classList.contains("in-app"));
  // Android app native helpers (ServiceHubNativePlugin.java)
  const NATIVE = () => { const C = window.Capacitor; return C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.ServiceHubNative ? C.Plugins.ServiceHubNative : null; };
  const nat = (fn, arg) => { const N = NATIVE(); if (N && typeof N[fn] === "function") { try { return Promise.resolve(N[fn](arg || {})).catch(() => null); } catch (e) {} } return Promise.resolve(null); };
  let nativeRinging = false;
  const fmt = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ":" + String(m).padStart(2, "0") : String(m).padStart(2, "0")) + ":" + String(s).padStart(2, "0"); };

  /* ───────────────────────── sounds (generated, no files) ───────────────────────── */
  let ctx = null, unlocked = false, toneTimer = null, toneNodes = [], vibTimer = null;
  function audioCtx() {
    if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) ctx = new AC(); }
    return ctx;
  }
  function unlockAudio() {
    const c = audioCtx();
    if (c && c.state === "suspended") c.resume().catch(() => {});
    if (c && !unlocked) {
      try { const b = c.createBuffer(1, 1, 22050); const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); } catch (e) {}
    }
    if (c && c.state === "running") unlocked = true;
    const ra = $("shc-remote-audio");
    if (ra && ra.srcObject && ra.paused) ra.play().then(hideTapForSound).catch(() => {});
    if (S.incoming && !S.call && !toneTimer && !nativeRinging && !document.hidden) startRingtone();
  }
  ["pointerdown", "touchstart", "keydown", "click"].forEach((ev) => document.addEventListener(ev, unlockAudio, { capture: true, passive: true }));

  function beep(freqs, start, dur, vol) {
    const c = audioCtx(); if (!c) return;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.02);
    g.gain.setValueAtTime(vol, start + Math.max(0.03, dur - 0.04));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    g.connect(c.destination);
    freqs.forEach((f) => { const o = c.createOscillator(); o.type = "sine"; o.frequency.value = f; o.connect(g); o.start(start); o.stop(start + dur + 0.05); toneNodes.push(o); });
    toneNodes.push(g);
  }
  function stopTones() {
    if (nativeRinging) { nativeRinging = false; nat("stopRingtone"); }
    clearInterval(toneTimer); toneTimer = null;
    toneNodes.forEach((n) => { try { n.stop ? n.stop() : n.disconnect(); } catch (e) {} });
    toneNodes = [];
    clearInterval(vibTimer); vibTimer = null;
    try { navigator.vibrate && navigator.vibrate(0); } catch (e) {}
  }
  function loopTone(period, schedule) {
    stopTones();
    const c = audioCtx(); if (!c) return;
    if (c.state === "suspended") c.resume().catch(() => {});
    const run = () => { if (c.state === "running") schedule(c.currentTime + 0.05); };
    run();
    toneTimer = setInterval(run, period * 1000);
  }
  // Caller hears this while the other phone rings (double-ring, as on Kenyan networks)
  function startRingback() {
    loopTone(3, (t) => { beep([400, 450], t, 0.4, 0.12); beep([400, 450], t + 0.6, 0.4, 0.12); });
  }
  // Person being called hears this
  function startRingtone() {
    if (NATIVE()) { stopTones(); nativeRinging = true; nat("startRingtone"); return; } // phone's own ringtone + vibration
    loopTone(3.2, (t) => {
      const notes = [1318.5, 1568, 1975.5, 1568, 1318.5, 1568, 1975.5, 2637];
      notes.forEach((f, i) => beep([f, f / 2], t + i * 0.15, 0.14, 0.35));
      notes.forEach((f, i) => beep([f, f / 2], t + 1.4 + i * 0.15, 0.14, 0.35));
    });
    if (navigator.vibrate) {
      const vib = () => { try { navigator.vibrate([900, 400, 900, 400, 900]); } catch (e) {} };
      vib(); vibTimer = setInterval(vib, 4000);
    }
  }
  function playBusy() { stopTones(); const c = audioCtx(); if (!c) return; const t = c.currentTime + 0.05; for (let i = 0; i < 4; i++) beep([425], t + i * 0.75, 0.375, 0.15); }
  function playEnd() { stopTones(); const c = audioCtx(); if (!c) return; const t = c.currentTime + 0.05; [0, 0.25, 0.5].forEach((d) => beep([480], t + d, 0.15, 0.12)); }

  /* ───────────────────────── screen awake + title flash ───────────────────────── */
  async function keepAwake() {
    nat("setKeepScreenOn", { on: true });
    try { if ("wakeLock" in navigator && !S.wakeLock && !document.hidden) { S.wakeLock = await navigator.wakeLock.request("screen"); S.wakeLock.addEventListener("release", () => { S.wakeLock = null; }); } } catch (e) {}
  }
  function releaseAwake() { nat("setKeepScreenOn", { on: false }); try { S.wakeLock && S.wakeLock.release(); } catch (e) {} S.wakeLock = null; }
  let titleTimer = null, oldTitle = document.title;
  function flashTitle(text) {
    stopFlash(); oldTitle = document.title; let on = false;
    titleTimer = setInterval(() => { document.title = (on = !on) ? text : oldTitle; }, 900);
  }
  function stopFlash() { if (titleTimer) { clearInterval(titleTimer); titleTimer = null; document.title = oldTitle; } }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (S.call || S.incoming) keepAwake();
    if (S.incoming && !S.call) { closeSystemRing(S.incoming.callId); startRingtone(); }
  });

  /* ───────────────────────── UI ───────────────────────── */
  function injectUI() {
    if ($("shc-call")) return;
    // remove the old call modals (v1)
    ["call-modal", "incoming-call-modal"].forEach((id) => { const el = $(id); if (el) el.remove(); });
    const css = document.createElement("style");
    css.textContent = `
#shc-call{position:fixed;inset:0;z-index:2147483000;display:none;flex-direction:column;align-items:center;justify-content:space-between;
  background:radial-gradient(120% 90% at 50% 0%,#1f6feb 0%,#0b2a5b 45%,#050d1f 100%);color:#fff;font-family:inherit;
  padding:max(24px,env(safe-area-inset-top)) 16px max(20px,env(safe-area-inset-bottom));overflow:hidden;touch-action:manipulation;-webkit-user-select:none;user-select:none}
#shc-call.open{display:flex}
#shc-call.ringing-in{animation:shcFlash 1.6s ease-in-out infinite}
@keyframes shcFlash{0%,100%{filter:brightness(1)}50%{filter:brightness(1.35)}}
#shc-call .shc-top{text-align:center;z-index:2;margin-top:4vh;width:100%}
#shc-call .shc-av{position:relative;width:min(34vw,140px);height:min(34vw,140px);margin:0 auto 18px;border-radius:50%;background:linear-gradient(135deg,#34d399,#1f6feb);
  display:flex;align-items:center;justify-content:center;font-size:min(12vw,52px);font-weight:800;box-shadow:0 10px 40px rgba(0,0,0,.35)}
#shc-call .shc-av::before,#shc-call .shc-av::after{content:"";position:absolute;inset:-14px;border-radius:50%;border:2px solid rgba(255,255,255,.35);opacity:0}
#shc-call.ringing .shc-av::before,#shc-call.ringing-in .shc-av::before{animation:shcPulse 1.8s ease-out infinite}
#shc-call.ringing .shc-av::after,#shc-call.ringing-in .shc-av::after{animation:shcPulse 1.8s ease-out .9s infinite}
@keyframes shcPulse{0%{transform:scale(.85);opacity:.9}100%{transform:scale(1.6);opacity:0}}
#shc-call .shc-name{font-size:clamp(1.3rem,6vw,2rem);font-weight:800;margin:0 0 6px;word-break:break-word}
#shc-call .shc-status{font-size:clamp(.95rem,4vw,1.1rem);opacity:.85;min-height:1.4em}
#shc-call .shc-brand{font-size:.78rem;opacity:.6;margin-top:6px;letter-spacing:.04em}
#shc-call video{background:#000}
#shc-call #shc-remote-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none;z-index:0}
#shc-call #shc-local-video{position:absolute;right:14px;top:max(14px,env(safe-area-inset-top));width:min(28vw,140px);aspect-ratio:3/4;object-fit:cover;border-radius:14px;
  border:2px solid rgba(255,255,255,.8);display:none;z-index:3;transform:scaleX(-1)}
#shc-call.video-live #shc-remote-video,#shc-call.video-live #shc-local-video{display:block}
#shc-call.video-live .shc-top{background:linear-gradient(rgba(0,0,0,.45),transparent);padding:8px calc(min(28vw,140px) + 22px) 30px;margin-top:0}
#shc-call.video-live .shc-av{display:none}
#shc-call.video-live #shc-local-video.back{transform:none}
#shc-call .shc-bar{display:flex;gap:clamp(6px,3vw,22px);justify-content:center;align-items:center;flex-wrap:wrap;z-index:2;width:100%;max-width:520px;margin-bottom:2vh}
#shc-call .shc-btn{width:clamp(46px,14vw,68px);height:clamp(46px,14vw,68px);border-radius:50%;border:none;cursor:pointer;font-size:clamp(1.1rem,5vw,1.45rem);
  color:#fff;background:rgba(255,255,255,.18);backdrop-filter:blur(6px);display:inline-flex;align-items:center;justify-content:center;transition:transform .12s,background .2s}
#shc-call .shc-btn:active{transform:scale(.92)}
#shc-call .shc-btn.on{background:#fff;color:#0b2a5b}
#shc-call .shc-btn.red{background:#ef4444;width:clamp(54px,17vw,76px);height:clamp(54px,17vw,76px)}
#shc-call .shc-btn.green{background:#22c55e;width:clamp(62px,19vw,76px);height:clamp(62px,19vw,76px);animation:shcBounce 1.2s ease-in-out infinite}
@keyframes shcBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
#shc-call .shc-lbl{display:block;font-size:.7rem;opacity:.8;margin-top:6px;text-align:center}
#shc-call .shc-cell{display:flex;flex-direction:column;align-items:center}
#shc-call .shc-tap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:4;background:#fff;color:#0b2a5b;border:none;border-radius:999px;
  padding:14px 22px;font-weight:800;font-size:1rem;box-shadow:0 10px 30px rgba(0,0,0,.4);display:none;cursor:pointer}
#shc-call .shc-hide{display:none!important}
@media (max-height:520px){#shc-call .shc-top{margin-top:0}#shc-call .shc-av{width:72px;height:72px;font-size:28px;margin-bottom:8px}#shc-call .shc-bar{margin-bottom:0}}
@media (min-width:900px){#shc-call #shc-local-video{width:200px}}
#shc-alerts{position:fixed;left:50%;transform:translateX(-50%);top:max(10px,env(safe-area-inset-top));z-index:2147482000;width:min(560px,calc(100% - 20px));
  background:#0b2a5b;color:#fff;border-radius:14px;padding:12px 14px;display:none;gap:10px;align-items:center;box-shadow:0 10px 30px rgba(0,0,0,.3);font-size:.9rem}
#shc-alerts.show{display:flex}
#shc-alerts button{border:none;border-radius:999px;padding:8px 14px;font-weight:700;cursor:pointer;white-space:nowrap}
#shc-alerts .yes{background:#22c55e;color:#fff}#shc-alerts .no{background:transparent;color:#fff;opacity:.8}`;
    document.head.appendChild(css);

    const el = document.createElement("div");
    el.id = "shc-call";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Call");
    el.innerHTML = `
      <video id="shc-remote-video" autoplay playsinline muted></video>
      <video id="shc-local-video" autoplay playsinline muted></video>
      <audio id="shc-remote-audio" autoplay playsinline></audio>
      <div class="shc-top">
        <div class="shc-av" id="shc-av">?</div>
        <h2 class="shc-name" id="shc-name">…</h2>
        <div class="shc-status" id="shc-status" aria-live="polite"></div>
        <div class="shc-brand">ServiceHub Kenya call</div>
      </div>
      <button class="shc-tap" id="shc-tap" type="button"><i class="fas fa-volume-up"></i> Tap to hear the call</button>
      <div class="shc-bar" id="shc-bar-in">
        <div class="shc-cell"><button class="shc-btn red" type="button" id="shc-decline" aria-label="Decline"><i class="fas fa-phone-slash"></i></button><span class="shc-lbl">Decline</span></div>
        <div class="shc-cell"><button class="shc-btn green" type="button" id="shc-accept" aria-label="Answer"><i class="fas fa-phone"></i></button><span class="shc-lbl">Answer</span></div>
      </div>
      <div class="shc-bar shc-hide" id="shc-bar-call">
        <div class="shc-cell"><button class="shc-btn" type="button" id="shc-mute" aria-label="Mute"><i class="fas fa-microphone"></i></button><span class="shc-lbl">Mute</span></div>
        <div class="shc-cell shc-v"><button class="shc-btn" type="button" id="shc-cam" aria-label="Camera off"><i class="fas fa-video"></i></button><span class="shc-lbl">Camera</span></div>
        <div class="shc-cell shc-v"><button class="shc-btn" type="button" id="shc-flip" aria-label="Switch camera"><i class="fas fa-sync-alt"></i></button><span class="shc-lbl">Flip</span></div>
        <div class="shc-cell" id="shc-spk-cell"><button class="shc-btn" type="button" id="shc-spk" aria-label="Audio output"><i class="fas fa-volume-up"></i></button><span class="shc-lbl" id="shc-spk-lbl">Speaker</span></div>
        <div class="shc-cell"><button class="shc-btn red" type="button" id="shc-end" aria-label="End call"><i class="fas fa-phone-slash"></i></button><span class="shc-lbl">End</span></div>
      </div>`;
    document.body.appendChild(el);

    const bar = document.createElement("div");
    bar.id = "shc-alerts";
    bar.innerHTML = `<i class="fas fa-bell" style="font-size:1.2rem"></i><div style="flex:1">Turn on call alerts so your phone rings for ServiceHub calls, even when ServiceHub is closed.</div>
      <button class="yes" type="button" id="shc-alerts-yes">Turn on</button><button class="no" type="button" id="shc-alerts-no">Later</button>`;
    document.body.appendChild(bar);

    $("shc-accept").onclick = () => acceptCall();
    $("shc-decline").onclick = () => rejectCall();
    $("shc-end").onclick = () => endCall();
    $("shc-mute").onclick = () => toggleMute();
    $("shc-cam").onclick = () => toggleCamera();
    $("shc-flip").onclick = () => flipCamera();
    $("shc-spk").onclick = () => toggleSpeaker();
    $("shc-tap").onclick = () => { unlockAudio(); };
    $("shc-alerts-yes").onclick = () => enableAlerts(true);
    $("shc-alerts-no").onclick = () => { $("shc-alerts").classList.remove("show"); try { localStorage.setItem("sh_alerts_later", String(Date.now())); } catch (e) {} };
    initSpeakerButton();
  }

  function showScreen({ name, status, type, mode }) {
    injectUI();
    const el = $("shc-call");
    $("shc-av").textContent = initials(name);
    $("shc-name").textContent = name || "ServiceHub user";
    setStatus(status || "");
    el.classList.add("open");
    el.classList.toggle("ringing-in", mode === "incoming");
    el.classList.toggle("ringing", mode === "outgoing");
    $("shc-bar-in").classList.toggle("shc-hide", mode !== "incoming");
    $("shc-bar-call").classList.toggle("shc-hide", mode === "incoming");
    el.querySelectorAll(".shc-v").forEach((v) => v.classList.toggle("shc-hide", type !== "video"));
    document.documentElement.style.overflow = "hidden";
    if (mode === "incoming") setTimeout(() => { try { $("shc-accept").focus(); } catch (e) {} }, 50);
  }
  function setStatus(t) { const s = $("shc-status"); if (s) s.textContent = t; }
  function hideScreen() {
    const el = $("shc-call"); if (!el) return;
    el.classList.remove("open", "ringing", "ringing-in", "video-live");
    document.documentElement.style.overflow = "";
    hideTapForSound();
    ["shc-remote-video", "shc-local-video", "shc-remote-audio"].forEach((id) => { const v = $(id); if (v) v.srcObject = null; });
    $("shc-mute").classList.remove("on"); $("shc-mute").innerHTML = '<i class="fas fa-microphone"></i>';
    $("shc-cam").classList.remove("on"); $("shc-cam").innerHTML = '<i class="fas fa-video"></i>';
    $("shc-spk").classList.remove("on"); if (NATIVE()) $("shc-spk-lbl").textContent = "Speaker";
  }
  function showTapForSound() { const b = $("shc-tap"); if (b) b.style.display = "block"; }
  function hideTapForSound() { const b = $("shc-tap"); if (b) b.style.display = "none"; }

  /* ───────────────────────── WebRTC ───────────────────────── */
  async function iceServers() {
    if (S.iceCache && Date.now() - S.iceCacheAt < 10 * 60 * 1000) return S.iceCache;
    try {
      const r = await fetch(`${api()}/calls/ice-servers`, { headers: { Authorization: `Bearer ${token()}` } });
      const d = await r.json();
      if (d.success && Array.isArray(d.iceServers) && d.iceServers.length) { S.iceCache = d.iceServers; S.iceCacheAt = Date.now(); return d.iceServers; }
    } catch (e) {}
    return [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  }

  async function getMedia(type) {
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("unsupported");
    if (type === "video") {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio, video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } } });
      } catch (e) {
        notify("Camera not available, continuing with voice only.", "warning");
      }
    }
    return navigator.mediaDevices.getUserMedia({ audio, video: false });
  }

  function mediaError(err) {
    const n = err && err.name;
    if (n === "NotAllowedError" || n === "SecurityError") notify("ServiceHub needs microphone access for calls. Allow it in your browser/app settings and try again.", "error");
    else if (n === "NotFoundError") notify("No microphone found on this device.", "error");
    else if (n === "NotReadableError") notify("Your microphone is being used by another app. Close it and try again.", "error");
    else notify("Calls are not supported on this browser. Please update Chrome or use the latest browser.", "error");
  }

  async function createPC() {
    const pc = new RTCPeerConnection({ iceServers: await iceServers(), iceCandidatePoolSize: 4, bundlePolicy: "max-bundle" });
    S.pc = pc;
    S.remote = new MediaStream();
    S.local.getTracks().forEach((t) => pc.addTrack(t, S.local));

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const c = e.candidate.toJSON ? e.candidate.toJSON() : e.candidate;
      if (S.call && S.call.id) sock() && sock().emit("call_ice", { callId: S.call.id, candidate: c });
      else S.localIceBuffer.push(c);
    };

    pc.ontrack = (e) => {
      const stream = e.streams && e.streams[0];
      if (stream) S.remote = stream; else S.remote.addTrack(e.track);
      const ra = $("shc-remote-audio");
      if (ra.srcObject !== S.remote) ra.srcObject = S.remote;
      ra.muted = false; ra.volume = 1;
      ra.play().then(hideTapForSound).catch(() => showTapForSound());
      if (e.track.kind === "video") {
        const rv = $("shc-remote-video");
        rv.srcObject = S.remote;
        rv.play().catch(() => {});
        $("shc-call").classList.add("video-live");
      }
    };

    const onState = () => {
      const st = pc.connectionState || pc.iceConnectionState;
      if (st === "connected" || st === "completed") {
        clearTimeout(S.discTimer); S.discTimer = null; S.restartTries = 0;
        if (!S.connectedOnce) { S.connectedOnce = true; onConnected(); } else setStatus("");
      } else if (st === "disconnected") {
        setStatus("Reconnecting…");
        clearTimeout(S.discTimer);
        S.discTimer = setTimeout(() => restartIce(), 4000);
      } else if (st === "failed") {
        restartIce();
      }
    };
    pc.onconnectionstatechange = onState;
    pc.oniceconnectionstatechange = () => { if (!("connectionState" in pc)) onState(); };
    return pc;
  }

  async function restartIce() {
    if (!S.pc || !S.call || S.call.state !== "active") return;
    if (S.restartTries >= 3) { notify("The call dropped because the network is too weak.", "error"); finish("failed"); return; }
    S.restartTries++;
    setStatus("Reconnecting…");
    if (S.call.role === "caller") {
      try {
        const offer = await S.pc.createOffer({ iceRestart: true });
        await S.pc.setLocalDescription(offer);
        sock().emit("call_renegotiate", { callId: S.call.id, description: S.pc.localDescription });
      } catch (e) {}
    } else {
      sock() && sock().emit("call_renegotiate", { callId: S.call.id, request: true });
    }
  }

  async function onRenegotiate({ callId, description, request }) {
    if (!S.call || S.call.id !== callId || !S.pc) return;
    if (request) { if (S.call.role === "caller") { S.restartTries = Math.max(0, S.restartTries - 1); restartIce(); } return; }
    try {
      await S.pc.setRemoteDescription(description);
      flushIce();
      if (description.type === "offer") {
        const ans = await S.pc.createAnswer();
        await S.pc.setLocalDescription(ans);
        sock().emit("call_renegotiate", { callId, description: S.pc.localDescription });
      }
    } catch (e) { console.warn("renegotiate", e); }
  }

  function addIce(c) {
    if (S.pc && S.pc.remoteDescription && S.pc.remoteDescription.type) S.pc.addIceCandidate(c).catch(() => {});
    else S.pendingIce.push(c);
  }
  function flushIce() { const q = S.pendingIce; S.pendingIce = []; q.forEach((c) => S.pc.addIceCandidate(c).catch(() => {})); }

  function onConnected() {
    stopTones(); stopFlash();
    $("shc-call").classList.remove("ringing", "ringing-in");
    S.seconds = 0; setStatus("00:00");
    clearInterval(S.timer);
    if (NATIVE() && S.call) {
      S.speaker = S.call.type === "video";
      nat("setInCall", { active: true, speaker: S.speaker, video: S.call.type === "video" });
      const b = $("shc-spk"); if (b) b.classList.toggle("on", S.speaker);
    }
    S.timer = setInterval(() => { S.seconds++; if (S.pc && (S.pc.connectionState === "connected" || S.pc.iceConnectionState === "connected" || S.pc.iceConnectionState === "completed")) setStatus(fmt(S.seconds)); }, 1000);
    keepAwake();
  }

  /* ───────────────────────── outgoing ───────────────────────── */
  async function startCall(type) {
    type = type === "video" ? "video" : "voice";
    const convEl = $("active-conversation-id");
    const convId = convEl ? convEl.value : "";
    const peerName = ($("current-chat-user") || {}).textContent || "ServiceHub user";
    if (!convId) { notify("Open a conversation first, then tap call.", "info"); return; }
    const s = sock();
    if (!s || !s.connected) { notify("You're offline. Check your internet connection and try again.", "error"); return; }
    if (S.call || S.incoming) { notify("You're already on a call.", "info"); return; }
    unlockAudio();

    S.call = { id: null, conversationId: convId, peerName, type, role: "caller", state: "starting" };
    showScreen({ name: peerName, status: "Starting call…", type, mode: "outgoing" });
    try { S.local = await getMedia(type); } catch (e) { mediaError(e); cleanupMedia(); hideScreen(); S.call = null; return; }
    if (!S.call) { cleanupMedia(); return; } // cancelled while asking for the mic
    if (S.local.getVideoTracks().length) {
      const lv = $("shc-local-video"); lv.srcObject = S.local; lv.play().catch(() => {});
      $("shc-call").classList.add("video-live");
    } else if (type === "video") { S.call.type = "voice"; showScreen({ name: peerName, status: "Calling…", type: "voice", mode: "outgoing" }); }
    keepAwake();

    try {
      await createPC();
      const offer = await S.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: S.call.type === "video" });
      await S.pc.setLocalDescription(offer);
    } catch (e) { notify("Could not start the call on this device.", "error"); finish("error"); return; }
    setStatus("Calling…");

    s.timeout(15000).emit("call_start", { conversationId: convId, callType: S.call.type, offer: S.pc.localDescription }, (err, res) => {
      if (!S.call) return;
      if (err || !res) { notify("Couldn't reach ServiceHub. Check your connection.", "error"); finish("error"); return; }
      if (!res.ok) {
        const msg = { busy: `${peerName} is on another call.`, in_call: "You're already on a call.", not_allowed: "You can't call this person.", invalid: "Could not start the call." }[res.reason] || "Could not start the call.";
        setStatus(res.reason === "busy" ? "Busy" : "Call failed");
        if (res.reason === "busy") playBusy();
        notify(msg, "info");
        finish("busy", 2600, true);
        return;
      }
      S.call.id = res.callId; S.call.state = "ringing";
      S.localIceBuffer.forEach((c) => s.emit("call_ice", { callId: res.callId, candidate: c }));
      S.localIceBuffer = [];
      if (!res.calleeOnline) setStatus("Calling…");
      S.call.ringGuard = setTimeout(() => { if (S.call && S.call.state === "ringing") { setStatus("No answer"); playBusy(); finish("no_answer", 2600, true); } }, RING_TIMEOUT_MS + 4000);
    });
  }

  function onRinging({ callId }) {
    if (!S.call || S.call.id !== callId || S.call.state !== "ringing") return;
    if (!S.call.ringingShown) { S.call.ringingShown = true; setStatus("Ringing…"); startRingback(); }
  }

  async function onAnswered({ callId, answer }) {
    if (!S.call || S.call.id !== callId || !S.pc) return;
    S.call.state = "active";
    clearTimeout(S.call.ringGuard);
    stopTones();
    $("shc-call").classList.remove("ringing");
    setStatus("Connecting…");
    try { await S.pc.setRemoteDescription(answer); flushIce(); } catch (e) { notify("The call could not connect.", "error"); finish("error"); }
  }

  function onDeclined({ callId }) {
    if (!S.call || S.call.id !== callId) return;
    setStatus("Call declined"); playBusy(); finish("declined", 2400, true);
  }
  function onNoAnswer({ callId, reason }) {
    if (!S.call || S.call.id !== callId) return;
    setStatus(reason === "unreachable" ? "Not reachable right now" : "No answer");
    playBusy(); finish("no_answer", 2600, true);
  }

  /* ───────────────────────── incoming ───────────────────────── */
  function onIncoming(d) {
    if (!d || !d.callId) return;
    if (S.call && S.call.id === d.callId) return;
    if (S.call) return; // server already treats us as busy
    if (S.incoming && S.incoming.callId === d.callId) {
      (d.candidates || []).forEach((c) => S.pendingIce.push(c));
      return maybeAuto();
    }
    S.incoming = { ...d };
    S.pendingIce = (d.candidates || []).slice();
    sock() && sock().emit("call_ringing", { callId: d.callId });
    const video = d.callType === "video";
    showScreen({ name: d.callerName, status: video ? "Incoming video call…" : "Incoming voice call…", type: d.callType, mode: "incoming" });
    flashTitle(`📞 ${d.callerName} is calling…`);
    keepAwake();
    if (!document.hidden) startRingtone();
    if (document.hidden || !unlocked) showSystemRing(d);
    clearTimeout(S.incomingGuard);
    S.incomingGuard = setTimeout(() => { if (S.incoming && S.incoming.callId === d.callId) clearIncoming("Missed call"); }, RING_TIMEOUT_MS + 5000);
    maybeAuto();
  }

  function maybeAuto() {
    if (!S.autoAction || !S.incoming || S.autoAction.callId !== S.incoming.callId) return;
    const a = S.autoAction.action; S.autoAction = null;
    if (a === "accept") acceptCall();
  }

  async function showSystemRing(d) {
    if (NATIVE()) return; // the app's own notification handles background ringing
    try {
      if (!("serviceWorker" in navigator) || Notification.permission !== "granted") return;
      const reg = await navigator.serviceWorker.getRegistration("/");
      if (!reg) return;
      reg.showNotification(d.callType === "video" ? "Incoming video call" : "Incoming voice call", {
        body: `${d.callerName} is calling you on ServiceHub`, tag: "call-" + d.callId, renotify: true, requireInteraction: true,
        vibrate: [900, 400, 900, 400, 900, 400, 900], icon: "/icons/icon-192.png", badge: "/icons/badge-72.png",
        actions: [{ action: "decline", title: "Decline" }, { action: "accept", title: "Answer" }],
        data: { type: "call", callId: d.callId, conversationId: d.conversationId, callerName: d.callerName, callType: d.callType },
      });
    } catch (e) {}
  }
  async function closeSystemRing(callId) {
    nat("cancelCallNotification", { callId });
    try {
      const reg = "serviceWorker" in navigator && (await navigator.serviceWorker.getRegistration("/"));
      if (reg) (await reg.getNotifications({ tag: "call-" + callId })).forEach((n) => n.close());
    } catch (e) {}
  }

  async function acceptCall() {
    const inc = S.incoming;
    if (!inc) return;
    unlockAudio();
    stopTones(); stopFlash(); closeSystemRing(inc.callId);
    clearTimeout(S.incomingGuard);
    S.incoming = null;
    S.call = { id: inc.callId, conversationId: inc.conversationId, peerName: inc.callerName, type: inc.callType, role: "callee", state: "answering" };
    showScreen({ name: inc.callerName, status: "Connecting…", type: inc.callType, mode: "call" });

    try { S.local = await getMedia(inc.callType); } catch (e) { mediaError(e); sock() && sock().emit("call_reject", { callId: inc.callId }); finish("error"); return; }
    if (S.local.getVideoTracks().length) {
      const lv = $("shc-local-video"); lv.srcObject = S.local; lv.play().catch(() => {});
      $("shc-call").classList.add("video-live");
    } else if (inc.callType === "video") {
      $("shc-call").querySelectorAll(".shc-v").forEach((v) => v.classList.add("shc-hide"));
    }
    try {
      await createPC();
      await S.pc.setRemoteDescription(inc.offer);
      flushIce();
      const answer = await S.pc.createAnswer();
      await S.pc.setLocalDescription(answer);
    } catch (e) { notify("The call could not connect.", "error"); sock() && sock().emit("call_reject", { callId: inc.callId }); finish("error"); return; }

    sock().timeout(12000).emit("call_answer", { callId: inc.callId, answer: S.pc.localDescription }, (err, res) => {
      if (!S.call || S.call.id !== inc.callId) return;
      if (err || !res || !res.ok) {
        const why = res && res.reason === "answered_elsewhere" ? "Answered on another device" : "The call has ended";
        setStatus(why); finish("gone", 1800, true); return;
      }
      S.call.state = "active";
      S.localIceBuffer.forEach((c) => sock().emit("call_ice", { callId: inc.callId, candidate: c }));
      S.localIceBuffer = [];
    });
    keepAwake();
  }

  function rejectCall() {
    const inc = S.incoming;
    if (!inc) return;
    sock() && sock().emit("call_reject", { callId: inc.callId });
    clearIncoming("");
  }

  function clearIncoming(statusText) {
    const inc = S.incoming;
    S.incoming = null;
    clearTimeout(S.incomingGuard);
    stopTones(); stopFlash();
    if (inc) closeSystemRing(inc.callId);
    S.pendingIce = [];
    if (!S.call) {
      if (statusText) { setStatus(statusText); setTimeout(() => { if (!S.call && !S.incoming) { hideScreen(); releaseAwake(); } }, 1600); }
      else { hideScreen(); releaseAwake(); }
    }
  }

  function onCancelled({ callId, reason }) {
    if (S.incoming && S.incoming.callId === callId) clearIncoming(reason === "declined" ? "" : "Missed call");
  }
  function onHandledElsewhere({ callId }) {
    if (S.incoming && S.incoming.callId === callId) clearIncoming("Answered on another device");
  }

  /* ───────────────────────── in-call controls ───────────────────────── */
  function toggleMute() {
    if (!S.local) return;
    S.muted = !S.muted;
    S.local.getAudioTracks().forEach((t) => (t.enabled = !S.muted));
    const b = $("shc-mute");
    b.classList.toggle("on", S.muted);
    b.innerHTML = S.muted ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
  }
  function toggleCamera() {
    if (!S.local) return;
    const v = S.local.getVideoTracks(); if (!v.length) return;
    S.camOff = !S.camOff;
    v.forEach((t) => (t.enabled = !S.camOff));
    const b = $("shc-cam");
    b.classList.toggle("on", S.camOff);
    b.innerHTML = S.camOff ? '<i class="fas fa-video-slash"></i>' : '<i class="fas fa-video"></i>';
    $("shc-local-video").style.visibility = S.camOff ? "hidden" : "visible";
  }
  async function flipCamera() {
    if (!S.local || !S.pc || !S.local.getVideoTracks().length) return;
    const next = S.facing === "user" ? "environment" : "user";
    try {
      const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: next }, width: { ideal: 1280 }, height: { ideal: 720 } } })
        .catch(() => navigator.mediaDevices.getUserMedia({ video: { facingMode: next } }));
      const track = ns.getVideoTracks()[0];
      const sender = S.pc.getSenders().find((x) => x.track && x.track.kind === "video");
      if (sender) await sender.replaceTrack(track);
      S.local.getVideoTracks().forEach((t) => { S.local.removeTrack(t); t.stop(); });
      S.local.addTrack(track);
      track.enabled = !S.camOff;
      S.facing = next;
      const lv = $("shc-local-video"); lv.srcObject = S.local; lv.classList.toggle("back", next === "environment");
    } catch (e) { notify("Could not switch camera on this device.", "info"); }
  }

  // Audio output: uses setSinkId where the browser supports picking speaker/earpiece/Bluetooth.
  let outputs = [], outIdx = 0;
  async function initSpeakerButton() {
    const cell = $("shc-spk-cell");
    if (NATIVE()) { if (cell) cell.classList.remove("shc-hide"); return; } // real loudspeaker / earpiece switch in the app
    const ra = $("shc-remote-audio");
    if (!ra || typeof ra.setSinkId !== "function" || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) { if (cell) cell.classList.add("shc-hide"); return; }
    try { outputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput"); } catch (e) { outputs = []; }
    if (cell) cell.classList.toggle("shc-hide", outputs.length < 2);
  }
  async function toggleSpeaker() {
    if (NATIVE()) {
      if (!S.call) return;
      S.speaker = !S.speaker;
      await nat("setInCall", { active: true, speaker: S.speaker, video: S.call.type === "video" });
      const b = $("shc-spk"); if (b) b.classList.toggle("on", S.speaker);
      $("shc-spk-lbl").textContent = S.speaker ? "Speaker on" : "Speaker";
      return;
    }
    const ra = $("shc-remote-audio");
    try {
      outputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput");
      if (outputs.length < 2) return;
      outIdx = (outIdx + 1) % outputs.length;
      await ra.setSinkId(outputs[outIdx].deviceId);
      const lbl = outputs[outIdx].label || (outIdx === 0 ? "Default" : "Output " + (outIdx + 1));
      $("shc-spk-lbl").textContent = lbl.length > 12 ? lbl.slice(0, 11) + "…" : lbl;
      notify(`Audio: ${lbl}`, "info");
    } catch (e) {}
  }

  /* ───────────────────────── ending ───────────────────────── */
  function endCall() {
    if (S.incoming && !S.call) { rejectCall(); return; }
    if (!S.call) { hideScreen(); return; }
    if (S.call.id && sock()) sock().emit("call_end", { callId: S.call.id });
    const secs = S.connectedOnce ? S.seconds : 0;
    setStatus(secs ? `Call ended · ${fmt(secs)}` : "Call ended");
    finish("hangup", 1200, true);
  }
  function onEnded({ callId, reason }) {
    if (!S.call || S.call.id !== callId) return;
    const secs = S.connectedOnce ? S.seconds : 0;
    setStatus(reason === "disconnected" ? "Call dropped" : secs ? `Call ended · ${fmt(secs)}` : "Call ended");
    finish("remote", 1500, true);
  }

  function cleanupMedia() {
    if (S.local) { S.local.getTracks().forEach((t) => t.stop()); S.local = null; }
    if (S.pc) { try { S.pc.ontrack = S.pc.onicecandidate = S.pc.onconnectionstatechange = S.pc.oniceconnectionstatechange = null; S.pc.close(); } catch (e) {} S.pc = null; }
    S.remote = null;
  }

  function finish(reason, delay, keepStatus) {
    const c = S.call;
    if (c) clearTimeout(c.ringGuard);
    if (NATIVE()) { nat("setInCall", { active: false }); S.speaker = false; }
    clearInterval(S.timer); S.timer = null;
    clearTimeout(S.discTimer); S.discTimer = null;
    cleanupMedia();
    S.call = null; S.pendingIce = []; S.localIceBuffer = [];
    S.connectedOnce = false; S.seconds = 0; S.muted = false; S.camOff = false; S.facing = "user"; S.restartTries = 0;
    if (reason !== "busy" && reason !== "no_answer" && reason !== "declined") playEnd();
    stopFlash();
    const close = () => { if (!S.call && !S.incoming) { stopTones(); hideScreen(); releaseAwake(); } };
    if (delay) setTimeout(close, delay); else close();
    if (!keepStatus) setStatus("");
  }

  /* ───────────────────────── socket wiring ───────────────────────── */
  function attach(s) {
    if (!s || S.attachedSocket === s) return;
    S.attachedSocket = s;
    try { if (s.io && s.io.opts) { s.io.opts.reconnectionAttempts = Infinity; s.io.reconnectionAttempts(Infinity); } } catch (e) {}
    ["incoming_call", "call_answered", "call_rejected", "call_ended", "webrtc_offer", "webrtc_answer", "webrtc_ice_candidate"].forEach((ev) => s.off(ev)); // v1 listeners
    s.on("call_incoming", onIncoming);
    s.on("call_ringing", onRinging);
    s.on("call_answered", onAnswered);
    s.on("call_declined", onDeclined);
    s.on("call_no_answer", onNoAnswer);
    s.on("call_cancelled", onCancelled);
    s.on("call_handled_elsewhere", onHandledElsewhere);
    s.on("call_ended", onEnded);
    s.on("call_ice", ({ callId, candidate }) => {
      const id = (S.call && S.call.id) || (S.incoming && S.incoming.callId);
      if (id && id === callId && candidate) addIce(candidate);
    });
    s.on("call_renegotiate", onRenegotiate);
    const sync = () => {
      s.timeout(8000).emit("call_sync", { activeCallId: S.call && S.call.id }, (err, res) => {
        if (err || !res) return;
        if (S.call && S.call.state === "active" && (!res.call || res.call.callId !== S.call.id)) onEnded({ callId: S.call.id, reason: "disconnected" });
        if (S.call && S.call.state === "active" && S.pc && S.pc.connectionState !== "connected") restartIce();
      });
    };
    s.on("connect", sync);
    if (s.connected) sync();
    setupAlerts();
  }

  // Attach as soon as the chat socket exists (it is created after sign-in)
  setInterval(() => {
    const s = sock();
    if (s && s !== S.attachedSocket) attach(s);
    if (!s && S.attachedSocket) {
      S.attachedSocket = null;
      if (S.call || S.incoming) { clearIncoming(""); finish("logout"); }
      if (!token()) unsubscribeDevice(); // signed out: stop ringing this phone for that account
    }
  }, 700);

  async function unsubscribeDevice() {
    if (NATIVE()) {
      const t = nativeToken || ((await nat("getPushToken")) || {}).token;
      if (t) fetch(`${api()}/calls/push/unsubscribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: "fcm:" + t }) }).catch(() => {});
      nativeToken = null;
      return;
    }
    try {
      const reg = "serviceWorker" in navigator && (await navigator.serviceWorker.getRegistration("/"));
      const sub = reg && (await reg.pushManager.getSubscription());
      if (!sub) return;
      await fetch(`${api()}/calls/push/unsubscribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    } catch (e) {}
  }

  /* ───────────────────────── push alerts (phone rings in background) ───────────────────────── */
  function pushSupported() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && !inApp(); }
  function b64ToU8(b64) { const p = "=".repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); }

  async function registerSW() {
    if (!("serviceWorker" in navigator) || NATIVE()) return null;
    try { return await navigator.serviceWorker.register("/sw.js", { scope: "/" }); } catch (e) { return null; }
  }

  async function subscribe() {
    const reg = await registerSW(); if (!reg) return false;
    await navigator.serviceWorker.ready;
    const kr = await fetch(`${api()}/calls/push/key`).then((r) => r.json()).catch(() => null);
    if (!kr || !kr.publicKey) return false;
    let sub = await reg.pushManager.getSubscription();
    const key = b64ToU8(kr.publicKey);
    if (sub) {
      const cur = sub.options && sub.options.applicationServerKey && new Uint8Array(sub.options.applicationServerKey);
      if (cur && (cur.length !== key.length || cur.some((v, i) => v !== key[i]))) { await sub.unsubscribe().catch(() => {}); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const r = await fetch(`${api()}/calls/push/subscribe`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` }, body: JSON.stringify({ subscription: sub.toJSON() }) }).then((x) => x.json()).catch(() => null);
    return !!(r && r.success);
  }

  async function enableAlerts(fromClick) {
    $("shc-alerts") && $("shc-alerts").classList.remove("show");
    if (!pushSupported()) return;
    try {
      let perm = Notification.permission;
      if (perm === "default" && fromClick) perm = await Notification.requestPermission();
      if (perm !== "granted") {
        if (fromClick) notify("Call alerts are blocked. Allow notifications for servicehub.co.ke in your browser settings.", "warning");
        return;
      }
      const ok = await subscribe();
      if (fromClick) notify(ok ? "Call alerts are on. Your phone will ring for ServiceHub calls." : "Could not turn on call alerts on this device.", ok ? "success" : "error");
    } catch (e) { if (fromClick) notify("Could not turn on call alerts on this device.", "error"); }
  }

  /* ── Android app: native call alerts (FCM) ── */
  let nativeToken = null, nativeRecheck = false;
  async function registerNativeToken() {
    const r = await nat("getPushToken");
    if (!r || !r.token || !token()) return false;
    nativeToken = r.token;
    const res = await fetch(`${api()}/calls/push/subscribe-native`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` }, body: JSON.stringify({ token: r.token, platform: "android" }) }).then((x) => x.json()).catch(() => null);
    return !!(res && res.success);
  }
  function snoozed(key, days) { let t = 0; try { t = Number(localStorage.getItem(key) || 0); } catch (e) {} return Date.now() - t < days * 864e5; }
  function alertBanner(text, yesLabel, onYes, key) {
    injectUI();
    const bar = $("shc-alerts");
    bar.querySelector("div").textContent = text;
    const y = $("shc-alerts-yes"); y.textContent = yesLabel;
    y.onclick = () => { bar.classList.remove("show"); nativeRecheck = true; onYes(); };
    $("shc-alerts-no").onclick = () => { bar.classList.remove("show"); try { localStorage.setItem(key, String(Date.now())); } catch (e) {} };
    bar.classList.add("show");
  }
  async function setupNativeAlerts() {
    if (!token()) return;
    const st = await nat("alertStatus");
    if (!st) return;
    if (st.notifications) registerNativeToken();
    if (!st.notifications) {
      if (snoozed("sh_alerts_later", 3)) return;
      alertBanner("Turn on call alerts so your phone rings when someone calls you on ServiceHub.", "Turn on", async () => {
        const r = await nat("requestNotificationPermission");
        if (r && r.notifications) { nativeRecheck = false; await registerNativeToken(); notify("Call alerts are on. Your phone will ring for ServiceHub calls.", "success"); setTimeout(setupNativeAlerts, 800); }
        else { notify("Call alerts are off. Turn on notifications for ServiceHub in your phone settings.", "warning"); nat("openNotificationSettings"); }
      }, "sh_alerts_later");
      return;
    }
    if (!st.fullScreen) {
      if (snoozed("sh_fs_later", 7)) return;
      alertBanner("Allow ServiceHub to show calls on your lock screen, so incoming calls light up your screen like a normal phone call.", "Allow", () => nat("openFullScreenSettings"), "sh_fs_later");
      return;
    }
    const strict = /xiaomi|redmi|poco|tecno|infinix|itel|oppo|realme|vivo|huawei|honor|oneplus|transsion/i.test(st.manufacturer || "");
    if (strict && !st.batteryUnrestricted && !snoozed("sh_batt_later", 30)) {
      alertBanner("Your phone may close ServiceHub in the background and you could miss calls. Set ServiceHub's battery use to \"No restrictions\".", "Open settings", () => nat("openBatterySettings"), "sh_batt_later");
    }
  }
  function handleNativeAction(a) {
    if (!a) return;
    if (a.action === "open_chat") { openChat(a.conversationId, a.callerName); return; }
    if (!a.callId) return;
    if (S.incoming && S.incoming.callId === a.callId) { if (a.action === "accept") acceptCall(); return; }
    S.autoAction = { callId: a.callId, action: a.action === "accept" ? "accept" : "open" };
    const s = sock(); if (s && s.connected) s.emit("call_sync", {}, () => {});
  }
  (function initNative() {
    const N = NATIVE();
    if (!N || !N.addListener) return;
    N.addListener("callAction", handleNativeAction);
    N.addListener("callPush", () => { const s = sock(); if (s && s.connected && !S.incoming && !S.call) s.emit("call_sync", {}, () => {}); });
    N.addListener("pushToken", () => { if (token()) registerNativeToken(); });
    nat("getLaunchAction").then((r) => { if (r && r.action) handleNativeAction(r.action); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && nativeRecheck) { nativeRecheck = false; setTimeout(setupNativeAlerts, 600); } });
  })();

  function setupAlerts() {
    if (NATIVE()) { injectUI(); setupNativeAlerts(); return; }
    injectUI();
    registerSW();
    if (!pushSupported() || !token()) return;
    if (Notification.permission === "granted") { enableAlerts(false); return; }
    if (Notification.permission === "denied") return;
    let later = 0; try { later = Number(localStorage.getItem("sh_alerts_later") || 0); } catch (e) {}
    if (Date.now() - later > 3 * 24 * 3600 * 1000) setTimeout(() => { if (token()) $("shc-alerts").classList.add("show"); }, 2500);
  }

  // Messages from the service worker (notification tapped while the page is open)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (e) => {
      const m = e.data || {};
      if (m.type === "call_action") {
        if (S.incoming && S.incoming.callId === m.callId) { if (m.action === "accept") acceptCall(); }
        else { S.autoAction = { callId: m.callId, action: m.action }; const s = sock(); if (s && s.connected) s.emit("call_sync", {}, () => {}); }
      } else if (m.type === "call_push") {
        const s = sock(); if (s && s.connected && !S.incoming && !S.call) s.emit("call_sync", {}, () => {});
      } else if (m.type === "open_chat") openChat(m.conversationId, m.name);
    });
  }

  function openChat(convId, name) {
    if (!convId) return;
    const go = () => { try { showSection("chat"); } catch (e) {} try { openConversation(convId, name); } catch (e) {} };
    if (token()) setTimeout(go, 600);
  }

  // Opened from a notification: /?call=<id>&action=accept|open  or  /?chat=<conversationId>
  (function readUrl() {
    try {
      const q = new URLSearchParams(location.search);
      const callId = q.get("call"), action = q.get("action"), chat = q.get("chat");
      if (callId) S.autoAction = { callId, action: action === "accept" ? "accept" : "open" };
      if (chat) window.addEventListener("load", () => openChat(chat));
      if (callId || chat) history.replaceState(null, "", location.pathname + location.hash);
    } catch (e) {}
  })();

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", injectUI); else injectUI();
  registerSW();

  // Public API (the chat header buttons call startCall('voice') / startCall('video'))
  window.startCall = startCall;
  window.acceptCall = acceptCall;
  window.rejectCall = rejectCall;
  window.endCall = endCall;
  window.toggleMute = toggleMute;
  window.toggleSpeaker = toggleSpeaker;
  window.enableCallAlerts = () => enableAlerts(true);
  window.SHCalls = { attach, state: S };
})();
