// routes/calls.js
// ServiceHub Kenya - call support endpoints: STUN/TURN servers and push (ringing) subscriptions.

const express = require("express");
const router = express.Router();
const { verifyJWT } = require("../middleware/auth");
const { getIceServers } = require("../utils/ice");
const push = require("../utils/push");
const calls = require("../utils/calls");

router.get("/ice-servers", verifyJWT, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, iceServers: await getIceServers() });
});

router.get("/push/key", async (req, res) => {
  const key = await push.getPublicKey().catch(() => null);
  if (!key) return res.status(503).json({ success: false, message: "Call alerts are not available right now" });
  res.json({ success: true, publicKey: key });
});

router.post("/push/subscribe", verifyJWT, async (req, res) => {
  try {
    await push.saveSubscription(req.user.uid, req.body && req.body.subscription, req.headers["user-agent"]);
    res.json({ success: true });
  } catch (e) {
    res.status(422).json({ success: false, message: "Could not turn on call alerts on this device" });
  }
});

// Android app: Firebase Cloud Messaging token
router.post("/push/subscribe-native", verifyJWT, async (req, res) => {
  try {
    await push.saveNativeToken(req.user.uid, req.body && req.body.token, req.body && req.body.platform, req.headers["user-agent"]);
    res.json({ success: true });
  } catch (e) {
    res.status(422).json({ success: false, message: "Could not turn on call alerts on this phone" });
  }
});

router.post("/push/unsubscribe", async (req, res) => {
  await push.removeSubscription(req.body && req.body.endpoint);
  res.json({ success: true });
});

// "Decline" button on the ringing notification
router.post("/decline", (req, res) => {
  const { callId, token } = req.body || {};
  res.json({ success: calls.declineFromPush(String(callId || ""), String(token || "")) });
});

module.exports = router;
