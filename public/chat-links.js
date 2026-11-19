/* ServiceHub Kenya - more ways to talk in Messages
   When a client and a service provider are in a conversation, besides the in-app chat and calls
   they can continue on WhatsApp or on Relay (our own messaging platform), using the phone number
   each one gave when registering. The number is only shared between the two people in the chat. */
(function () {
  "use strict";
  // Relay: if Relay gets a link that opens a chat with a number, put it here with {phone} (digits, e.g. 2547XXXXXXXX)
  const RELAY_CHAT_URL = "https://web.relaymessaging.net/";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const notify = (m, t) => { try { showNotification(m, t || "info"); } catch (e) {} };
  const cache = {};

  const st = document.createElement("style");
  st.textContent = `
  #shx-bar{display:none;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid var(--light-gray);background:var(--light);font-size:.84rem}
  #shx-bar.on{display:flex}
  #shx-bar .shx-t{color:var(--medium-gray);margin-right:2px}
  #shx-bar a,#shx-bar button{display:inline-flex;align-items:center;gap:6px;border:0;border-radius:20px;padding:7px 13px;font:inherit;font-weight:600;font-size:.82rem;cursor:pointer;text-decoration:none;line-height:1}
  .shx-wa{background:#25d366;color:#fff}
  .shx-relay{background:linear-gradient(135deg,#17a2cf,#0c7aa3);color:#fff}
  .shx-relay img{width:18px;height:18px;border-radius:5px;box-shadow:0 0 0 1.5px rgba(255,255,255,.85)}
  #shx-bar .shx-none{color:var(--medium-gray)}`;
  document.head.appendChild(st);

  function bar() {
    let b = $("shx-bar");
    if (!b) {
      const head = document.querySelector("#chat .chat-header");
      if (!head) return null;
      b = document.createElement("div"); b.id = "shx-bar";
      head.parentNode.insertBefore(b, head.nextSibling);
    }
    return b;
  }

  async function contactFor(convId) {
    if (cache[convId]) return cache[convId];
    try {
      const res = await fetch(`${window.API_BASE || "/api"}/chat/conversations/${encodeURIComponent(convId)}/contact`, { headers: { Authorization: `Bearer ${getToken()}` } });
      const d = await res.json();
      if (d.success) { cache[convId] = d.contact; return d.contact; }
    } catch (e) {}
    return null;
  }

  async function show(convId) {
    const b = bar(); if (!b) return;
    b.classList.remove("on"); b.innerHTML = "";
    if (!convId) return;
    const c = await contactFor(convId);
    if (($("active-conversation-id") || {}).value !== convId) return; // another chat was opened meanwhile
    if (!c) return;
    const first = String(c.name || "").split(" ")[0] || "them";
    if (!c.phone) {
      b.innerHTML = `<span class="shx-none"><i class="fas fa-info-circle"></i> ${esc(first)} has no phone number on ServiceHub, so use the chat and calls here.</span>`;
      b.classList.add("on");
      return;
    }
    let me = ""; try { me = (typeof currentUser !== "undefined" && currentUser && currentUser.loggedIn ? currentUser.name : "") || ""; } catch (e) {}
    const text = encodeURIComponent(me ? `Hello ${first}, this is ${me} from ServiceHub Kenya.` : `Hello ${first}, I found you on ServiceHub Kenya.`);
    b.innerHTML = `<span class="shx-t">Also talk to ${esc(first)} on:</span>
      <a class="shx-wa" href="https://wa.me/${esc(c.phone)}?text=${text}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> WhatsApp</a>
      <button type="button" class="shx-relay" onclick="shOpenRelay('${esc(convId)}')"><img src="/icons/relay.png" alt=""> Relay</button>`;
    b.classList.add("on");
  }

  window.shOpenRelay = async (convId) => {
    const c = await contactFor(convId);
    if (!c || !c.phone) { notify("This person has no phone number on ServiceHub.", "info"); return; }
    const number = "+" + c.phone;
    if (RELAY_CHAT_URL.includes("{phone}")) { window.open(RELAY_CHAT_URL.replace("{phone}", c.phone), "_blank", "noopener"); return; }
    let copied = false;
    try { await navigator.clipboard.writeText(number); copied = true; } catch (e) {}
    window.open(RELAY_CHAT_URL, "_blank", "noopener");
    notify(copied ? `${number} copied. In Relay, start a new chat and paste the number.` : `Open a new chat in Relay with ${number}.`, "success");
  };

  // Show the bar whenever a conversation opens
  function hook() {
    const orig = window.openConversation;
    if (typeof orig !== "function" || orig.__shx) return;
    const wrapped = async function (convId) {
      const r = orig.apply(this, arguments);
      try { show(convId); } catch (e) {}
      return r;
    };
    wrapped.__shx = true;
    window.openConversation = wrapped;
    try { openConversation = wrapped; } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hook); else hook();
})();
