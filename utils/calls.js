// utils/calls.js
// ServiceHub Kenya - voice & video call signalling (WebRTC over Socket.IO).
//
// Calls are routed to the other person's personal room (user:<uid>), so their phone rings
// wherever they are on the site — they don't need that chat open. The offer and the caller's
// ICE candidates are kept while the call rings, so a phone woken by a push notification
// can still pick the call up. A ringing call times out after RING_TIMEOUT_MS as "missed".

const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const firebase = require("../config/firebase");
const push = require("./push");

const RING_TIMEOUT_MS = 45000;
const RESUME_GRACE_MS = 20000;

const calls = new Map();    // callId -> call
const userCall = new Map(); // uid -> callId (one call per person at a time)

let io = null;

function declineToken(callId, uid) {
  return crypto.createHmac("sha256", String(process.env.JWT_SECRET || "servicehub")).update(`${callId}:${uid}`).digest("hex");
}

function fmtDuration(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function publicCall(c) {
  return { callId: c.id, conversationId: c.conversationId, callerId: c.callerId, callerName: c.callerName, calleeName: c.calleeName, callType: c.type };
}

// Writes the call to the chat history ("Missed voice call", "Video call · 02:31", ...)
async function logCall(c, text) {
  try {
    const admin = require("firebase-admin");
    const id = uuidv4();
    const now = new Date().toISOString();
    const msg = { id, conversationId: c.conversationId, senderId: c.callerId, senderName: c.callerName, text, type: "call", callType: c.type, read: false, createdAt: now };
    await firebase.db.collection(firebase.COLLECTIONS.MESSAGES).doc(id).set(msg);
    await firebase.db.collection(firebase.COLLECTIONS.CONVERSATIONS).doc(c.conversationId).update({
      lastMessage: text, lastMessageAt: now, lastMessageSenderId: c.callerId,
      [`unreadCount.${c.calleeId}`]: admin.firestore.FieldValue.increment(1),
    });
    io.to(`conversation:${c.conversationId}`).emit("new_message", msg);
    io.to(`user:${c.calleeId}`).to(`user:${c.callerId}`).emit("new_conversation_message", { conversationId: c.conversationId, message: msg });
  } catch (e) { console.error("Call log error:", e.message); }
}

// Stops the ringing notification in the Android app (answered elsewhere / declined).
function stopAppRinging(c) {
  push.sendToUser(c.calleeId, { type: "call_cancel", callId: c.id }, { ttl: 60, urgency: "high", nativeOnly: true }).catch(() => {});
}

function cleanup(c) {
  clearTimeout(c.ringTimer); clearTimeout(c.graceTimer);
  calls.delete(c.id);
  if (userCall.get(c.callerId) === c.id) userCall.delete(c.callerId);
  if (userCall.get(c.calleeId) === c.id) userCall.delete(c.calleeId);
}

function label(c) { return c.type === "video" ? "video call" : "voice call"; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

async function missed(c, reason) {
  cleanup(c);
  io.to(`user:${c.calleeId}`).emit("call_cancelled", { callId: c.id, reason });
  if (c.callerSocket) io.to(c.callerSocket).emit("call_no_answer", { callId: c.id, reason });
  logCall(c, `${c.type === "video" ? "📹" : "📞"} Missed ${label(c)}`);
  push.sendToUser(c.calleeId, {
    type: "call_missed", callId: c.id, conversationId: c.conversationId, callerName: c.callerName, callType: c.type,
  }, { ttl: 24 * 3600, urgency: "normal", topic: c.id.replace(/-/g, "") }).catch(() => {});
}

function ended(c, byUid, reason) {
  cleanup(c);
  const other = byUid === c.callerId ? c.calleeSocket : c.callerSocket;
  if (other) io.to(other).emit("call_ended", { callId: c.id, reason: reason || "hangup" });
  const secs = c.answeredAt ? Math.max(1, Math.round((Date.now() - c.answeredAt) / 1000)) : 0;
  logCall(c, `${c.type === "video" ? "📹" : "📞"} ${cap(label(c))} · ${fmtDuration(secs)}`);
}

// Used by the push-notification "Decline" button (no login token inside the service worker).
function declineFromPush(callId, token) {
  const c = calls.get(callId);
  if (!c || c.state !== "ringing") return false;
  const good = declineToken(callId, c.calleeId);
  if (!token || token.length !== good.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(good))) return false;
  cleanup(c);
  if (c.callerSocket) io.to(c.callerSocket).emit("call_declined", { callId });
  io.to(`user:${c.calleeId}`).emit("call_cancelled", { callId, reason: "declined" });
  stopAppRinging(c);
  logCall(c, `${c.type === "video" ? "📹" : "📞"} Declined ${label(c)}`);
  return true;
}

function register(socket) {
  const uid = socket.user.uid;
  const name = socket.user.name || "ServiceHub user";

  // Caller starts a call. ack({ ok, callId, reason })
  socket.on("call_start", async ({ conversationId, callType, offer } = {}, ack = () => {}) => {
    try {
      if (!conversationId || !offer || !offer.sdp) return ack({ ok: false, reason: "invalid" });
      if (userCall.has(uid)) return ack({ ok: false, reason: "in_call" });
      const conv = await firebase.db.collection(firebase.COLLECTIONS.CONVERSATIONS).doc(conversationId).get();
      if (!conv.exists || !(conv.data().participants || []).includes(uid)) return ack({ ok: false, reason: "not_allowed" });
      const calleeId = conv.data().participants.find((p) => p !== uid);
      if (!calleeId) return ack({ ok: false, reason: "not_allowed" });
      const names = conv.data().participantNames || {};
      const c = {
        id: uuidv4(), conversationId, type: callType === "video" ? "video" : "voice",
        callerId: uid, callerName: names[uid] || name, callerSocket: socket.id,
        calleeId, calleeName: names[calleeId] || "User", calleeSocket: null,
        offer: { type: offer.type, sdp: offer.sdp }, candidates: [], state: "ringing", createdAt: Date.now(), answeredAt: 0,
      };
      if (userCall.has(calleeId)) {
        logCall(c, `${c.type === "video" ? "📹" : "📞"} Missed ${label(c)} (busy)`);
        return ack({ ok: false, reason: "busy" });
      }
      calls.set(c.id, c);
      userCall.set(uid, c.id); userCall.set(calleeId, c.id);
      c.ringTimer = setTimeout(() => { if (calls.get(c.id) === c && c.state === "ringing") missed(c, "no_answer"); }, RING_TIMEOUT_MS);

      const online = (io.sockets.adapter.rooms.get(`user:${calleeId}`) || new Set()).size;
      io.to(`user:${calleeId}`).emit("call_incoming", { ...publicCall(c), offer: c.offer, candidates: [] });
      ack({ ok: true, callId: c.id, calleeOnline: online > 0, calleeName: c.calleeName });

      const delivered = await push.sendToUser(calleeId, {
        type: "call", ...publicCall(c), declineToken: declineToken(c.id, calleeId), expiresAt: c.createdAt + RING_TIMEOUT_MS,
      }, { ttl: Math.ceil(RING_TIMEOUT_MS / 1000), urgency: "high", topic: c.id.replace(/-/g, "") }).catch(() => 0);
      if (delivered && calls.get(c.id) === c && c.state === "ringing") io.to(c.callerSocket).emit("call_ringing", { callId: c.id, via: "push" });
      if (!online && !delivered && calls.get(c.id) === c) {
        // Nobody to ring: no open page and no push-enabled phone.
        missed(c, "unreachable");
      }
    } catch (e) {
      console.error("call_start error:", e.message);
      ack({ ok: false, reason: "error" });
    }
  });

  // A device of the callee is showing the incoming call
  socket.on("call_ringing", ({ callId } = {}) => {
    const c = calls.get(callId);
    if (c && c.calleeId === uid && c.state === "ringing" && c.callerSocket) io.to(c.callerSocket).emit("call_ringing", { callId, via: "socket" });
  });

  socket.on("call_answer", ({ callId, answer } = {}, ack = () => {}) => {
    const c = calls.get(callId);
    if (!c || c.calleeId !== uid) return ack({ ok: false, reason: "gone" });
    if (c.state !== "ringing") return ack({ ok: false, reason: "answered_elsewhere" });
    if (!answer || !answer.sdp) return ack({ ok: false, reason: "invalid" });
    c.state = "active"; c.answeredAt = Date.now(); c.calleeSocket = socket.id;
    clearTimeout(c.ringTimer);
    io.to(c.callerSocket).emit("call_answered", { callId, answer: { type: answer.type, sdp: answer.sdp } });
    socket.to(`user:${uid}`).emit("call_handled_elsewhere", { callId });
    stopAppRinging(c);
    ack({ ok: true });
  });

  socket.on("call_reject", ({ callId } = {}) => {
    const c = calls.get(callId);
    if (!c || c.calleeId !== uid || c.state !== "ringing") return;
    cleanup(c);
    io.to(c.callerSocket).emit("call_declined", { callId });
    socket.to(`user:${uid}`).emit("call_handled_elsewhere", { callId });
    stopAppRinging(c);
    logCall(c, `${c.type === "video" ? "📹" : "📞"} Declined ${label(c)}`);
  });

  socket.on("call_end", ({ callId } = {}) => {
    const c = calls.get(callId);
    if (!c || (c.callerId !== uid && c.calleeId !== uid)) return;
    if (c.state === "ringing") {
      if (uid === c.callerId) missed(c, "cancelled");
      return;
    }
    ended(c, uid, "hangup");
  });

  socket.on("call_ice", ({ callId, candidate } = {}) => {
    const c = calls.get(callId);
    if (!c || !candidate) return;
    if (uid === c.callerId) {
      if (c.state === "ringing") {
        if (c.candidates.length < 60) c.candidates.push(candidate);
        io.to(`user:${c.calleeId}`).emit("call_ice", { callId, candidate });
      } else if (c.calleeSocket) io.to(c.calleeSocket).emit("call_ice", { callId, candidate });
    } else if (uid === c.calleeId && c.callerSocket) {
      io.to(c.callerSocket).emit("call_ice", { callId, candidate });
    }
  });

  // ICE restart / track changes after the call is up (offer or answer)
  socket.on("call_renegotiate", ({ callId, description, request } = {}) => {
    const c = calls.get(callId);
    if (!c || c.state !== "active") return;
    const target = uid === c.callerId ? c.calleeSocket : uid === c.calleeId ? c.callerSocket : null;
    if (target) io.to(target).emit("call_renegotiate", { callId, description, request: !!request });
  });

  // Page (re)connected: re-deliver a ringing call, or re-attach to an active one.
  socket.on("call_sync", ({ activeCallId } = {}, ack = () => {}) => {
    const id = userCall.get(uid);
    const c = id && calls.get(id);
    if (!c) return ack({ ok: true, call: null });
    if (c.state === "active" && activeCallId === c.id) {
      if (uid === c.callerId) c.callerSocket = socket.id; else c.calleeSocket = socket.id;
      clearTimeout(c.graceTimer); c.graceTimer = null;
      return ack({ ok: true, call: { ...publicCall(c), state: "active" } });
    }
    if (c.state === "ringing" && uid === c.callerId && activeCallId === c.id) {
      c.callerSocket = socket.id;
      clearTimeout(c.graceTimer); c.graceTimer = null;
      return ack({ ok: true, call: { ...publicCall(c), state: "ringing" } });
    }
    if (c.state === "ringing" && uid === c.calleeId) {
      socket.emit("call_incoming", { ...publicCall(c), offer: c.offer, candidates: c.candidates });
      return ack({ ok: true, call: { ...publicCall(c), state: "ringing" } });
    }
    ack({ ok: true, call: null });
  });

  socket.on("disconnect", () => {
    const id = userCall.get(uid);
    const c = id && calls.get(id);
    if (!c) return;
    if (c.state === "ringing" && c.callerSocket === socket.id) {
      // Caller closed the page while ringing.
      c.graceTimer = setTimeout(() => { if (calls.get(c.id) === c && c.state === "ringing") missed(c, "cancelled"); }, 8000);
      return;
    }
    if (c.state === "active" && (c.callerSocket === socket.id || c.calleeSocket === socket.id)) {
      // Media flows phone-to-phone, so a short signalling drop doesn't end the call.
      clearTimeout(c.graceTimer);
      c.graceTimer = setTimeout(() => { if (calls.get(c.id) === c) ended(c, uid, "disconnected"); }, RESUME_GRACE_MS);
    }
  });
}

function init(ioInstance) { io = ioInstance; push.init(); }

module.exports = { init, register, declineFromPush };
