/* ServiceHub Kenya - pin the job location on a map
   Client: pin the exact spot when posting a job (or later from My Jobs): use my current location,
   search a place, or tap / drag the pin. Hired provider: sees the exact pin with "Get directions".
   Everyone else: only the approximate area (about 1 km), so the client's home stays private.
   Maps: OpenStreetMap (free, no key). Directions open Google Maps on the phone. */
(function () {
  "use strict";
  const KENYA = { lat: 0.0236, lng: 37.9062, zoom: 6 };
  const COUNTY_CENTRES = {
    nairobi: [-1.2864, 36.8172], mombasa: [-4.0435, 39.6682], kisumu: [-0.0917, 34.768], nakuru: [-0.3031, 36.08], kiambu: [-1.1714, 36.8356],
    machakos: [-1.5177, 37.2634], eldoret: [0.5143, 35.2698], "uasin-gishu": [0.5143, 35.2698], meru: [0.0471, 37.6498], nyeri: [-0.4201, 36.9476],
    kakamega: [0.2827, 34.7519], "homa-bay": [-0.5273, 34.4571], kisii: [-0.6817, 34.7667], bungoma: [0.5635, 34.5606], siaya: [0.0607, 34.2881], migori: [-1.0634, 34.4731],
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const notify = (m, t) => { try { showNotification(m, t || "info"); } catch (e) {} };

  /* ── Leaflet (loaded only when a map is opened) ── */
  let leafletReady = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletReady) return leafletReady;
    leafletReady = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet"; css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(css);
      const js = document.createElement("script");
      js.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      js.onload = () => resolve(window.L);
      js.onerror = () => { leafletReady = null; reject(new Error("Map could not load")); };
      document.head.appendChild(js);
    });
    return leafletReady;
  }

  const style = document.createElement("style");
  style.textContent = `
  #sh-map-modal .modal-content{max-width:760px;width:100%;padding:0;overflow:hidden;display:flex;flex-direction:column;max-height:calc(100dvh - 24px)}
  #sh-map-modal .shm-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--light-gray)}
  #sh-map-modal .shm-head h3{margin:0;font-size:1.05rem;flex:1;min-width:0}
  #sh-map-modal .shm-tools{display:flex;gap:8px;padding:10px 16px;flex-wrap:wrap}
  #sh-map-modal .shm-tools input{flex:1 1 200px;min-width:0;padding:10px 12px;border:1.5px solid var(--light-gray);border-radius:10px;font:inherit;background:var(--white);color:var(--dark)}
  #sh-map-modal .shm-results{padding:0 16px;display:grid;gap:6px;max-height:140px;overflow:auto}
  #sh-map-modal .shm-results button{text-align:left;border:1px solid var(--light-gray);background:var(--white);color:var(--dark);border-radius:10px;padding:8px 10px;cursor:pointer;font-size:.85rem}
  #sh-map{flex:1 1 auto;min-height:300px;height:min(56vh,460px);width:100%;background:#e5e7eb}
  #sh-map-modal .shm-foot{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;border-top:1px solid var(--light-gray)}
  #sh-map-modal .shm-label{flex:1 1 220px;min-width:0;font-size:.85rem;color:var(--dark-gray);overflow-wrap:anywhere}
  #sh-map-modal .shm-hint{padding:0 16px 8px;font-size:.8rem;color:var(--medium-gray)}
  .sh-pin-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .sh-pin-row small{color:var(--medium-gray);overflow-wrap:anywhere}
  @media(max-width:520px){#sh-map{height:52vh}#sh-map-modal .shm-foot .sh-btn{flex:1 1 auto;justify-content:center}}`;
  document.head.appendChild(style);

  function modal() {
    let m = document.getElementById("sh-map-modal");
    if (m) return m;
    m = document.createElement("div");
    m.className = "modal"; m.id = "sh-map-modal";
    m.innerHTML = `<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="shm-title">
      <div class="shm-head"><i class="fas fa-map-marker-alt" style="color:#e53935;font-size:1.2rem"></i><h3 id="shm-title">Pin the job location</h3>
        <button type="button" class="modal-close" aria-label="Close" id="shm-close">&times;</button></div>
      <div id="shm-edit-tools">
        <div class="shm-tools">
          <button type="button" class="sh-btn pri" id="shm-gps"><i class="fas fa-location-crosshairs"></i> Use my current location</button>
          <input id="shm-q" type="search" placeholder="Search a place, estate or landmark" autocomplete="off">
          <button type="button" class="sh-btn ghost" id="shm-search"><i class="fas fa-search"></i></button>
        </div>
        <div id="shm-msg" style="display:none;margin:0 16px 8px;padding:10px 12px;border-radius:10px;font-size:.85rem;line-height:1.4"></div>
        <div class="shm-results" id="shm-results"></div>
        <div class="shm-hint">Tap the map or drag the red pin to the exact spot.</div>
      </div>
      <div id="sh-map"></div>
      <div class="shm-foot"><div class="shm-label" id="shm-label"></div><div id="shm-actions" style="display:flex;gap:8px;flex-wrap:wrap"></div></div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => { if (e.target === m) close(); });
    m.querySelector("#shm-close").onclick = close;
    return m;
  }

  let map = null, marker = null, circle = null, current = null, onSave = null, mode = "edit";
  function close() { const m = document.getElementById("sh-map-modal"); if (m) m.classList.remove("active"); }

  async function ensureMap() {
    const L = await loadLeaflet();
    if (!map) {
      map = L.map("sh-map", { zoomControl: true, attributionControl: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
      map.on("click", (e) => { if (mode === "edit") setPin(e.latlng.lat, e.latlng.lng, null, true); });
    }
    setTimeout(() => map.invalidateSize(), 60);
    return L;
  }

  function pinIcon(L) {
    return L.divIcon({ className: "", iconSize: [34, 44], iconAnchor: [17, 42],
      html: `<svg width="34" height="44" viewBox="0 0 34 44" aria-hidden="true"><path d="M17 1C8.2 1 1 8.1 1 16.9 1 29 17 43 17 43s16-14 16-26.1C33 8.1 25.8 1 17 1z" fill="#e53935" stroke="#fff" stroke-width="2"/><circle cx="17" cy="17" r="6" fill="#fff"/></svg>` });
  }

  function setPin(lat, lng, label, lookup, accuracy) {
    const L = window.L;
    current = { lat, lng, label: label || null, accuracy: accuracy || null };
    if (!marker) {
      marker = L.marker([lat, lng], { draggable: mode === "edit", icon: pinIcon(L) }).addTo(map);
      marker.on("dragend", () => { const p = marker.getLatLng(); setPin(p.lat, p.lng, null, true); });
    } else { marker.setLatLng([lat, lng]); if (marker.dragging) mode === "edit" ? marker.dragging.enable() : marker.dragging.disable(); }
    if (circle) { circle.remove(); circle = null; }
    if (accuracy && accuracy < 2000) circle = L.circle([lat, lng], { radius: accuracy, color: "#1f6feb", weight: 1, fillOpacity: 0.08 }).addTo(map);
    showLabel();
    if (lookup) reverse(lat, lng);
  }
  function showLabel() {
    const el = document.getElementById("shm-label");
    if (!el) return;
    if (!current) { el.innerHTML = '<i class="fas fa-info-circle"></i> No pin yet.'; return; }
    el.innerHTML = `<b>${esc(current.label || "Pinned location")}</b><br><small>${current.lat.toFixed(5)}, ${current.lng.toFixed(5)}</small>`;
  }

  let revTimer = 0;
  function reverse(lat, lng) {
    clearTimeout(revTimer);
    revTimer = setTimeout(async () => {
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lng}`, { headers: { "Accept-Language": "en" } });
        const d = await r.json();
        if (current && current.lat === lat && current.lng === lng && d && d.display_name) {
          current.label = d.display_name.split(",").slice(0, 3).join(",").trim();
          showLabel();
        }
      } catch (e) {}
    }, 500);
  }

  async function search() {
    const q = document.getElementById("shm-q").value.trim();
    const box = document.getElementById("shm-results");
    if (q.length < 3) { box.innerHTML = ""; return; }
    box.innerHTML = '<div style="font-size:.85rem;color:var(--medium-gray)"><i class="fas fa-spinner fa-spin"></i> Searching…</div>';
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=ke&limit=6&q=${encodeURIComponent(q)}`, { headers: { "Accept-Language": "en" } });
      const list = await r.json();
      box.innerHTML = list.length ? "" : '<div style="font-size:.85rem;color:var(--medium-gray)">No places found. Try a nearby landmark, or drag the pin.</div>';
      list.forEach((p) => {
        const b = document.createElement("button"); b.type = "button";
        b.textContent = p.display_name;
        b.onclick = () => { box.innerHTML = ""; setPin(Number(p.lat), Number(p.lon), p.display_name.split(",").slice(0, 3).join(",").trim(), false); map.setView([Number(p.lat), Number(p.lon)], 17); };
        box.appendChild(b);
      });
    } catch (e) { box.innerHTML = '<div style="font-size:.85rem;color:#c62828">Search is not available right now. Drag the pin instead.</div>'; }
  }

  function say(html, kind) {
    const el = document.getElementById("shm-msg");
    if (!el) return;
    el.style.display = html ? "" : "none";
    el.style.background = kind === "error" ? "#fdecea" : "#e8f1fd";
    el.style.color = kind === "error" ? "#8a1c14" : "#0b2a5b";
    el.innerHTML = html || "";
  }
  const inApp = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  function deniedHelp() {
    return inApp()
      ? 'Location is blocked for the ServiceHub app. Open your phone <b>Settings → Apps → ServiceHub Kenya → Permissions → Location → Allow</b>, then tap <b>Use my current location</b> again. You can also search the place or drag the pin.'
      : 'Location is blocked for servicehub.co.ke. Tap the <b>lock / settings icon</b> next to the web address → <b>Permissions</b> (or Site settings) → <b>Location → Allow</b>, then try again. Make sure your phone\'s Location (GPS) is switched on. You can also search the place or drag the pin.';
  }

  async function gps() {
    if (!navigator.geolocation) { say("This device can't share its location. Search the place or drag the pin.", "error"); return; }
    try {
      if (navigator.permissions && !inApp()) {
        const st = await navigator.permissions.query({ name: "geolocation" });
        if (st.state === "denied") { say(deniedHelp(), "error"); return; }
      }
    } catch (e) {}
    const btn = document.getElementById("shm-gps");
    const reset = () => { btn.disabled = false; btn.innerHTML = '<i class="fas fa-location-crosshairs"></i> Use my current location'; };
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Finding you…';
    say("Getting your location… If your phone asks, tap <b>Allow</b>.");
    const ok = (pos) => {
      reset();
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      setPin(lat, lng, null, true, accuracy);
      map.setView([lat, lng], accuracy > 500 ? 15 : 17);
      say(accuracy > 150 ? `Pinned to within about ${Math.round(accuracy)} m. Drag the pin to the exact gate or building if needed.` : "Pinned at your current location. Drag the pin if it's slightly off.");
    };
    const fail = (err, tried) => {
      if (err && err.code === 1) { reset(); say(deniedHelp(), "error"); return; }
      if (!tried) {
        // GPS can be slow indoors: try again with network location
        navigator.geolocation.getCurrentPosition(ok, (e2) => fail(e2, true), { enableHighAccuracy: false, timeout: 20000, maximumAge: 120000 });
        return;
      }
      reset();
      say("Couldn't get your location. Switch on your phone's Location (GPS), move near a window, and try again. Or search the place / drag the pin.", "error");
    };
    navigator.geolocation.getCurrentPosition(ok, (e) => fail(e, false), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  /* Open the picker. opts: { location, county, title, onSave(location|null), allowRemove } */
  async function openPicker(opts = {}) {
    const m = modal();
    mode = "edit";
    m.querySelector("#shm-title").textContent = opts.title || "Pin the job location";
    m.querySelector("#shm-edit-tools").style.display = "";
    m.classList.add("active");
    let L;
    try { L = await ensureMap(); } catch (e) { notify("The map could not load. Check your internet connection.", "error"); close(); return; }
    onSave = opts.onSave;
    m.querySelector("#shm-gps").onclick = gps;
    m.querySelector("#shm-search").onclick = search;
    const q = m.querySelector("#shm-q"); q.value = ""; q.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } };
    m.querySelector("#shm-results").innerHTML = "";
    say("");
    if (marker) { marker.remove(); marker = null; } if (circle) { circle.remove(); circle = null; }
    current = null;
    if (opts.location && isFinite(opts.location.lat)) {
      setPin(opts.location.lat, opts.location.lng, opts.location.label, false);
      map.setView([opts.location.lat, opts.location.lng], 17);
    } else {
      const c = COUNTY_CENTRES[String(opts.county || "").toLowerCase()];
      map.setView(c || [KENYA.lat, KENYA.lng], c ? 12 : KENYA.zoom);
    }
    showLabel();
    const acts = m.querySelector("#shm-actions");
    acts.innerHTML = `${opts.allowRemove && opts.location ? '<button type="button" class="sh-btn danger" id="shm-remove"><i class="fas fa-trash"></i> Remove pin</button>' : ""}
      <button type="button" class="sh-btn ghost" id="shm-cancel">Cancel</button>
      <button type="button" class="sh-btn ok" id="shm-save"><i class="fas fa-check"></i> Save location</button>`;
    acts.querySelector("#shm-cancel").onclick = close;
    acts.querySelector("#shm-save").onclick = async () => {
      if (!current) { notify("Tap the map, search a place or use your current location to drop the pin.", "info"); return; }
      const ok = onSave ? await onSave({ ...current }) : true;
      if (ok !== false) close();
    };
    const rm = acts.querySelector("#shm-remove");
    if (rm) rm.onclick = async () => { const ok = onSave ? await onSave(null) : true; if (ok !== false) close(); };
  }

  /* Show a job's location. Exact pin → directions; approximate → area circle. */
  async function openViewer(job) {
    const loc = job && job.location;
    if (!loc) return;
    const m = modal();
    mode = "view";
    m.querySelector("#shm-title").textContent = loc.approximate ? "Approximate job area" : `Job location${job.title ? ": " + job.title : ""}`;
    m.querySelector("#shm-edit-tools").style.display = "none";
    m.classList.add("active");
    let L;
    try { L = await ensureMap(); } catch (e) { notify("The map could not load. Check your internet connection.", "error"); close(); return; }
    if (marker) { marker.remove(); marker = null; } if (circle) { circle.remove(); circle = null; }
    current = null;
    const acts = m.querySelector("#shm-actions");
    if (loc.approximate) {
      circle = L.circle([loc.lat, loc.lng], { radius: 1200, color: "#1f6feb", weight: 2, fillOpacity: 0.12 }).addTo(map);
      map.setView([loc.lat, loc.lng], 13);
      document.getElementById("shm-label").innerHTML = `<b>${esc([job.subcounty, job.county].filter(Boolean).join(", ") || "Job area")}</b><br><small>The client's exact pin is shared with the provider they hire.</small>`;
      acts.innerHTML = '<button type="button" class="sh-btn ghost" id="shm-cancel">Close</button>';
    } else {
      setPin(loc.lat, loc.lng, loc.label, false);
      map.setView([loc.lat, loc.lng], 16);
      const dest = `${loc.lat},${loc.lng}`;
      acts.innerHTML = `<button type="button" class="sh-btn ghost" id="shm-copy"><i class="far fa-copy"></i> Copy</button>
        <a class="sh-btn ghost" href="https://www.google.com/maps/search/?api=1&query=${dest}" target="_blank" rel="noopener"><i class="fas fa-map"></i> Open in Maps</a>
        <a class="sh-btn ok" href="https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving" target="_blank" rel="noopener"><i class="fas fa-route"></i> Get directions</a>`;
      acts.querySelector("#shm-copy").onclick = async () => {
        const text = `${loc.label ? loc.label + " - " : ""}https://maps.google.com/?q=${dest}`;
        try { await navigator.clipboard.writeText(text); notify("Location copied. Paste it in a message.", "success"); } catch (e) { prompt("Copy this location:", text); }
      };
    }
    const c = acts.querySelector("#shm-cancel"); if (c) c.onclick = close;
  }

  /* ── Hooks into the site ── */
  window.shPendingLocation = null;
  function renderPostPin() {
    const box = document.getElementById("sh-post-pin");
    if (!box) return;
    const l = window.shPendingLocation;
    box.innerHTML = `<div class="sh-pin-row">
      <button type="button" class="sh-btn ${l ? "ghost" : "pri"}" onclick="shPinForNewJob()"><i class="fas fa-map-marker-alt"></i> ${l ? "Change pin" : "Pin exact location on map"}</button>
      ${l ? `<button type="button" class="sh-btn ghost" onclick="shPendingLocation=null;shRenderPostPin()"><i class="fas fa-times"></i> Remove</button><small><i class="fas fa-check-circle" style="color:#2e7d32"></i> ${esc(l.label || `${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}`)}</small>`
        : '<small>Optional. Only the provider you hire sees the exact spot.</small>'}</div>`;
  }
  function injectPostPin() {
    if (document.getElementById("sh-post-pin")) return;
    const sub = document.getElementById("job-subcounty");
    const grid = sub && sub.closest(".form-group") && sub.closest(".form-group").parentElement;
    if (!grid) return;
    const g = document.createElement("div");
    g.className = "form-group";
    g.innerHTML = '<label class="form-label">Job location pin</label><div id="sh-post-pin"></div>';
    grid.parentNode.insertBefore(g, grid.nextSibling);
    renderPostPin();
  }
  window.shRenderPostPin = renderPostPin;
  window.shPinForNewJob = () => openPicker({
    location: window.shPendingLocation,
    county: (document.getElementById("job-county") || {}).value,
    title: "Pin where the job is",
    onSave: (loc) => { window.shPendingLocation = loc; renderPostPin(); return true; },
  });

  // From My Jobs: pin / change / remove on an existing job
  window.shPinJob = (jobId) => {
    const job = (typeof shMyJobs !== "undefined" ? shMyJobs : []).find((j) => j.id === jobId) || {};
    openPicker({
      location: job.location, county: job.county, title: `Pin the location: ${job.title || "job"}`, allowRemove: true,
      onSave: async (loc) => {
        const d = await shApi(`/jobs/${jobId}/location`, { method: "PUT", body: JSON.stringify({ location: loc }) }).catch(() => ({ success: false }));
        if (!d.success) { notify(d.message || "Could not save the location", "error"); return false; }
        notify(loc ? "Location pinned. Your hired provider can get directions." : "Location pin removed.", "success");
        try { loadMyJobs({ quiet: true }); } catch (e) {}
        return true;
      },
    });
  };
  window.shViewJobLocation = (jobId, from) => {
    const list = from === "assigned" ? (window.shAssignedJobs || []) : (typeof shMyJobs !== "undefined" ? shMyJobs : []);
    const job = list.find((j) => j.id === jobId) || (window.shDetailJob && window.shDetailJob.id === jobId ? window.shDetailJob : null);
    if (job) openViewer(job);
  };
  window.shOpenLocationPicker = openPicker;
  window.shOpenLocationViewer = openViewer;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", injectPostPin); else injectPostPin();
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
})();
