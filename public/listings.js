/* ServiceHub Kenya - service listings (Find Services: List your service · Services near me · All services)
   Providers (including the informal sector: fundis, mama mboga, boda boda, barbers, kiosks, cobblers ...)
   list the services they offer with a map pin, price and phone. Clients browse or search by service,
   find the ones nearest to them, then Call, WhatsApp or Message in the app. */
(function () {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const notify = (m, t) => { try { showNotification(m, t || "info"); } catch (e) {} };
  const $ = (id) => document.getElementById(id);
  const token = () => { try { return getToken(); } catch (e) { return null; } };
  const me = () => (typeof currentUser !== "undefined" && currentUser && currentUser.loggedIn ? currentUser : null);
  const kes = (n) => "KES " + Number(n || 0).toLocaleString("en-KE");
  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    if (token()) headers.Authorization = `Bearer ${token()}`;
    try {
      const res = await fetch(`${window.API_BASE || "/api"}${path}`, { ...opts, headers });
      return await res.json().catch(() => ({ success: false, message: `Server error (${res.status})` }));
    } catch (e) { return { success: false, message: "Cannot reach ServiceHub. Check your internet connection." }; }
  }

  /* ── Service types: everyday & informal first, then everything already on ServiceHub ── */
  const INFORMAL = [
    ["boda-boda", "Boda Boda Rides & Deliveries"], ["mama-mboga", "Mama Mboga & Fresh Produce"], ["food-kiosk", "Food Kiosk & Mama Lishe"],
    ["barber", "Barber Shop"], ["salon", "Salon & Hair Braiding"], ["shoe-repair", "Shoe Repair & Shoe Shining"],
    ["jua-kali", "Jua Kali & Metal Work"], ["tyre-repair", "Puncture & Tyre Repair"], ["car-wash", "Car Wash"],
    ["electronics-repair", "Radio, TV & Electronics Repair"], ["mitumba", "Mitumba & Second-hand Clothes"], ["hand-cart", "Mkokoteni & Hand-cart Transport"],
    ["water-vendor", "Water Vendor"], ["charcoal-firewood", "Charcoal & Firewood"], ["phone-charging", "Phone Charging & Accessories"],
    ["casual-labour", "Casual Labour (Kibarua)"], ["house-help", "House Help & Nanny"], ["watchman", "Watchman"],
  ];
  function countyOptions(first) {
    const src = $("county-filter");
    let html = src ? src.innerHTML : '<option value="all">All Counties</option>';
    if (first) html = html.replace(/<option value="all"[^>]*>[^<]*<\/option>/, `<option value="">${first}</option>`);
    return html;
  }
  /* ── Service-type filter: type to find the service you need / offer from the list of all services ── */
  const KEYWORDS = {
    plumbing: "fundi wa maji pipes taps leaking toilet sink", electrical: "stima wiring sockets electrician lights", mechanics: "garage car repair fundi wa gari engine",
    "boda-boda": "motorbike piki piki rider delivery transport", "mama-mboga": "vegetables sukuma fruits groceries market", "food-kiosk": "chapati chips food hotel lunch breakfast mandazi",
    barber: "haircut kinyozi shave", salon: "hair braiding plaiting weave nails", "shoe-repair": "cobbler shoes shoe shine", "jua-kali": "welding metal gates fundi",
    "tyre-repair": "puncture tyres wheels", "car-wash": "cleaning car wash", "electronics-repair": "tv radio phone fundi electronics", "casual-labour": "kibarua labourer mjengo",
    "house-help": "maid nanny housegirl domestic", watchman: "security guard askari", "water-vendor": "water maji", "hand-cart": "mkokoteni carry goods",
    "house-cleaning": "cleaner cleaning home", laundry: "washing clothes dhobi", catering: "food events cooking chef", "mobile-phone-repair": "phone screen fundi wa simu",
    carpentry: "furniture wood fundi wa mbao doors", masonry: "building construction mjengo fundi", "house-painting": "painter paint", tailoring: "fundi cherehani clothes sewing",
    "gas-delivery": "cooking gas lpg", "parcel-delivery": "courier deliveries", transport: "lorry pickup moving", movers: "moving house relocation", "car-hire": "rent car",
  };
  function categoryList() {
    const seen = new Set(INFORMAL.map((c) => c[0]));
    const src = $("category-filter");
    const more = src ? Array.from(src.options).filter((o) => o.value && o.value !== "all" && !seen.has(o.value)).map((o) => [o.value, o.textContent.trim()]) : [];
    return [...INFORMAL.map(([v, t]) => ({ v, t, g: "Everyday & informal services" })), ...more.map(([v, t]) => ({ v, t, g: "More services" }))]
      .map((c) => ({ ...c, k: `${c.t} ${c.v.replace(/-/g, " ")} ${KEYWORDS[c.v] || ""}`.toLowerCase() }));
  }
  const OTHER = { v: "other", t: "Other service", g: "", k: "other" };

  /* host: element to fill. opts: { mode: "browse"|"offer", placeholder, value:{v,t}|null, onPick(item|null), onText(text) } */
  function makePicker(host, opts) {
    host.className = "snp";
    host.innerHTML = `<i class="fas fa-search snp-ic"></i><input class="snp-in" type="text" enterkeyhint="search" autocomplete="off" placeholder="${esc(opts.placeholder)}" role="combobox" aria-expanded="false" aria-autocomplete="list">
      <button type="button" class="snp-x" aria-label="Clear">&times;</button><div class="snp-list" role="listbox"></div>`;
    const input = host.querySelector(".snp-in"), list = host.querySelector(".snp-list"), x = host.querySelector(".snp-x");
    const all = categoryList();
    const P = { picked: opts.value || null, rows: [], hi: -1 };
    const sync = () => { x.style.display = input.value ? "" : "none"; host.classList.toggle("picked", !!P.picked); };
    if (P.picked) input.value = P.picked.t;
    sync();

    function matches(q) {
      if (!q) return all;
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      return all.filter((c) => words.every((w) => c.k.includes(w)))
        .sort((a, b) => (b.t.toLowerCase().startsWith(words[0]) ? 1 : 0) - (a.t.toLowerCase().startsWith(words[0]) ? 1 : 0));
    }
    function render() {
      const q = P.picked && input.value === P.picked.t ? "" : input.value.trim();
      const found = matches(q);
      P.rows = [];
      let html = "";
      if (opts.mode === "browse") {
        if (q) { P.rows.push({ kw: q }); html += `<div class="snp-row snp-kw" data-i="0"><i class="fas fa-search"></i> Search all services for “${esc(q)}”</div>`; }
        else { P.rows.push({ v: "all", t: "All services" }); html += `<div class="snp-row" data-i="0"><i class="fas fa-th-large"></i> All services</div>`; }
      }
      let group = null;
      found.forEach((c) => {
        if (!q && c.g !== group) { group = c.g; html += `<div class="snp-group">${esc(group)}</div>`; }
        html += `<div class="snp-row ${P.picked && P.picked.v === c.v ? "on" : ""}" data-i="${P.rows.length}">${esc(c.t)}</div>`;
        P.rows.push(c);
      });
      if (q && !found.length) html += `<div class="snp-none">No service type matches “${esc(q)}”.</div>`;
      if (opts.mode === "offer") { html += `<div class="snp-row" data-i="${P.rows.length}"><i class="fas fa-ellipsis-h"></i> Other service</div>`; P.rows.push(OTHER); }
      list.innerHTML = html;
      P.hi = q ? 0 : -1; highlight();
    }
    function highlight() {
      list.querySelectorAll(".snp-row").forEach((r) => r.classList.toggle("hi", Number(r.dataset.i) === P.hi));
      const h = list.querySelector(".snp-row.hi"); if (h) h.scrollIntoView({ block: "nearest" });
    }
    const open = () => { render(); host.classList.add("open"); input.setAttribute("aria-expanded", "true"); };
    const close = () => { host.classList.remove("open"); input.setAttribute("aria-expanded", "false"); };
    function choose(row) {
      if (!row) return;
      if (row.kw != null) { P.picked = null; input.value = row.kw; close(); sync(); opts.onText && opts.onText(row.kw); return; }
      if (row.v === "all") { P.picked = null; input.value = ""; close(); sync(); opts.onPick && opts.onPick(null); return; }
      P.picked = { v: row.v, t: row.t }; input.value = row.t; close(); sync(); input.blur();
      opts.onPick && opts.onPick(P.picked);
    }
    input.addEventListener("focus", () => { input.select(); open(); });
    input.addEventListener("input", () => { if (P.picked && input.value !== P.picked.t) P.picked = null; sync(); open(); opts.onType && opts.onType(input.value.trim()); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); if (!host.classList.contains("open")) open(); P.hi = Math.min(P.rows.length - 1, P.hi + 1); highlight(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); P.hi = Math.max(0, P.hi - 1); highlight(); }
      else if (e.key === "Enter") { e.preventDefault(); if (host.classList.contains("open") && P.hi >= 0) choose(P.rows[P.hi]); else if (opts.mode === "browse") { close(); opts.onText && opts.onText(input.value.trim()); } }
      else if (e.key === "Escape") close();
    });
    list.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus while choosing
    list.addEventListener("click", (e) => { const r = e.target.closest(".snp-row"); if (r) choose(P.rows[Number(r.dataset.i)]); });
    x.addEventListener("click", () => { P.picked = null; input.value = ""; sync(); if (opts.mode === "browse") { close(); opts.onPick && opts.onPick(null); } else { input.focus(); } });
    document.addEventListener("click", (e) => { if (!host.contains(e.target)) close(); });
    return {
      get picked() { return P.picked; },
      get text() { return P.picked ? "" : input.value.trim(); },
      set(item) { P.picked = item; input.value = item ? item.t : ""; sync(); },
      // In the form: if what was typed is exactly a service name, accept it
      resolve() { if (P.picked) return P.picked; const t = input.value.trim().toLowerCase(); const m = all.find((c) => c.t.toLowerCase() === t); if (m) { P.picked = { v: m.v, t: m.t }; } return P.picked; },
    };
  }
  const subcounties = (county) => { try { return (subCountyMap && subCountyMap[county]) || []; } catch (e) { return []; } };

  /* ── Styles ── */
  const st = document.createElement("style");
  st.textContent = `
  .snm-tabs{display:flex;gap:6px;background:var(--white);border:1px solid var(--light-gray);border-radius:14px;padding:6px;margin-bottom:14px;overflow-x:auto}
  .snm-tabs button{flex:1;border:0;background:none;border-radius:10px;padding:11px 12px;font:inherit;font-weight:600;font-size:.92rem;color:var(--dark-gray);cursor:pointer;white-space:nowrap;display:flex;align-items:center;justify-content:center;gap:7px}
  .snm-tabs button.on{background:var(--primary);color:#fff}
  .snm-listpanel{background:var(--white);border:1px solid var(--light-gray);border-radius:14px;padding:20px;display:flex;gap:18px;align-items:flex-start}
  .snm-listpanel h3{margin:0 0 6px;color:var(--primary)}.snm-listpanel p{margin:0 0 14px;color:var(--medium-gray);line-height:1.5}
  .snm-listicon{width:64px;height:64px;border-radius:16px;background:#fff4e6;color:#f28a12;display:flex;align-items:center;justify-content:center;font-size:1.8rem;flex:none}
  .snm-divider{height:1px;background:var(--light-gray);margin:34px 0 30px}
  .snm-bar{background:var(--white);border:1px solid var(--light-gray);border-radius:14px;padding:14px;display:grid;grid-template-columns:2fr 1fr;gap:10px}
  .snm-bar .snm-loc{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .snm-bar input,.snm-bar select,.snm-form input,.snm-form select,.snm-form textarea{width:100%;padding:11px 12px;border:1.5px solid var(--light-gray);border-radius:10px;font:inherit;font-size:.92rem;background:var(--white);color:var(--dark)}
  .snm-chip{display:inline-flex;align-items:center;gap:6px;background:#e3f2fd;color:#0d47a1;border-radius:20px;padding:6px 10px;font-size:.82rem;font-weight:600;max-width:100%}
  .snm-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.snm-chip button{border:0;background:none;color:inherit;cursor:pointer;font-size:1rem;line-height:1}
  .snm-count{margin:14px 2px 10px;color:var(--medium-gray);font-size:.88rem}
  .snm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
  .snm-card{background:var(--white);border:1px solid var(--light-gray);border-radius:14px;overflow:hidden;cursor:pointer;display:flex;flex-direction:column;transition:transform .15s,box-shadow .15s}
  .snm-card:hover{transform:translateY(-2px);box-shadow:0 8px 22px rgba(0,0,0,.08)}
  .snm-ph{height:150px;background:linear-gradient(135deg,#1557d6,#0b3a9c);display:flex;align-items:center;justify-content:center;color:#fff;font-size:2.6rem;position:relative}
  .snm-ph img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .snm-dist{position:absolute;left:10px;bottom:10px;background:rgba(0,0,0,.65);color:#fff;font-size:.78rem;font-weight:700;padding:4px 9px;border-radius:20px;z-index:1}
  .snm-body{padding:12px 14px 14px;display:flex;flex-direction:column;gap:6px;flex:1}
  .snm-body h3{margin:0;font-size:1rem;line-height:1.3;color:var(--dark)}
  .snm-cat{font-size:.74rem;font-weight:700;color:#f28a12;text-transform:uppercase;letter-spacing:.3px}
  .snm-meta{font-size:.82rem;color:var(--medium-gray);display:flex;flex-direction:column;gap:3px}
  .snm-price{font-weight:700;color:var(--primary);font-size:.92rem;margin-top:auto}
  .snm-who{display:flex;align-items:center;gap:8px;font-size:.84rem;font-weight:600;color:var(--dark-gray)}
  .snm-badge{display:inline-block;background:#e8f5e9;color:#2e7d32;border-radius:6px;padding:2px 7px;font-size:.72rem;font-weight:700}
  .snp{position:relative}
  .snp .snp-ic{position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--medium-gray);pointer-events:none}
  .snp .snp-in{padding-left:38px!important;padding-right:36px!important}
  .snp.picked .snp-in{border-color:var(--primary);font-weight:600;color:var(--primary)}
  .snp .snp-x{position:absolute;right:8px;top:50%;transform:translateY(-50%);border:0;background:none;font-size:1.3rem;color:var(--medium-gray);cursor:pointer;line-height:1}
  .snp .snp-list{display:none;position:absolute;left:0;right:0;top:calc(100% + 4px);background:var(--white);border:1px solid var(--light-gray);border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.15);max-height:320px;overflow-y:auto;z-index:50;padding:6px}
  .snp.open .snp-list{display:block}
  .snp-row{padding:10px 12px;border-radius:8px;cursor:pointer;font-size:.92rem;color:var(--dark);display:flex;gap:8px;align-items:center}
  .snp-row:hover,.snp-row.hi{background:#e3f2fd;color:#0d47a1}.snp-row.on{font-weight:700;color:var(--primary)}
  .snp-kw{color:var(--primary);font-weight:600}
  .snp-group{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#f28a12;padding:10px 12px 4px}
  .snp-none{padding:10px 12px;color:var(--medium-gray);font-size:.88rem}
  body.dark-theme .snp-row:hover,body.dark-theme .snp-row.hi{background:#1e3a5f;color:#fff}
  .snm-empty{grid-column:1/-1;text-align:center;padding:40px 16px;color:var(--medium-gray);background:var(--white);border:1px dashed var(--light-gray);border-radius:14px}
  #snm-modal .modal-content,#snm-form-modal .modal-content{max-width:620px;width:100%;padding:0;max-height:calc(100dvh - 24px);display:flex;flex-direction:column}
  .snm-mh{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--light-gray)}
  .snm-mh h3{margin:0;flex:1;min-width:0;font-size:1.05rem}
  .snm-mb{padding:16px 18px;overflow-y:auto;flex:1}
  .snm-mf{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;padding:12px 18px;border-top:1px solid var(--light-gray)}
  .snm-photos{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;margin-bottom:12px}
  .snm-photos img{height:200px;max-width:88%;border-radius:10px;object-fit:cover;scroll-snap-align:start;flex:none}
  .snm-row{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--light-gray);font-size:.9rem}.snm-row i{width:18px;color:var(--primary);margin-top:3px}
  .snm-desc{white-space:pre-wrap;font-size:.93rem;line-height:1.5;margin:10px 0}
  .snm-map{height:200px;border-radius:10px;margin-top:12px;background:#eef3ff}
  .snm-contact{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;width:100%}
  .snm-contact .sh-btn{justify-content:center;padding:11px 12px;text-decoration:none}
  .sh-btn.wa{background:#25d366;color:#fff}
  .snm-form label{display:block;font-weight:600;font-size:.86rem;margin:12px 0 5px;color:var(--dark-gray)}
  .snm-form small{color:var(--medium-gray);font-size:.78rem}
  .snm-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .snm-check{display:flex;gap:8px;align-items:flex-start;font-weight:500!important}.snm-check input{width:auto!important;margin-top:3px}
  .snm-thumbs{display:flex;gap:8px;flex-wrap:wrap}.snm-thumb{position:relative;width:76px;height:76px;border-radius:9px;overflow:hidden;background:#eee}
  .snm-thumb img{width:100%;height:100%;object-fit:cover}.snm-thumb button{position:absolute;top:3px;right:3px;border:0;border-radius:50%;width:22px;height:22px;background:rgba(0,0,0,.65);color:#fff;cursor:pointer}
  .snm-add{width:76px;height:76px;border:1.5px dashed var(--light-gray);border-radius:9px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--medium-gray);font-size:1.3rem}
  .snm-mine{background:var(--white);border:1px solid var(--light-gray);border-radius:14px;padding:14px;margin-bottom:12px;display:flex;gap:12px;align-items:flex-start}
  .snm-mine .snm-ph{width:90px;height:90px;border-radius:10px;flex:none;font-size:1.6rem}
  .snm-mine h3{margin:0 0 4px;font-size:1rem}
  @media (max-width:720px){.snm-listpanel{flex-direction:column}.snm-tabs{overflow:visible;gap:4px;padding:4px}.snm-tabs button{flex:1 1 0;min-width:0;flex-direction:column;gap:3px;padding:8px 4px;font-size:.78rem;white-space:normal;text-align:center;line-height:1.2}.snm-tabs button i{font-size:1.05rem}.snm-bar{grid-template-columns:1fr}.snm-2{grid-template-columns:1fr}.snm-mine{flex-direction:column}.snm-mine .snm-ph{width:100%;height:140px}}`;
  document.head.appendChild(st);

  /* ── State ── */
  const S = { q: "", category: "all", county: "all", radiusKm: "", from: null, list: [], total: 0, loading: false };
  try { const saved = JSON.parse(localStorage.getItem("sh_near_loc") || "null"); if (saved && isFinite(saved.lat)) S.from = saved; } catch (e) {}
  const saveFrom = () => { try { S.from ? localStorage.setItem("sh_near_loc", JSON.stringify(S.from)) : localStorage.removeItem("sh_near_loc"); } catch (e) {} };

  /* ── Tabs at the top of Find Services: List your service · Services near me · All services ── */
  S.mode = "near";
  function buildSection() {
    if ($("snm-wrap")) return;
    const host = document.querySelector("#find-services .container");
    if (!host) return;
    const wrap = document.createElement("div");
    wrap.id = "snm-wrap";
    wrap.innerHTML = `
      <div class="snm-tabs" role="tablist">
        <button type="button" role="tab" data-mode="list"><i class="fas fa-plus-circle"></i> List your service</button>
        <button type="button" role="tab" data-mode="near"><i class="fas fa-map-marked-alt"></i> Services near me</button>
        <button type="button" role="tab" data-mode="all"><i class="fas fa-th-large"></i> All services</button>
      </div>
      <div id="snm-list-panel" class="snm-listpanel">
        <div class="snm-listicon"><i class="fas fa-store"></i></div>
        <div><h3>Offer your service on ServiceHub, free</h3>
          <p>Fundi, boda boda, barber, mama mboga, caterer, cleaner, tutor, kiosk or any other service: list what you do with your location, price and phone number. Clients near you will find you and call, WhatsApp or message you directly.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="sh-btn pri" onclick="shListService()"><i class="fas fa-plus"></i> List your service</button>
            <button class="sh-btn ghost" onclick="shMyServices()"><i class="fas fa-store"></i> My listed services</button></div></div>
      </div>
      <div id="snm-search-panel">
        <div class="snm-bar">
          <div id="snm-pick-type"></div>
          <select id="snm-county">${countyOptions()}</select>
          <div class="snm-loc">
            <span id="snm-loc-tools" style="display:contents">
              <button class="sh-btn ghost" type="button" id="snm-gps"><i class="fas fa-location-crosshairs"></i> Near me</button>
              <button class="sh-btn ghost" type="button" id="snm-pick"><i class="fas fa-map-pin"></i> Choose on map</button>
              <span id="snm-from"></span>
              <select id="snm-radius" style="width:auto;flex:none"><option value="">Any distance</option><option value="2">Within 2 km</option><option value="5">Within 5 km</option><option value="10">Within 10 km</option><option value="25">Within 25 km</option><option value="50">Within 50 km</option></select>
            </span>
            <button class="sh-btn pri" type="button" id="snm-go" style="margin-left:auto"><i class="fas fa-search"></i> Search</button>
          </div>
        </div>
        <div class="snm-count" id="snm-count"></div>
        <div class="snm-grid" id="snm-grid"></div>
      </div>
      <div class="snm-divider"></div>`;
    host.insertBefore(wrap, host.firstChild);

    wrap.querySelectorAll(".snm-tabs button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
    let t;
    S.picker = makePicker($("snm-pick-type"), {
      mode: "browse", placeholder: "Search a service, e.g. plumber, boda boda, salon",
      onPick: () => search(), onText: () => search(),
      onType: (txt) => { clearTimeout(t); if (!txt) t = setTimeout(search, 300); },
    });
    ["snm-county", "snm-radius"].forEach((id) => $(id).addEventListener("change", search));
    $("snm-go").onclick = search;
    $("snm-gps").onclick = useMyLocation;
    $("snm-pick").onclick = pickOnMap;
    setMode(S.mode, true);
  }

  function setMode(mode, quiet) {
    S.mode = mode;
    document.querySelectorAll("#snm-wrap .snm-tabs button").forEach((b) => { const on = b.dataset.mode === mode; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    $("snm-list-panel").style.display = mode === "list" ? "" : "none";
    $("snm-search-panel").style.display = mode === "list" ? "none" : "";
    $("snm-loc-tools").style.display = mode === "near" ? "contents" : "none";
    renderFrom();
    if (!quiet && mode !== "list") search();
  }

  function renderFrom() {
    const box = $("snm-from"); if (!box) return;
    box.innerHTML = S.from ? `<span class="snm-chip"><i class="fas fa-map-marker-alt"></i><span>Near: ${esc(S.from.label || `${S.from.lat.toFixed(4)}, ${S.from.lng.toFixed(4)}`)}</span><button type="button" aria-label="Clear location" onclick="shNearClear()">&times;</button></span>`
      : "";
    $("snm-radius").disabled = !S.from;
  }
  window.shNearClear = () => { S.from = null; saveFrom(); $("snm-radius").value = ""; renderFrom(); search(); };

  function useMyLocation() {
    if (!navigator.geolocation) { notify("This device can't share its location. Use Choose on map instead.", "error"); return; }
    const b = $("snm-gps"); b.disabled = true; b.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Finding you…';
    const done = () => { b.disabled = false; b.innerHTML = '<i class="fas fa-location-crosshairs"></i> Near me'; };
    const ok = (p) => { done(); S.from = { lat: p.coords.latitude, lng: p.coords.longitude, label: "My current location" }; saveFrom(); renderFrom(); search(); };
    const fail = (e, retried) => {
      if (e && e.code === 1) { done(); notify("Location is blocked. Allow location for ServiceHub in your phone or browser settings, or use Choose on map.", "error"); return; }
      if (!retried) { navigator.geolocation.getCurrentPosition(ok, (e2) => fail(e2, true), { enableHighAccuracy: false, timeout: 20000, maximumAge: 300000 }); return; }
      done(); notify("Couldn't get your location. Switch on Location (GPS) and try again, or use Choose on map.", "error");
    };
    navigator.geolocation.getCurrentPosition(ok, (e) => fail(e, false), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }
  function pickOnMap() {
    if (typeof window.shOpenLocationPicker !== "function") { notify("The map is still loading. Try again in a moment.", "info"); return; }
    window.shOpenLocationPicker({
      title: "Where do you need the service?", location: S.from, county: $("snm-county").value !== "all" ? $("snm-county").value : "",
      onSave: (loc) => { S.from = loc; saveFrom(); renderFrom(); search(); return true; },
    });
  }

  async function search() {
    if (!$("snm-grid") || S.mode === "list") return;
    const near = S.mode === "near";
    S.q = S.picker.text; S.category = S.picker.picked ? S.picker.picked.v : "all"; S.county = $("snm-county").value; S.radiusKm = near && S.from ? $("snm-radius").value : "";
    const grid = $("snm-grid");
    if (near && !S.from) {
      $("snm-count").textContent = "";
      grid.innerHTML = `<div class="snm-empty"><i class="fas fa-map-marker-alt" style="font-size:2rem;margin-bottom:10px;display:block;color:#e53935"></i>Where are you? Tap <b>Near me</b> or <b>Choose on map</b> above to see the providers closest to you.</div>`;
      return;
    }
    const p = new URLSearchParams();
    if (S.q) p.set("q", S.q);
    if (S.category !== "all") p.set("category", S.category);
    if (S.county !== "all") p.set("county", S.county);
    if (near) { p.set("lat", S.from.lat); p.set("lng", S.from.lng); if (S.radiusKm) p.set("radiusKm", S.radiusKm); }
    grid.innerHTML = '<div class="snm-empty"><i class="fas fa-spinner fa-spin"></i> Finding services…</div>';
    const d = await api(`/listings?${p}`);
    if (!d.success) { grid.innerHTML = `<div class="snm-empty">${esc(d.message || "Could not load services")} <button class="sh-btn ghost" onclick="shNearSearch()">Try again</button></div>`; $("snm-count").textContent = ""; return; }
    S.list = d.listings || []; S.total = d.total || 0;
    $("snm-count").textContent = S.total ? `${S.total} service${S.total > 1 ? "s" : ""} found${near ? ", nearest first" : ", newest first"}` : "";
    grid.innerHTML = S.list.length ? S.list.map(card).join("")
      : `<div class="snm-empty"><i class="fas fa-search" style="font-size:2rem;margin-bottom:10px;display:block"></i>No services match yet${S.radiusKm ? ` within ${S.radiusKm} km` : ""}.<br>Try another word${near ? ", a wider distance" : ""} or all service types.<br><br>
         <button class="sh-btn pri" onclick="shListService()"><i class="fas fa-plus"></i> Offer this service? List it free</button></div>`;
  }
  window.shNearSearch = search;

  const priceText = (l) => (l.priceFrom != null && l.priceUnit !== "negotiable" ? `From ${kes(l.priceFrom)} <small style="font-weight:500">${esc(l.priceUnit)}</small>` : l.priceFrom != null ? `From ${kes(l.priceFrom)} <small style="font-weight:500">(negotiable)</small>` : "Price: negotiable");
  const distText = (km) => (km == null ? "" : km < 1 ? `${Math.max(50, Math.round(km * 1000 / 50) * 50)} m away` : `${km.toLocaleString("en-KE")} km away`);
  const placeText = (l) => [l.area, l.subcounty, l.county ? l.county.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : ""].filter(Boolean).join(", ");
  const photoUrl = (l, pid) => `${window.API_BASE || "/api"}/listings/${l.id}/photos/${pid}`;
  const avatar = (l, size) => (typeof window.shAvatarHTML === "function" ? window.shAvatarHTML(l.providerId, l.providerName, size) : "");

  function card(l) {
    return `<div class="snm-card" role="button" tabindex="0" onclick="shOpenListing('${l.id}')" onkeydown="if(event.key==='Enter')shOpenListing('${l.id}')">
      <div class="snm-ph"><i class="fas fa-tools"></i>${l.photos && l.photos.length ? `<img src="${photoUrl(l, l.photos[0])}" alt="" loading="lazy" onerror="this.remove()">` : ""}${l.distanceKm != null ? `<span class="snm-dist"><i class="fas fa-location-arrow"></i> ${distText(l.distanceKm)}</span>` : ""}</div>
      <div class="snm-body"><div class="snm-cat">${esc(l.categoryLabel)}</div><h3>${esc(l.title)}</h3>
        <div class="snm-who">${avatar(l, 26)} ${esc(l.providerName)}</div>
        <div class="snm-meta">${placeText(l) ? `<span><i class="fas fa-map-marker-alt"></i> ${esc(placeText(l))}</span>` : ""}${l.mobile ? '<span><span class="snm-badge"><i class="fas fa-motorcycle"></i> Comes to you</span></span>' : ""}</div>
        <div class="snm-price">${priceText(l)}</div></div></div>`;
  }

  /* ── Details + contact ── */
  function modalEl(id) {
    let m = $(id);
    if (!m) { m = document.createElement("div"); m.className = "modal"; m.id = id; m.innerHTML = '<div class="modal-content"></div>'; document.body.appendChild(m);
      m.addEventListener("click", (e) => { if (e.target === m) m.classList.remove("active"); }); }
    return m;
  }
  let leaflet = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leaflet) return leaflet;
    leaflet = new Promise((ok, bad) => {
      const c = document.createElement("link"); c.rel = "stylesheet"; c.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; document.head.appendChild(c);
      const s = document.createElement("script"); s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"; s.onload = () => ok(window.L); s.onerror = () => { leaflet = null; bad(); }; document.head.appendChild(s);
    });
    return leaflet;
  }
  let detailMap = null;

  window.shOpenListing = async (id) => {
    const m = modalEl("snm-modal"); const box = m.querySelector(".modal-content");
    box.innerHTML = '<div class="snm-mb" style="text-align:center;padding:40px"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';
    m.classList.add("active");
    const q = S.from ? `?lat=${S.from.lat}&lng=${S.from.lng}` : "";
    const d = await api(`/listings/${id}${q}`);
    if (!d.success) { box.innerHTML = `<div class="snm-mb">${esc(d.message || "Could not load this service")}</div><div class="snm-mf"><button class="sh-btn ghost" onclick="this.closest('.modal').classList.remove('active')">Close</button></div>`; return; }
    const l = d.listing; const user = me(); const mine = user && user.uid === l.providerId;
    const loc = l.location;
    const dest = loc ? `${loc.lat},${loc.lng}` : "";
    const waText = encodeURIComponent(`Hello ${l.providerName}, I found your service "${l.title}" on ServiceHub Kenya (servicehub.co.ke). `);
    let contact;
    if (mine) contact = `<button class="sh-btn ghost" onclick="shEditListing('${l.id}')"><i class="fas fa-pen"></i> Edit my service</button>`;
    else if (!user) contact = `<div style="width:100%"><p style="margin:0 0 8px;font-size:.88rem;color:var(--medium-gray)"><i class="fas fa-lock"></i> Sign in (free) to see the phone number and contact ${esc(l.providerName)}.</p>
        <button class="sh-btn pri" style="width:100%;justify-content:center" onclick="document.getElementById('snm-modal').classList.remove('active');showSection('auth')"><i class="fas fa-sign-in-alt"></i> Sign in to contact</button></div>`;
    else contact = `<div class="snm-contact">
        <a class="sh-btn ok" href="tel:+${esc(l.phone)}" onclick="shListingContact('${l.id}')"><i class="fas fa-phone"></i> Call</a>
        ${l.whatsapp ? `<a class="sh-btn wa" href="https://wa.me/${esc(l.phone)}?text=${waText}" target="_blank" rel="noopener" onclick="shListingContact('${l.id}')"><i class="fab fa-whatsapp"></i> WhatsApp</a>` : ""}
        <button class="sh-btn pri" onclick="shMessageListing('${l.id}','${l.providerId}')"><i class="fas fa-comments"></i> Message</button>
        ${loc && !loc.approximate ? `<a class="sh-btn ghost" href="https://www.google.com/maps/dir/?api=1&destination=${dest}" target="_blank" rel="noopener"><i class="fas fa-route"></i> Directions</a>` : ""}</div>`;
    box.innerHTML = `<div class="snm-mh">${avatar(l, 40)}<h3>${esc(l.title)}<br><small style="font-weight:500;color:var(--medium-gray)">${esc(l.providerName)} · ${esc(l.categoryLabel)}</small></h3>
        <button class="modal-close" type="button" aria-label="Close" onclick="this.closest('.modal').classList.remove('active')">&times;</button></div>
      <div class="snm-mb">
        ${l.photos && l.photos.length ? `<div class="snm-photos">${l.photos.map((p) => `<img src="${photoUrl(l, p)}" alt="" loading="lazy">`).join("")}</div>` : ""}
        <div class="snm-row"><i class="fas fa-tag"></i><div><b>${priceText(l)}</b></div></div>
        ${l.distanceKm != null ? `<div class="snm-row"><i class="fas fa-location-arrow"></i><div>${distText(l.distanceKm)}${loc && loc.approximate ? " (approximately)" : ""}</div></div>` : ""}
        <div class="snm-row"><i class="fas fa-map-marker-alt"></i><div>${esc(placeText(l) || (loc && loc.label) || "Location on map")}${loc && loc.label && !loc.approximate && loc.label !== placeText(l) ? `<br><small style="color:var(--medium-gray)">${esc(loc.label)}</small>` : ""}</div></div>
        ${l.mobile ? `<div class="snm-row"><i class="fas fa-motorcycle"></i><div>Comes to you${l.serviceRadiusKm ? ` within about ${l.serviceRadiusKm} km` : ""}</div></div>` : ""}
        ${l.availability ? `<div class="snm-row"><i class="far fa-clock"></i><div>${esc(l.availability)}</div></div>` : ""}
        ${user && l.phone && !mine ? `<div class="snm-row"><i class="fas fa-phone"></i><div>+${esc(l.phone)}</div></div>` : ""}
        <div class="snm-desc">${esc(l.description)}</div>
        ${loc ? '<div class="snm-map" id="snm-map"></div>' : ""}
        <p style="font-size:.78rem;color:var(--medium-gray);margin:10px 0 0"><i class="fas fa-info-circle"></i> ServiceHub is free. Agree on the price with the provider and pay them directly. Meet in safe places and check the work before paying.</p>
      </div>
      <div class="snm-mf">${contact}</div>`;
    if (loc) {
      try {
        const L = await loadLeaflet();
        if (detailMap) { detailMap.remove(); detailMap = null; }
        detailMap = L.map("snm-map", { zoomControl: true, attributionControl: true }).setView([loc.lat, loc.lng], loc.approximate ? 14 : 16);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(detailMap);
        if (loc.approximate) L.circle([loc.lat, loc.lng], { radius: 1000, color: "#1557d6", weight: 2, fillOpacity: 0.12 }).addTo(detailMap);
        else L.marker([loc.lat, loc.lng]).addTo(detailMap);
        if (S.from && !mine) L.circleMarker([S.from.lat, S.from.lng], { radius: 7, color: "#fff", weight: 2, fillColor: "#e53935", fillOpacity: 1 }).addTo(detailMap).bindTooltip("You");
        setTimeout(() => detailMap && detailMap.invalidateSize(), 250);
      } catch (e) { const el = $("snm-map"); if (el) el.remove(); }
    }
  };
  window.shListingContact = (id) => { api(`/listings/${id}/contact`, { method: "POST" }); };
  window.shMessageListing = (id, providerId) => {
    shListingContact(id);
    const m = $("snm-modal"); if (m) m.classList.remove("active");
    const u = $("new-chat-uid"), j = $("new-chat-jobid");
    if (u && j && typeof handleStartConversation === "function") { u.value = providerId; j.value = ""; showSection("chat"); handleStartConversation(); }
    else notify("Messages are not available right now. Please call instead.", "error");
  };

  /* ── Provider: list / edit a service ── */
  const F = { id: null, location: null, photos: [], removed: [] }; // photos: [{pid}|{dataUrl}]
  function shrink(file, max = 1000) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) return reject(new Error("Not an image"));
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        let q = 0.82, out = c.toDataURL("image/jpeg", q);
        while (out.length > 650000 && q > 0.4) { q -= 0.1; out = c.toDataURL("image/jpeg", q); }
        resolve(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read the photo")); };
      img.src = url;
    });
  }

  function requireSignIn(msg) {
    if (me() && token()) return true;
    notify(msg || "Sign in or create a free account first.", "info");
    try { showSection("auth"); } catch (e) {}
    return false;
  }

  window.shListService = () => { if (!requireSignIn("Create a free account or sign in, then list your service.")) return; openForm(null); };
  window.shEditListing = async (id) => {
    if (!requireSignIn()) return;
    const dm = $("snm-modal"); if (dm) dm.classList.remove("active");
    const d = await api(`/listings/${id}`);
    if (!d.success) { notify(d.message || "Could not load the service", "error"); return; }
    openForm(d.listing);
  };

  function openForm(l) {
    const m = modalEl("snm-form-modal"); const box = m.querySelector(".modal-content");
    const u = me() || {};
    F.id = l ? l.id : null; F.location = l && l.location ? { lat: l.location.lat, lng: l.location.lng, label: l.location.label } : null;
    F.photos = l ? (l.photos || []).map((pid) => ({ pid })) : []; F.removed = [];
    F.listing = l;
    box.innerHTML = `<div class="snm-mh"><h3><i class="fas fa-store" style="color:var(--primary)"></i> ${l ? "Edit your service" : "List your service"}</h3>
        <button class="modal-close" type="button" aria-label="Close" onclick="this.closest('.modal').classList.remove('active')">&times;</button></div>
      <div class="snm-mb snm-form">
        <small>It's free. Clients near you will find you, then call, WhatsApp or message you.</small>
        <label>What service do you offer?</label><div id="snf-cat"></div>
        <label>Name of your service</label><input id="snf-title" maxlength="80" placeholder="e.g. Shoe repair at Kondele stage, Boda boda in Ruiru">
        <label>Describe what you do</label><textarea id="snf-desc" rows="4" maxlength="1000" placeholder="What you offer, your experience, what makes you good…"></textarea>
        <div class="snm-2"><div><label>Starting price (KES)</label><input id="snf-price" type="number" min="0" inputmode="numeric" placeholder="e.g. 200 (optional)"></div>
          <div><label>Price is</label><select id="snf-unit"><option>per job</option><option>per hour</option><option>per day</option><option>per item</option><option>per trip</option><option>per km</option><option>per kg</option><option>per month</option><option value="negotiable">negotiable</option></select></div></div>
        <label>Phone number clients should call</label><input id="snf-phone" type="tel" inputmode="tel" placeholder="0712 345 678">
        <label class="snm-check"><input type="checkbox" id="snf-wa" checked> Clients can also reach me on WhatsApp on this number</label>
        <label>Where do you work? Pin it on the map</label>
        <div id="snf-pin"></div>
        <label class="snm-check"><input type="checkbox" id="snf-exact" checked> Show my exact spot to clients <small>(untick if the pin is your home: clients will see only the area, about 1 km)</small></label>
        <div class="snm-2"><div><label>County</label><select id="snf-county">${countyOptions("Choose county…")}</select></div>
          <div><label>Sub-county / town</label><select id="snf-sub"><option value="">Choose…</option></select></div></div>
        <label>Landmark or area <small>(e.g. "Opposite Kondele market", "Stage ya Juja")</small></label><input id="snf-area" maxlength="120">
        <label class="snm-check"><input type="checkbox" id="snf-mobile"> I can go to the client</label>
        <div id="snf-radius-box" style="display:none"><label>How far can you go? (km)</label><input id="snf-radius" type="number" min="1" max="200" value="10"></div>
        <label>When are you available? <small>(optional)</small></label><input id="snf-avail" maxlength="120" placeholder="e.g. Mon–Sat, 7am – 7pm">
        <label>Photos of your work <small>(up to 4, optional)</small></label><div class="snm-thumbs" id="snf-photos"></div>
      </div>
      <div class="snm-mf">${l ? `<button class="sh-btn danger" type="button" onclick="shDeleteListing('${l.id}')"><i class="fas fa-trash"></i> Delete</button>` : ""}
        <button class="sh-btn ghost" type="button" onclick="this.closest('.modal').classList.remove('active')">Cancel</button>
        <button class="sh-btn pri" type="button" id="snf-save"><i class="fas fa-check"></i> ${l ? "Save changes" : "Publish my service"}</button></div>`;
    const v = (id) => $(id);
    v("snf-county").onchange = () => fillSubs("");
    v("snf-mobile").onchange = () => { v("snf-radius-box").style.display = v("snf-mobile").checked ? "" : "none"; };
    v("snf-save").onclick = save;
    F.picker = makePicker(v("snf-cat"), { mode: "offer", placeholder: "Type your service, e.g. barber, plumber, boda boda", value: l ? { v: l.category, t: l.categoryLabel } : null });
    if (l) {
      v("snf-title").value = l.title; v("snf-desc").value = l.description;
      v("snf-price").value = l.priceFrom != null ? l.priceFrom : ""; v("snf-unit").value = l.priceUnit || "negotiable";
      v("snf-phone").value = l.phone ? "0" + String(l.phone).replace(/^254/, "") : ""; v("snf-wa").checked = !!l.whatsapp;
      v("snf-exact").checked = l.showExact !== false; v("snf-county").value = l.county || ""; fillSubs(l.subcounty || "");
      v("snf-area").value = l.area || ""; v("snf-mobile").checked = !!l.mobile; v("snf-radius").value = l.serviceRadiusKm || 10;
      v("snf-radius-box").style.display = l.mobile ? "" : "none"; v("snf-avail").value = l.availability || "";
    } else {
      v("snf-phone").value = u.phone || "";
      if (u.county) { v("snf-county").value = String(u.county).toLowerCase(); fillSubs(u.subcounty || ""); }
    }
    renderPin(); renderPhotos();
    m.classList.add("active");
  }
  function fillSubs(selected) {
    const c = $("snf-county").value;
    $("snf-sub").innerHTML = '<option value="">Choose…</option>' + subcounties(c).map((s) => `<option ${s === selected ? "selected" : ""}>${esc(s)}</option>`).join("")
      + (selected && !subcounties(c).includes(selected) ? `<option selected>${esc(selected)}</option>` : "");
  }
  function renderPin() {
    const box = $("snf-pin"); if (!box) return;
    const l = F.location;
    box.innerHTML = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button type="button" class="sh-btn ${l ? "ghost" : "pri"}" onclick="shListingPin()"><i class="fas fa-map-marker-alt"></i> ${l ? "Change pin" : "Pin my work place"}</button>
      ${l ? `<small><i class="fas fa-check-circle" style="color:#2e7d32"></i> ${esc(l.label || `${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}`)}</small>` : "<small>Required, so clients near you find you first. Use your current location if you're there now.</small>"}</div>`;
  }
  window.shListingPin = () => {
    if (typeof window.shOpenLocationPicker !== "function") { notify("The map is still loading. Try again in a moment.", "info"); return; }
    window.shOpenLocationPicker({ title: "Pin where you work", location: F.location, county: $("snf-county").value,
      onSave: (loc) => { F.location = loc; renderPin(); return true; } });
  };
  function renderPhotos() {
    const box = $("snf-photos"); if (!box) return;
    box.innerHTML = F.photos.map((p, i) => `<div class="snm-thumb"><img src="${p.dataUrl || photoUrl(F.listing || { id: F.id }, p.pid)}" alt=""><button type="button" aria-label="Remove photo" onclick="shListingRmPhoto(${i})">&times;</button></div>`).join("")
      + (F.photos.length < 4 ? '<label class="snm-add" title="Add photos"><input type="file" accept="image/*" multiple hidden onchange="shListingAddPhotos(this)"><i class="fas fa-camera"></i></label>' : "");
  }
  window.shListingRmPhoto = (i) => { const p = F.photos.splice(i, 1)[0]; if (p && p.pid) F.removed.push(p.pid); renderPhotos(); };
  window.shListingAddPhotos = async (input) => {
    const files = Array.from(input.files || []).slice(0, 4 - F.photos.length);
    for (const f of files) { try { F.photos.push({ dataUrl: await shrink(f) }); } catch (e) { notify("One photo could not be read. Try a JPG or PNG.", "error"); } }
    renderPhotos();
  };

  async function save() {
    const v = (id) => $(id);
    const cat = F.picker.resolve();
    const body = {
      category: cat ? cat.v : "", categoryLabel: cat ? cat.t : "",
      title: v("snf-title").value, description: v("snf-desc").value,
      priceFrom: v("snf-price").value, priceUnit: v("snf-unit").value,
      phone: v("snf-phone").value, whatsapp: v("snf-wa").checked,
      location: F.location, showExact: v("snf-exact").checked,
      county: v("snf-county").value, subcounty: v("snf-sub").value, area: v("snf-area").value,
      mobile: v("snf-mobile").checked, serviceRadiusKm: v("snf-mobile").checked ? v("snf-radius").value : null, availability: v("snf-avail").value,
    };
    if (!body.category) { notify("Type your service and choose it from the list (or choose Other service)", "error"); return; }
    if (!body.location) { notify("Pin where you work on the map so clients near you can find you", "error"); return; }
    if (!body.county) { notify("Choose your county", "error"); return; }
    const btn = v("snf-save"); btn.disabled = true; const old = btn.innerHTML; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
    const d = await api(F.id ? `/listings/${F.id}` : "/listings", { method: F.id ? "PUT" : "POST", body: JSON.stringify(body) });
    if (!d.success) { btn.disabled = false; btn.innerHTML = old; notify(d.message || "Could not save. Please try again.", "error"); return; }
    const id = d.listing.id;
    // Account is now also a service provider: refresh the session quietly (keeps Hiring/Working mode)
    if (d.token && d.user) { try { setToken(d.token); currentUser = { ...d.user, loggedIn: true }; window.currentUser = currentUser; updateAuthUI(); } catch (e) {} }
    let photoFail = 0;
    for (const pid of F.removed) { const r = await api(`/listings/${id}/photos/${pid}`, { method: "DELETE" }); if (!r.success) photoFail++; }
    for (const p of F.photos.filter((x) => x.dataUrl)) { const r = await api(`/listings/${id}/photos`, { method: "POST", body: JSON.stringify({ image: p.dataUrl }) }); if (!r.success) photoFail++; }
    btn.disabled = false; btn.innerHTML = old;
    $("snm-form-modal").classList.remove("active");
    notify(photoFail ? "Service saved, but some photos didn't upload. Edit the service to try again." : F.id ? "Your service is updated." : "Your service is live! Clients near you can now find and contact you.", photoFail ? "info" : "success");
    if ($("find-services") && $("find-services").classList.contains("active")) search();
    if ($("dashboard") && $("dashboard").classList.contains("active")) myServices();
  }

  window.shDeleteListing = async (id) => {
    if (!confirm("Delete this service? Clients will no longer find it.")) return;
    const d = await api(`/listings/${id}`, { method: "DELETE" });
    if (!d.success) { notify(d.message || "Could not delete", "error"); return; }
    const fm = $("snm-form-modal"); if (fm) fm.classList.remove("active");
    notify("Service deleted.", "info");
    if ($("dashboard") && $("dashboard").classList.contains("active")) myServices();
  };
  window.shToggleListing = async (id, status) => {
    const d = await api(`/listings/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
    if (!d.success) { notify(d.message || "Could not update", "error"); return; }
    notify(status === "paused" ? "Service paused: clients won't see it until you resume." : "Service is visible to clients again.", "success");
    myServices();
  };

  /* ── Dashboard: My Services ── */
  async function myServices() {
    if (!requireSignIn()) return;
    if (!$("dashboard").classList.contains("active")) showSection("dashboard");
    const panel = typeof shPanel === "function" ? shPanel() : $("dash-panel");
    panel.innerHTML = '<div class="sh-loading"><i class="fas fa-spinner fa-spin"></i> Loading your services…</div>';
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
    const d = await api("/listings/mine");
    if (!d.success) { panel.innerHTML = `<div class="sh-loading">${esc(d.message || "Could not load your services")} <button class="sh-btn ghost" onclick="shMyServices()">Try again</button></div>`; return; }
    const list = d.listings || [];
    panel.innerHTML = `<div class="sh-panel-head"><h2><i class="fas fa-store" style="color:var(--primary)"></i> My Services</h2>
        <button class="sh-btn pri" onclick="shListService()"><i class="fas fa-plus"></i> List a service</button></div>
      <p style="color:var(--medium-gray);font-size:.9rem;margin:0 0 14px">Services you list appear in <b>Find Services</b>. Clients nearby call, WhatsApp or message you directly.</p>
      ${list.length ? list.map((l) => `<div class="snm-mine">
          <div class="snm-ph"><i class="fas fa-tools"></i>${l.photos && l.photos.length ? `<img src="${photoUrl(l, l.photos[0])}" alt="" onerror="this.remove()">` : ""}</div>
          <div style="flex:1;min-width:0"><div class="snm-cat">${esc(l.categoryLabel)}</div><h3>${esc(l.title)}</h3>
            <div class="snm-meta"><span>${l.status === "active" ? '<span class="snm-badge">Live</span>' : '<span class="snm-badge" style="background:#eee;color:#616161">Paused</span>'} · ${priceText(l)}</span>
              <span><i class="far fa-eye"></i> ${l.views || 0} views · <i class="fas fa-phone"></i> ${l.contacts || 0} contacts</span></div>
            <div class="sh-actions" style="margin-top:10px;padding:0">
              <button class="sh-btn ghost" onclick="shEditListing('${l.id}')"><i class="fas fa-pen"></i> Edit</button>
              <button class="sh-btn ghost" onclick="shOpenListing('${l.id}')"><i class="far fa-eye"></i> View</button>
              ${l.status === "active" ? `<button class="sh-btn ghost" onclick="shToggleListing('${l.id}','paused')"><i class="fas fa-pause"></i> Pause</button>` : `<button class="sh-btn ok" onclick="shToggleListing('${l.id}','active')"><i class="fas fa-play"></i> Resume</button>`}
              <button class="sh-btn danger" onclick="shDeleteListing('${l.id}')"><i class="fas fa-trash"></i> Delete</button></div></div></div>`).join("")
        : `<div class="sh-job"><div class="sh-loading">You haven't listed any services yet. List what you do (repairs, boda boda, salon, food, anything) so clients near you can find you.<br><br>
            <button class="sh-btn pri" onclick="shListService()"><i class="fas fa-plus"></i> List your first service</button></div></div>`}`;
  }
  window.shMyServices = myServices;

  /* ── Hook into the site (after the main page has set itself up) ── */
  function install() {
    buildSection();
    // Dashboard card
    const acts = document.querySelector("#dashboard .dashboard-actions");
    if (acts && !$("my-services-action")) {
      const c = document.createElement("div");
      c.className = "action-card"; c.id = "my-services-action";
      c.innerHTML = '<div class="action-icon"><i class="fas fa-store"></i></div><h3 class="action-title">My Services</h3><p class="action-description">List what you offer so clients near you can find and contact you</p>';
      c.addEventListener("click", myServices);
      acts.appendChild(c);
    }
    // Load results whenever the page opens, and keep the nav link highlighted
    const orig = window.showSection;
    if (typeof orig === "function" && !orig.__snm) {
      const wrapped = function (id) {
        const r = orig.apply(this, arguments);
        if (id === "find-services") setTimeout(search, 50);
        return r;
      };
      wrapped.__snm = true;
      window.showSection = wrapped;
      try { showSection = wrapped; } catch (e) {}
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
})();
