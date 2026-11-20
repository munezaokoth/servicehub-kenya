/* ServiceHub Kenya - reply, edit and delete messages
   Tap a message (or the ⋯ that appears beside it) for: Reply · Copy · Edit · Delete.
   Replies show a quote of the original; tapping the quote jumps to it.
   Your own messages can be edited for 24 hours (marked "edited") and deleted for everyone;
   any message can be deleted just for you. Changes appear live on the other person's screen. */
(function () {
  "use strict";
  const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const notify = (m, t) => { try { showNotification(m, t || "info"); } catch (e) {} };
  const me = () => { try { return currentUser && currentUser.uid; } catch (e) { return null; } };
  const convId = () => ($("active-conversation-id") || {}).value || "";
  const api = (path, opts = {}) => fetch(`${window.API_BASE || "/api"}${path}`, { ...opts, headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` } })
    .then((r) => r.json().catch(() => ({ success: false, message: `Server error (${r.status})` }))).catch(() => ({ success: false, message: "Cannot reach ServiceHub. Check your connection." }));
  const MSGS = {}; // id → message, for replies and edits
  const S = { reply: null, edit: null };

  const st = document.createElement("style");
  st.textContent = `
  .shc-row{position:relative}
  .shc-b{position:relative;cursor:pointer;-webkit-touch-callout:none}
  .shm-more{position:absolute;top:50%;transform:translateY(-50%);width:28px;height:28px;border-radius:50%;border:0;background:var(--light);color:var(--medium-gray);display:none;align-items:center;justify-content:center;cursor:pointer;font-size:.85rem}
  .shc-row.me .shm-more{right:calc(100% + 4px)}.shc-row.them .shm-more{left:calc(100% + 4px)}
  @media (hover:hover){.shc-b:hover .shm-more{display:inline-flex}}
  .shm-quote{display:block;border-left:3px solid #f28a12;background:rgba(0,0,0,.08);border-radius:8px;padding:5px 9px;margin:2px 0 6px;font-size:.82rem;line-height:1.3;cursor:pointer;max-height:4.2em;overflow:hidden;text-align:left}
  .shc-row.me .shm-quote{background:rgba(255,255,255,.18);border-left-color:#fff}
  .shm-quote b{display:block;font-size:.76rem;opacity:.9}
  .shm-edited{font-style:italic;opacity:.75;margin-right:4px}
  .shm-tick{display:inline-flex;vertical-align:-3px;margin-left:4px}
  .shm-tick svg{width:18px;height:12px}
  .shm-tick.sent,.shm-tick.delivered{color:#d7dde6}
  .shm-tick.read{color:#2ee66b}
  body:not(.dark-theme) .shc-row.me .shm-tick.read{color:#39ff7a;filter:drop-shadow(0 0 1px rgba(0,60,20,.55))}
  .shm-del{font-style:italic;opacity:.7}
  .shc-row.shm-flash .shc-b{animation:shmFlash 1.4s ease}
  @keyframes shmFlash{0%,60%{box-shadow:0 0 0 3px #f28a12}100%{box-shadow:none}}
  #shm-menu{position:fixed;z-index:100000;background:var(--white);border:1px solid var(--light-gray);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.22);padding:6px;min-width:190px;display:none}
  #shm-menu.on{display:block}
  #shm-menu button{display:flex;align-items:center;gap:10px;width:100%;border:0;background:none;padding:10px 12px;border-radius:8px;font:inherit;font-size:.92rem;color:var(--dark);cursor:pointer;text-align:left}
  #shm-menu button:hover{background:var(--light)}#shm-menu button.danger{color:#e53935}
  #shm-menu button i{width:18px;text-align:center;opacity:.8}
  #shm-bar{display:none;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid var(--light-gray);background:var(--light);font-size:.84rem}
  #shm-bar.on{display:flex}
  #shm-bar .shm-bt{flex:1;min-width:0;border-left:3px solid #f28a12;padding-left:9px}
  #shm-bar .shm-bt b{display:block;color:var(--primary);font-size:.8rem}
  #shm-bar .shm-bt span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dark-gray)}
  #shm-bar button{border:0;background:none;font-size:1.3rem;color:var(--medium-gray);cursor:pointer;line-height:1}`;
  document.head.appendChild(st);

  /* ── Ticks: 1 grey = sent, 2 grey = delivered, 2 green = read ── */
  const statusOf = (m) => (m.readAt || m.read === true ? "read" : m.deliveredAt ? "delivered" : "sent");
  const ONE = '<svg viewBox="0 0 18 12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 6.3l3 3L13 2.6"/></svg>';
  const TWO = '<svg viewBox="0 0 18 12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 6.3l3 3L11 2.6"/><path d="M7.6 9.1l.2.2L14.3 2.6"/></svg>';
  function ticks(m) {
    if (m.senderId !== me() || m.system || m.type === "call" || m.deleted) return "";
    const st = statusOf(m);
    const label = st === "read" ? "Read" : st === "delivered" ? "Delivered" : "Sent";
    return `<span class="shm-tick ${st}" title="${label}" aria-label="${label}">${st === "sent" ? ONE : TWO}</span>`;
  }

  /* ── Message bubbles (replaces the chat's bubble drawing; same look, plus replies / edited / deleted) ── */
  const canEdit = (m) => m.senderId === me() && !m.system && m.type !== "call" && !m.deleted && Date.now() - new Date(m.createdAt).getTime() < EDIT_WINDOW_MS;
  function bubble(msg) {
    MSGS[msg.id] = msg;
    const mine = msg.senderId === me();
    const q = msg.replyTo;
    const quote = q && !msg.deleted ? `<span class="shm-quote" data-jump="${esc(q.id)}"><b>${esc(q.senderId === me() ? "You" : q.senderName || "Message")}</b>${q.deleted ? "<i>This message was deleted</i>" : esc(q.text || (q.type === "call" ? "Call" : ""))}</span>` : "";
    const body = msg.deleted
      ? `<span class="shm-del"><i class="fas fa-ban"></i> ${mine ? "You deleted this message" : "This message was deleted"}</span>`
      : esc(msg.text);
    return `<div class="shc-row ${mine ? "me" : "them"}" data-id="${esc(msg.id)}"><div class="shc-b">${mine ? "" : `<div class="shc-name">${esc(msg.senderName || "")}</div>`}${quote}${body}<div class="shc-time">${msg.edited && !msg.deleted ? '<span class="shm-edited">edited</span>' : ""}${shcTime(msg.createdAt)}${ticks(msg)}</div>${msg.deleted ? "" : '<button type="button" class="shm-more" aria-label="Message options"><i class="fas fa-ellipsis-v"></i></button>'}</div></div>`;
  }
  function install() {
    if (typeof shcMsgHTML !== "function" || shcMsgHTML.__shm) return false;
    const orig = shcMsgHTML;
    const replaced = function (msg) {
      if (!msg || msg.system) return orig(msg);
      let html = "";
      const day = shcDayLabel(msg.createdAt);
      if (day !== shcLastDay) { html += `<div class="shc-day"><span>${day}</span></div>`; shcLastDay = day; }
      return html + bubble(msg);
    };
    replaced.__shm = true;
    shcMsgHTML = replaced; window.shcMsgHTML = replaced;
    return true;
  }
  function redraw(msg) {
    const row = document.querySelector(`#chat-messages .shc-row[data-id="${CSS.escape(msg.id)}"]`);
    if (row) row.outerHTML = bubble(msg); else MSGS[msg.id] = msg;
    // replies quoting this message
    if (msg.deleted || msg.edited) document.querySelectorAll(`#chat-messages .shm-quote[data-jump="${CSS.escape(msg.id)}"]`).forEach((qEl) => {
      qEl.innerHTML = `<b>${esc(msg.senderId === me() ? "You" : msg.senderName || "Message")}</b>${msg.deleted ? "<i>This message was deleted</i>" : esc(String(msg.text).slice(0, 160))}`;
    });
  }

  /* ── Options menu ── */
  function menu() {
    let m = $("shm-menu");
    if (!m) { m = document.createElement("div"); m.id = "shm-menu"; m.setAttribute("role", "menu"); document.body.appendChild(m);
      document.addEventListener("click", (e) => { if (!m.contains(e.target) && !e.target.closest(".shc-b")) m.classList.remove("on"); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") m.classList.remove("on"); });
      window.addEventListener("resize", () => m.classList.remove("on")); }
    return m;
  }
  function openMenu(id, x, y) {
    const msg = MSGS[id]; if (!msg || msg.deleted) return;
    const mine = msg.senderId === me();
    const m = menu();
    m.innerHTML = `<button type="button" data-a="reply"><i class="fas fa-reply"></i> Reply</button>
      ${msg.text ? '<button type="button" data-a="copy"><i class="far fa-copy"></i> Copy</button>' : ""}
      ${canEdit(msg) ? '<button type="button" data-a="edit"><i class="fas fa-pen"></i> Edit</button>' : ""}
      <button type="button" data-a="delme"><i class="far fa-trash-alt"></i> Delete for me</button>
      ${mine && !msg.system ? '<button type="button" class="danger" data-a="delall"><i class="fas fa-trash-alt"></i> Delete for everyone</button>' : ""}`;
    m.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; m.classList.remove("on"); act(b.dataset.a, msg); };
    m.classList.add("on");
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
    m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
  }
  async function act(a, msg) {
    if (a === "reply") { S.edit = null; S.reply = msg; showBar(); focusInput(); }
    else if (a === "copy") { try { await navigator.clipboard.writeText(msg.text); notify("Message copied", "success"); } catch (e) { prompt("Copy the message:", msg.text); } }
    else if (a === "edit") { S.reply = null; S.edit = msg; const i = $("chat-input"); i.value = msg.text; showBar(); focusInput(); i.dispatchEvent(new Event("input")); }
    else if (a === "delme") {
      if (!confirm("Delete this message for you? The other person will still see it.")) return;
      const d = await api(`/chat/conversations/${convId()}/messages/${msg.id}?for=me`, { method: "DELETE" });
      if (!d.success) return notify(d.message || "Could not delete", "error");
      const row = document.querySelector(`#chat-messages .shc-row[data-id="${CSS.escape(msg.id)}"]`); if (row) row.remove();
    } else if (a === "delall") {
      if (!confirm("Delete this message for everyone? This can't be undone.")) return;
      const d = await api(`/chat/conversations/${convId()}/messages/${msg.id}?for=everyone`, { method: "DELETE" });
      if (!d.success) return notify(d.message || "Could not delete", "error");
      redraw(d.message);
    }
  }
  // Tap a bubble (phones) or the ⋯ button; long-press also works
  document.addEventListener("click", (e) => {
    const jump = e.target.closest(".shm-quote");
    if (jump) { e.stopPropagation(); return jumpTo(jump.dataset.jump); }
    const b = e.target.closest("#chat-messages .shc-b");
    if (!b || e.target.closest("a")) return;
    if (window.getSelection && String(window.getSelection())) return; // selecting text
    const row = b.closest(".shc-row"); if (!row || !row.dataset.id) return;
    const r = b.getBoundingClientRect();
    openMenu(row.dataset.id, row.classList.contains("me") ? r.left - 150 : r.right - 40, r.top + 10);
  });
  function jumpTo(id) {
    const row = document.querySelector(`#chat-messages .shc-row[data-id="${CSS.escape(id)}"]`);
    if (!row) return notify("That message is no longer in this chat.", "info");
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.remove("shm-flash"); void row.offsetWidth; row.classList.add("shm-flash");
  }

  /* ── Reply / edit bar above the message box ── */
  function bar() {
    let b = $("shm-bar");
    if (!b) {
      const inputWrap = document.querySelector("#chat .chat-input") || ($("chat-input") || {}).parentElement;
      if (!inputWrap) return null;
      b = document.createElement("div"); b.id = "shm-bar";
      inputWrap.parentNode.insertBefore(b, inputWrap);
    }
    return b;
  }
  function showBar() {
    const b = bar(); if (!b) return;
    const m = S.edit || S.reply;
    if (!m) { b.classList.remove("on"); b.innerHTML = ""; return; }
    b.innerHTML = `<i class="fas ${S.edit ? "fa-pen" : "fa-reply"}" style="color:var(--primary)"></i>
      <div class="shm-bt"><b>${S.edit ? "Editing message" : `Replying to ${esc(m.senderId === me() ? "yourself" : m.senderName || "")}`}</b><span>${esc(m.text || (m.type === "call" ? "Call" : ""))}</span></div>
      <button type="button" aria-label="Cancel">&times;</button>`;
    b.querySelector("button").onclick = cancelBar;
    b.classList.add("on");
  }
  function cancelBar() { if (S.edit) { $("chat-input").value = ""; $("chat-input").style.height = ""; } S.reply = null; S.edit = null; showBar(); }
  function focusInput() { const i = $("chat-input"); if (i) { i.focus(); const n = i.value.length; try { i.setSelectionRange(n, n); } catch (e) {} } }

  /* ── Sending (handles reply and edit; plain messages work as before) ── */
  let sending = false;
  async function send() {
    const input = $("chat-input"); if (!input) return;
    const text = input.value.trim();
    if (!text || sending) return;
    try { if (!requireLogin()) return; } catch (e) {}
    const cid = convId();
    if (!cid) { notify("Select a conversation first", "info"); return; }
    sending = true;
    try {
      if (S.edit) {
        const d = await api(`/chat/conversations/${cid}/messages/${S.edit.id}`, { method: "PUT", body: JSON.stringify({ text }) });
        if (!d.success) { notify(d.message || "Could not edit the message", "error"); return; }
        redraw(d.message); input.value = ""; input.style.height = ""; S.edit = null; showBar();
        return;
      }
      const body = { text }; if (S.reply) body.replyTo = S.reply.id;
      const d = await api(`/chat/conversations/${cid}/messages`, { method: "POST", body: JSON.stringify(body) });
      if (!d.success) { notify(d.message || "Failed to send message", "error"); return; }
      input.value = ""; input.style.height = "";
      S.reply = null; showBar();
      appendMessage(d.message, true);
    } finally { sending = false; }
  }
  function hookSend() {
    const btn = $("send-message");
    if (btn && !btn.__shm) { const clone = btn.cloneNode(true); clone.__shm = true; btn.parentNode.replaceChild(clone, btn); clone.addEventListener("click", (e) => { e.preventDefault(); send(); }); }
    try { handleSendMessage = send; } catch (e) {} window.handleSendMessage = send;
  }

  /* ── Live updates from the other person ── */
  function hookSocket() {
    let s = null; try { s = socket; } catch (e) {}
    if (!s || s.__shm) return;
    s.__shm = true;
    s.on("message_updated", (msg) => { if (msg && msg.conversationId === convId()) { const old = MSGS[msg.id] || {}; redraw({ ...msg, deliveredAt: msg.deliveredAt || old.deliveredAt, readAt: msg.readAt || old.readAt }); } try { loadConversations(); } catch (e) {} });
    // Ticks change live for the sender
    s.on("message_status", ({ conversationId, ids, status, at }) => {
      (ids || []).forEach((id) => {
        const m = MSGS[id]; if (!m) return;
        if (status === "read") { m.readAt = m.readAt || at; m.deliveredAt = m.deliveredAt || at; }
        else if (!m.deliveredAt) m.deliveredAt = at;
        if (conversationId !== convId()) return;
        const el = document.querySelector(`#chat-messages .shc-row[data-id="${CSS.escape(id)}"] .shm-tick`);
        if (el) el.outerHTML = ticks(m);
      });
    });
    // A message arrived: if this chat is open and on screen it's read now; otherwise show a notice
    s.on("new_message", (msg) => {
      if (!msg || msg.senderId === me()) return;
      if (msg.conversationId === convId() && chatOnScreen()) markReadSoon();
    });
    s.on("new_conversation_message", ({ conversationId, message }) => {
      if (!message || message.senderId === me()) return;
      if (conversationId === convId() && chatOnScreen()) return;
      notify(`💬 <b>${esc(message.senderName || "New message")}</b>: ${esc(String(message.text || "").slice(0, 80))}`, "info");
      try { loadConversations(); } catch (e) {}
    });
  }

  const chatOnScreen = () => document.visibilityState === "visible" && !!document.querySelector("#chat.active");
  let readTimer = null;
  function markReadSoon() {
    clearTimeout(readTimer);
    readTimer = setTimeout(() => { const c = convId(); if (c && chatOnScreen()) api(`/chat/conversations/${c}/read`, { method: "POST" }); }, 400);
  }
  // Coming back to the app with a chat open marks it read
  document.addEventListener("visibilitychange", () => { if (chatOnScreen() && convId()) markReadSoon(); });

  // Start a fresh conversation without a leftover reply/edit
  function hookOpen() {
    const orig = window.openConversation;
    if (typeof orig !== "function" || orig.__shm) return;
    const wrapped = function () { S.reply = null; S.edit = null; showBar(); return orig.apply(this, arguments); };
    Object.keys(orig).forEach((k) => { wrapped[k] = orig[k]; });
    wrapped.__shm = true;
    window.openConversation = wrapped; try { openConversation = wrapped; } catch (e) {}
  }

  function start() { install(); hookSend(); hookOpen(); hookSocket(); setInterval(hookSocket, 2000); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(start, 0)); else start();
})();
