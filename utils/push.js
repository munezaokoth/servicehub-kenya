// utils/push.js
// ServiceHub Kenya - Web Push (makes the phone ring when ServiceHub is in the background or closed).
// VAPID keys: set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in Railway, or leave them out and the server
// generates a pair once and keeps it in Firestore (app_config/vapid), so subscriptions survive redeploys.

const crypto = require("crypto");
const webpush = require("web-push");
const firebase = require("../config/firebase");

const SUBS = "push_subscriptions";
let ready = null;
let publicKey = null;

function init() {
  if (ready) return ready;
  ready = (async () => {
    let pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
    if (!pub || !priv) {
      const ref = firebase.db.collection("app_config").doc("vapid");
      const doc = await ref.get();
      // Generation 2: the first key pair sat in a database that was briefly readable from outside (Nov 2026),
      // so it is replaced once. Browsers re-subscribe with the new key automatically the next time ServiceHub opens.
      if (doc.exists && doc.data().publicKey && doc.data().privateKey && doc.data().generation >= 2) {
        ({ publicKey: pub, privateKey: priv } = doc.data());
      } else {
        const keys = webpush.generateVAPIDKeys();
        pub = keys.publicKey; priv = keys.privateKey;
        await ref.set({ publicKey: pub, privateKey: priv, generation: 2, createdAt: new Date().toISOString() });
        // Browser subscriptions made with the old key can't receive pushes signed with the new one
        if (doc.exists) {
          const old = await firebase.db.collection(SUBS).get();
          const batch = firebase.db.batch(); let n = 0;
          old.docs.forEach((d) => { if (d.data().kind !== "fcm" && n < 450) { batch.delete(d.ref); n++; } });
          if (n) await batch.commit();
          console.log(`🔑 Web push keys replaced; ${n} old browser subscriptions cleared`);
        }
      }
    }
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || `mailto:${process.env.EMAIL_FROM || "support@servicehub.co.ke"}`, pub, priv);
    publicKey = pub;
    return true;
  })().catch((e) => { console.error("Push init error:", e.message); ready = null; return false; });
  return ready;
}

async function getPublicKey() { await init(); return publicKey; }

function subId(endpoint) { return crypto.createHash("sha256").update(String(endpoint)).digest("hex"); }

async function saveSubscription(uid, sub, userAgent) {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw new Error("Invalid subscription");
  await firebase.db.collection(SUBS).doc(subId(sub.endpoint)).set({
    uid, endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    userAgent: String(userAgent || "").slice(0, 200), updatedAt: new Date().toISOString(),
  });
}

// Android app (Firebase Cloud Messaging token)
async function saveNativeToken(uid, token, platform, userAgent) {
  if (!token || typeof token !== "string" || token.length < 20) throw new Error("Invalid token");
  await firebase.db.collection(SUBS).doc(subId(`fcm:${token}`)).set({
    uid, kind: "fcm", token, platform: String(platform || "android").slice(0, 20),
    userAgent: String(userAgent || "").slice(0, 200), updatedAt: new Date().toISOString(),
  });
}

async function sendFcm(docRef, token, payload, ttl) {
  try {
    const data = {};
    Object.entries(payload).forEach(([k, v]) => { if (v != null) data[k] = String(v); });
    await firebase.admin.messaging().send({
      token, data,
      android: { priority: "high", ttl: Math.max(1, ttl) * 1000 },
    });
    return 1;
  } catch (e) {
    const code = e.code || (e.errorInfo && e.errorInfo.code) || "";
    if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code)) await docRef.delete().catch(() => {});
    else console.error("FCM send error:", code || e.message);
    return 0;
  }
}

async function removeSubscription(endpoint) {
  if (endpoint) await firebase.db.collection(SUBS).doc(subId(endpoint)).delete().catch(() => {});
}

// Sends to every device of a user: browsers (Web Push) and the Android app (FCM).
// nativeOnly: only the app (used to stop ringing; browsers must show something for each push).
// Returns the number of devices the push services accepted.
async function sendToUser(uid, payload, { ttl = 60, urgency = "high", topic, nativeOnly = false } = {}) {
  const snap = await firebase.db.collection(SUBS).where("uid", "==", uid).get().catch(() => null);
  if (!snap || snap.empty) return 0;
  const webReady = nativeOnly ? false : await init();
  const body = JSON.stringify(payload);
  const opts = { TTL: ttl, urgency };
  if (topic) opts.topic = String(topic).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  const results = await Promise.all(snap.docs.map(async (d) => {
    const s = d.data();
    if (s.kind === "fcm") return sendFcm(d.ref, s.token, payload, ttl);
    if (!webReady) return 0;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, opts);
      return 1;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await d.ref.delete().catch(() => {});
      else console.error("Push send error:", e.statusCode || e.message);
      return 0;
    }
  }));
  return results.reduce((a, b) => a + b, 0);
}

module.exports = { init, getPublicKey, saveSubscription, saveNativeToken, removeSubscription, sendToUser };
