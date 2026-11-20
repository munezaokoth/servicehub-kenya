// utils/clean-stored-text.js
// One-off safety sweep: removes HTML tags from text already saved before tag-stripping was added
// (names, job titles, messages, reviews...), so nothing old can run code on anyone's screen.
// Runs once at start-up and records that it ran in app_config/security.
const firebase = require("../config/firebase");

const SKIP = new Set(["passwordHash", "data", "mime", "photoUrl", "avatar", "photos", "token", "keys", "endpoint", "verifyToken", "resetToken", "edits"]);
const TAG = /<\/?[a-z!][^>]*>/gi;
function cleanValue(v, key, depth) {
  if (depth > 6 || SKIP.has(key)) return v;
  if (typeof v === "string") return v.startsWith("data:") ? v : v.replace(TAG, "").replace(/</g, "‹").replace(/>/g, "›");
  if (Array.isArray(v)) return v.map((x) => cleanValue(x, key, depth + 1));
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) o[k] = cleanValue(v[k], k, depth + 1); return o; }
  return v;
}

const COLLECTIONS = ["users", "jobs", "quotes", "messages", "conversations", "listings", "reviews", "job_updates", "notifications", "contacts", "contact_messages"];

async function cleanStoredText() {
  try {
    const flag = firebase.db.collection("app_config").doc("security");
    const f = await flag.get();
    if (f.exists && f.data().textCleanedV1) return;
    let changed = 0;
    for (const name of COLLECTIONS) {
      let snap;
      try { snap = await firebase.db.collection(name).get(); } catch (e) { continue; }
      let batch = firebase.db.batch(), inBatch = 0;
      for (const d of snap.docs) {
        const data = d.data();
        const updates = {};
        for (const k of Object.keys(data)) {
          if (SKIP.has(k)) continue;
          const nv = cleanValue(data[k], k, 0);
          if (JSON.stringify(nv) !== JSON.stringify(data[k])) updates[k] = nv;
        }
        if (Object.keys(updates).length) {
          batch.update(d.ref, updates); inBatch++; changed++;
          if (inBatch >= 400) { await batch.commit(); batch = firebase.db.batch(); inBatch = 0; }
        }
      }
      if (inBatch) await batch.commit();
    }
    await flag.set({ textCleanedV1: new Date().toISOString(), textCleanedDocs: changed }, { merge: true });
    console.log(`🧹 Stored text cleaned (${changed} records changed)`);
  } catch (e) { console.error("Stored text clean-up:", e.message); }
}

module.exports = { cleanStoredText };
