const express = require("express");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();
const firebase = require("../config/firebase");
const { verifyJWT } = require("../middleware/auth");
const admin = require("firebase-admin");

router.get("/conversations", verifyJWT, async (req, res) => {
  try {
    const snap = await firebase.db.collection(firebase.COLLECTIONS.CONVERSATIONS).where("participants", "array-contains", req.user.uid).get();
    const conversations = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.lastMessageAt || "").localeCompare(String(a.lastMessageAt || ""))).slice(0, 50);
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
    const messages = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || ""))).slice(-200);
    convDoc.ref.update({ [`unreadCount.${req.user.uid}`]: 0 }).catch(() => {});
    return res.json({ success: true, messages });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not fetch messages" });
  }
});

router.post("/conversations/:id/messages", verifyJWT, async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(422).json({ success: false, message: "Message text is required" });
  try {
    const convDoc = await firebase.db.collection(firebase.COLLECTIONS.CONVERSATIONS).doc(req.params.id).get();
    if (!convDoc.exists) return res.status(404).json({ success: false, message: "Conversation not found" });
    const conv = convDoc.data();
    if (!conv.participants.includes(req.user.uid)) return res.status(403).json({ success: false, message: "Not authorised" });
    const msgId = uuidv4();
    const now = new Date().toISOString();
    const msgData = { id: msgId, conversationId: req.params.id, senderId: req.user.uid, senderName: req.user.name, text: text.trim(), read: false, createdAt: now };
    await firebase.db.collection(firebase.COLLECTIONS.MESSAGES).doc(msgId).set(msgData);
    const otherUserId = conv.participants.find((p) => p !== req.user.uid);
    await convDoc.ref.update({ lastMessage: text.trim().slice(0, 100), lastMessageAt: now, lastMessageSenderId: req.user.uid, [`unreadCount.${otherUserId}`]: admin.firestore.FieldValue.increment(1) });
    if (global.io) global.io.to(`conversation:${req.params.id}`).emit("new_message", msgData);
    return res.status(201).json({ success: true, message: msgData });
  } catch (error) {
    console.error("Send message error:", error);
    return res.status(500).json({ success: false, message: "Could not send message" });
  }
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
