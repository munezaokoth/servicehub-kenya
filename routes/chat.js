const express = require("express");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();
const firebase = require("../config/firebase");
const { verifyJWT } = require("../middleware/auth");
const admin = require("firebase-admin");
const push = require("../utils/push");
const receipts = require("../utils/receipts");

router.get("/conversations", verifyJWT, async (req, res) => {
  try {
    const snap = await firebase.db.collection(firebase.COLLECTIONS.CONVERSATIONS).where("participants", "array-contains", req.user.uid).get();
    const conversations = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.lastMessageAt || "").localeCompare(String(a.lastMessageAt || ""))).slice(0, 50);
    receipts.markDelivered(req.user.uid);
    return res.json({ success: true, conversations });
  } catch (error) {
    console.error("Get conversations error:", error);
    return res.status(500).json({ success: false, message: "Could not fetch conversations" });
  }
});

router.post("/conversations", verifyJWT, async (req, res) => {
  const { recipientId, jobId } = req.body;
  if (!recipientId) return res.status(422).json({ success: false, message: "recipientId is required" });
  try {
    const existing = await firebase.db.collection(firebase.COLLECTIONS.CONVERSATIONS).where("participants", "array-contains", req.user.uid).limit(20).get();
    const match = existing.docs.find((d) => d.data().participants.includes(recipientId));
    if (match) return res.json({ success: true, conversation: { id: match.id, ...match.data() } });
    const recipientDoc = await firebase.db.collection(firebase.COLLECTIONS.USERS).doc(recipientId).get();
    if (!recipientDoc.exists) return res.status(404).json({ success: false, message: "Recipient not found" });
    const recipient = recipientDoc.data();
    const convId = uuidv4();
    const now = new Date().toISOString();
    const convData = { id: convId, participants: [req.user.uid, recipientId], participantNames: { [req.user.uid]: req.user.name, [recipientId]: recipient.name }, jobId: jobId || null, lastMessage: null, lastMessageAt: now, unreadCount: { [req.user.uid]: 0, [recipientId]: 0 }, createdAt: now };
    await firebase.db.collection(firebase.COLLECTIONS.CONVERSATIONS).doc(convId).set(convData);
    return res.status(201).json({ success: true, conversation: convData });
  } catch (error) {
    console.error("Start conversation error:", error);
    return res.status(500).json({ success: false, message: "Could not start conversation" });
  }
});

router.get("/conversations/:id/messages", verifyJWT, async (req, res) => {
  try {
    const convDoc = await firebase.db.collection(firebase.COLLECTIONS.CONVERSATIONS).doc(req.params.id).get();
    if (!convDoc.exists) return res.status(404).json({ success: false, message: "Conversation not found" });
    if (!convDoc.data().participants.includes(req.user.uid)) return res.status(403).json({ success: false, message: "Not authorised" });
    const snap = await firebase.db.collection(firebase.COLLECTIONS.MESSAGES).where("conversationId", "==", req.params.id).get();
    receipts.markRead(req.user.uid, req.params.id, snap.docs.map((d) => ({ ref: d.ref, ...d.data() })));
    const messages = snap.docs.map((d) => publicMsg({ id: d.id, ...d.data() }))
      .filter((m) => !(Array.isArray(m.hiddenFor) && m.hiddenFor.includes(req.user.uid)))
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || ""))).slice(-200)
      .map(({ hiddenFor, ...m }) => m);
    convDoc.ref.update({ [`unreadCount.${req.user.uid}`]: 0 }).catch(() => {});
    return res.json({ success: true, messages });
  } catch (error) {
    console.error("Get messages error:", error);
    return res.status(500).json({ success: false, message: "Could not fetch messages" });
  }
});

router.post("/conversations/:id/messages", verifyJWT, async (req, res) => {
  const { replyTo, image } = req.body;
  const text = String(req.body.text || "");
  const photo = image ? parsePhoto(image) : null;
  if (image && !photo) return res.status(422).json({ success: false, message: "Please send a JPG, PNG or WebP photo under about 700 KB" });
  if (!text.trim() && !photo) return res.status(422).json({ success: false, message: "Message text is required" });
  if (text.length > 4000) return res.status(422).json({ success: false, message: "Message is too long" });
  try {
    const convDoc = await firebase.db.collection(firebase.COLLECTIONS.CONVERSATIONS).doc(req.params.id).get();
    if (!convDoc.exists) return res.status(404).json({ success: false, message: "Conversation not found" });
    const conv = convDoc.data();
    if (!conv.participants.includes(req.user.uid)) return res.status(403).json({ success: false, message: "Not authorised" });
    const msgId = uuidv4();
    const now = new Date().toISOString();
    const otherUserId = conv.participants.find((p) => p !== req.user.uid);
    const msgData = { id: msgId, conversationId: req.params.id, senderId: req.user.uid, senderName: req.user.name, recipientId: otherUserId, text: text.trim(), read: false, createdAt: now, deliveredAt: null, readAt: null };
    if (await receipts.isOnline(otherUserId)) msgData.deliveredAt = now; // their app is open, it arrives instantly
    if (photo) {
      await firebase.db.collection(PHOTOS).doc(msgId).set({ conversationId: req.params.id, mime: photo.mime, data: photo.data, createdAt: now });
      msgData.type = "photo";
      msgData.photoUrl = photoUrl(msgId);
    }
    // Reply to an earlier message in the same conversation (a short quote is kept with the reply)
    if (replyTo) {
      const orig = await firebase.db.collection(firebase.COLLECTIONS.MESSAGES).doc(String(replyTo)).get();
      if (orig.exists && orig.data().conversationId === req.params.id) {
        const o = orig.data();
        msgData.replyTo = { id: o.id, senderId: o.senderId, senderName: o.senderName || "", text: o.deleted ? "" : String(o.text || (o.type === "photo" ? "📷 Photo" : "")).slice(0, 160), deleted: !!o.deleted, type: o.type || null };
      }
    }
    await firebase.db.collection(firebase.COLLECTIONS.MESSAGES).doc(msgId).set(msgData);
    const preview = photo ? (text.trim() ? `📷 ${text.trim()}` : "📷 Photo") : text.trim();
    await convDoc.ref.update({ lastMessage: preview.slice(0, 100), lastMessageAt: now, lastMessageSenderId: req.user.uid, [`unreadCount.${otherUserId}`]: admin.firestore.FieldValue.increment(1) });
    if (global.io) {
      global.io.to(`conversation:${req.params.id}`).emit("new_message", msgData);
      global.io.to(`user:${otherUserId}`).emit("new_conversation_message", { conversationId: req.params.id, message: msgData });
    }
    // Phone notification (app closed or in the background); the phone confirms delivery back to us
    push.sendToUser(otherUserId, {
      type: "message", conversationId: req.params.id, messageId: msgId, senderName: req.user.name || "ServiceHub",
      title: req.user.name || "New message", body: preview.slice(0, 160), recipientId: otherUserId, ackToken: receipts.ackToken(msgId, otherUserId),
    }, { ttl: 24 * 3600, urgency: "high", topic: `m${String(req.params.id).replace(/-/g, "").slice(0, 30)}` }).catch((e) => console.error("Message push error:", e.message));
    return res.status(201).json({ success: true, message: msgData });
  } catch (error) {
    console.error("Send message error:", error);
    return res.status(500).json({ success: false, message: "Could not send message" });
  }
});


// ── Photos in messages ──────────────────────────────────────────────────────
// Stored in their own collection (the phone shrinks them first) and shown through a signed link,
// so only people who have the message can open the photo.
const crypto = require("crypto");
const PHOTOS = "message_photos";
function parsePhoto(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m || m[2].length > 950000) return null;
  return { mime: m[1], data: m[2] };
}
const photoSig = (id) => crypto.createHmac("sha256", process.env.JWT_SECRET || "servicehub").update(`photo:${id}`).digest("hex").slice(0, 32);
const photoUrl = (id) => `/api/chat/photos/${id}?s=${photoSig(id)}`;

// GET /api/chat/photos/:msgId?s=signature
router.get("/photos/:msgId", async (req, res) => {
  try {
    const id = String(req.params.msgId);
    const sig = String(req.query.s || "");
    if (sig.length !== 32 || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(photoSig(id)))) return res.status(403).end();
    const doc = await firebase.db.collection(PHOTOS).doc(id).get();
    if (!doc.exists) return res.status(404).end();
    const p = doc.data();
    res.setHeader("Content-Type", p.mime);
    res.setHeader("Cache-Control", "private, max-age=2592000, immutable");
    return res.end(Buffer.from(p.data, "base64"));
  } catch (e) { return res.status(500).end(); }
});

// ── Edit and delete messages ───────────────────────────────────────────────
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000; // your own messages can be edited for 24 hours
function publicMsg(m) {
  if (m.deleted) { const { text, edits, photoUrl: _p, ...rest } = m; return { ...rest, text: "" }; }
  const { edits, ...rest } = m; return rest; // earlier versions stay on the server only
}
async function loadOwnMessage(req, res) {
  const convDoc = await firebase.db.collection(firebase.COLLECTIONS.CONVERSATIONS).doc(req.params.id).get();
  if (!convDoc.exists) { res.status(404).json({ success: false, message: "Conversation not found" }); return null; }
  const conv = convDoc.data();
  if (!(conv.participants || []).includes(req.user.uid)) { res.status(403).json({ success: false, message: "Not authorised" }); return null; }
  const ref = firebase.db.collection(firebase.COLLECTIONS.MESSAGES).doc(req.params.msgId);
  const doc = await ref.get();
  if (!doc.exists || doc.data().conversationId !== req.params.id) { res.status(404).json({ success: false, message: "Message not found" }); return null; }
  return { convDoc, conv, ref, msg: doc.data() };
}
// If the edited/deleted message is the newest one, keep the conversation list preview right
async function refreshPreview(convDoc, conv, msg, newText) {
  if (conv.lastMessageAt === msg.createdAt) await convDoc.ref.update({ lastMessage: String(newText).slice(0, 100) }).catch(() => {});
}

// PUT /api/chat/conversations/:id/messages/:msgId  { text }
router.put("/conversations/:id/messages/:msgId", verifyJWT, async (req, res) => {
  const text = String((req.body && req.body.text) || "").trim();
  if (text.length > 4000) return res.status(422).json({ success: false, message: "Message is too long" });
  try {
    const it = await loadOwnMessage(req, res); if (!it) return;
    const m = it.msg;
    if (m.senderId !== req.user.uid) return res.status(403).json({ success: false, message: "You can only edit your own messages" });
    if (m.system || m.type === "call" || m.deleted) return res.status(422).json({ success: false, message: "This message can't be edited" });
    if (!text && m.type !== "photo") return res.status(422).json({ success: false, message: "Message text is required" });
    if (Date.now() - new Date(m.createdAt).getTime() > EDIT_WINDOW_MS) return res.status(422).json({ success: false, message: "Messages can only be edited within 24 hours of sending" });
    if (text === m.text) return res.json({ success: true, message: publicMsg(m) });
    const now = new Date().toISOString();
    const updates = { text, edited: true, editedAt: now, edits: admin.firestore.FieldValue.arrayUnion({ text: m.text, at: m.editedAt || m.createdAt }) };
    await it.ref.update(updates);
    const out = publicMsg({ ...m, text, edited: true, editedAt: now });
    await refreshPreview(it.convDoc, it.conv, m, m.type === "photo" ? (text ? `📷 ${text}` : "📷 Photo") : text);
    if (global.io) global.io.to(`conversation:${req.params.id}`).emit("message_updated", out);
    return res.json({ success: true, message: out });
  } catch (error) {
    console.error("Edit message error:", error);
    return res.status(500).json({ success: false, message: "Could not edit the message" });
  }
});

// DELETE /api/chat/conversations/:id/messages/:msgId?for=everyone|me
router.delete("/conversations/:id/messages/:msgId", verifyJWT, async (req, res) => {
  const forEveryone = req.query.for === "everyone";
  try {
    const it = await loadOwnMessage(req, res); if (!it) return;
    const m = it.msg;
    if (!forEveryone) {
      await it.ref.update({ hiddenFor: admin.firestore.FieldValue.arrayUnion(req.user.uid) });
      return res.json({ success: true, hiddenFor: "me", id: m.id });
    }
    if (m.senderId !== req.user.uid) return res.status(403).json({ success: false, message: "You can only delete your own messages for everyone" });
    if (m.system) return res.status(422).json({ success: false, message: "This message can't be deleted" });
    const now = new Date().toISOString();
    await it.ref.update({ deleted: true, deletedAt: now, text: "", edits: admin.firestore.FieldValue.delete(), photoUrl: admin.firestore.FieldValue.delete() });
    if (m.type === "photo") await firebase.db.collection(PHOTOS).doc(m.id).delete().catch(() => {});
    const out = publicMsg({ ...m, deleted: true, deletedAt: now });
    await refreshPreview(it.convDoc, it.conv, m, "This message was deleted");
    if (global.io) global.io.to(`conversation:${req.params.id}`).emit("message_updated", out);
    return res.json({ success: true, message: out });
  } catch (error) {
    console.error("Delete message error:", error);
    return res.status(500).json({ success: false, message: "Could not delete the message" });
  }
});


// POST /api/chat/conversations/:id/read: the chat is open on screen, mark the other side's messages read
router.post("/conversations/:id/read", verifyJWT, async (req, res) => {
  try {
    const convDoc = await firebase.db.collection(firebase.COLLECTIONS.CONVERSATIONS).doc(req.params.id).get();
    if (!convDoc.exists || !(convDoc.data().participants || []).includes(req.user.uid)) return res.status(404).json({ success: false });
    const ids = await receipts.markRead(req.user.uid, req.params.id);
    convDoc.ref.update({ [`unreadCount.${req.user.uid}`]: 0 }).catch(() => {});
    return res.json({ success: true, read: ids.length });
  } catch (e) { return res.status(500).json({ success: false }); }
});

// POST /api/chat/delivered-ack { m, u, t }: sent by the phone when a message notification arrives (no sign-in needed; signed token)
router.post("/delivered-ack", async (req, res) => {
  const { m, u, t } = req.body || {};
  try { return res.json({ success: await receipts.ackDelivered(m, u, t) }); } catch (e) { return res.json({ success: false }); }
});

// GET /api/chat/conversations/:id/contact
// The other person's phone number, shared only with someone in the same conversation,
// so they can also talk on WhatsApp or Relay.
function phoneDigits(p) {
  let d = String(p || "").replace(/[^\d]/g, "");
  if (/^0[17]\d{8}$/.test(d)) d = "254" + d.slice(1);
  if (/^[17]\d{8}$/.test(d)) d = "254" + d;
  return /^\d{9,15}$/.test(d) ? d : null;
}
router.get("/conversations/:id/contact", verifyJWT, async (req, res) => {
  try {
    const convDoc = await firebase.db.collection(firebase.COLLECTIONS.CONVERSATIONS).doc(req.params.id).get();
    if (!convDoc.exists) return res.status(404).json({ success: false, message: "Conversation not found" });
    const conv = convDoc.data();
    if (!(conv.participants || []).includes(req.user.uid)) return res.status(403).json({ success: false, message: "Not authorised" });
    const otherId = conv.participants.find((p) => p !== req.user.uid);
    const other = otherId ? await firebase.db.collection(firebase.COLLECTIONS.USERS).doc(otherId).get() : null;
    if (!other || !other.exists) return res.status(404).json({ success: false, message: "User not found" });
    const u = other.data();
    return res.json({ success: true, contact: { uid: otherId, name: u.name || (conv.participantNames || {})[otherId] || "ServiceHub user", phone: phoneDigits(u.phone) } });
  } catch (error) {
    console.error("Conversation contact error:", error);
    return res.status(500).json({ success: false, message: "Could not load contact details" });
  }
});

module.exports = router;
