// utils/receipts.js
// Message ticks: sent (saved) → delivered (reached the other person's phone or open app) → read (they opened the chat).
// The sender is told live through their own socket room ("message_status").
const crypto = require("crypto");
const firebase = require("../config/firebase");

const COL = () => firebase.db.collection(firebase.COLLECTIONS.MESSAGES);
const SECRET = () => process.env.JWT_SECRET || "servicehub";

// Short signed token put in the push, so the phone can confirm delivery without being signed in
function ackToken(msgId, uid) {
  return crypto.createHmac("sha256", SECRET()).update(`ack:${msgId}:${uid}`).digest("hex").slice(0, 32);
}
function validAck(msgId, uid, token) {
  const good = ackToken(msgId, uid);
  return typeof token === "string" && token.length === good.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(good));
}

function emitStatus(senderId, conversationId, ids, status, at) {
  if (!global.io || !ids.length) return;
  global.io.to(`user:${senderId}`).emit("message_status", { conversationId, ids, status, at });
}
// Tell each sender about their own messages
function emitGrouped(docs, status, at) {
  const groups = {};
  docs.forEach((m) => { const k = `${m.senderId}|${m.conversationId}`; (groups[k] = groups[k] || []).push(m.id); });
  Object.entries(groups).forEach(([k, ids]) => { const [s, c] = k.split("|"); emitStatus(s, c, ids, status, at); });
}

// Everything waiting for this person is now delivered (they came online / opened the app)
async function markDelivered(uid) {
  try {
    const snap = await COL().where("recipientId", "==", uid).where("deliveredAt", "==", null).limit(400).get();
    if (snap.empty) return;
    const at = new Date().toISOString();
    const batch = firebase.db.batch();
    const docs = snap.docs.map((d) => { batch.update(d.ref, { deliveredAt: at }); return d.data(); });
    await batch.commit();
    emitGrouped(docs, "delivered", at);
  } catch (e) { console.error("markDelivered:", e.message); }
}

// The person opened the conversation: the other side's messages are read
async function markRead(uid, conversationId, docs) {
  try {
    let list = docs;
    if (!list) {
      const snap = await COL().where("conversationId", "==", conversationId).get();
      list = snap.docs.map((d) => ({ ref: d.ref, ...d.data() }));
    }
    const unread = list.filter((m) => m.senderId !== uid && !m.system && !m.readAt && !m.deleted);
    if (!unread.length) return [];
    const at = new Date().toISOString();
    const batch = firebase.db.batch();
    unread.forEach((m) => batch.update(m.ref || COL().doc(m.id), { readAt: at, deliveredAt: m.deliveredAt || at, read: true }));
    await batch.commit();
    emitGrouped(unread, "read", at);
    // Clear the message notification on the reader's phone (app only; browsers need every push to show something)
    require("./push").sendToUser(uid, { type: "message_read", conversationId }, { ttl: 3600, urgency: "normal", nativeOnly: true }).catch(() => {});
    return unread.map((m) => m.id);
  } catch (e) { console.error("markRead:", e.message); return []; }
}

// The phone received the push (works even while the app is closed)
async function ackDelivered(msgId, uid, token) {
  if (!msgId || !uid || !validAck(msgId, uid, token)) return false;
  const ref = COL().doc(String(msgId));
  const doc = await ref.get();
  if (!doc.exists) return false;
  const m = doc.data();
  if (m.recipientId !== uid || m.deliveredAt) return true;
  const at = new Date().toISOString();
  await ref.update({ deliveredAt: at });
  emitStatus(m.senderId, m.conversationId, [m.id], "delivered", at);
  return true;
}

// Is the person connected right now (app or website open)?
async function isOnline(uid) {
  try { return !!global.io && (await global.io.in(`user:${uid}`).fetchSockets()).length > 0; } catch (e) { return false; }
}

module.exports = { ackToken, markDelivered, markRead, ackDelivered, isOnline };
