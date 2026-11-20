// middleware/security.js
// ServiceHub Kenya - shared security controls
//  • allowedOrigin: only servicehub.co.ke (and the app / local development) may call the API from a browser
//  • stripTags: removes HTML tags from everything users submit, so no one can plant code that runs on other people's screens
//  • loginGuard / resetGuard: slow down password guessing per account (on top of the per-device rate limits)

/* ── Who may call the API from a browser ── */
const ORIGINS = new Set([
  "https://servicehub.co.ke",
  "https://www.servicehub.co.ke",
  "capacitor://localhost", "https://localhost", "http://localhost", // Android app shell
  ...(process.env.EXTRA_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
]);
function allowedOrigin(origin, cb) {
  // No Origin header = same-site navigation, the Android app's native calls, curl, server-to-server
  if (!origin || ORIGINS.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
  if (/^https:\/\/[a-z0-9-]+\.up\.railway\.app$/.test(origin)) return cb(null, true); // Railway preview address
  return cb(null, false);
}

/* ── Remove HTML from user-submitted text ── */
// Fields that must reach the server exactly as typed (passwords, photos, call data, push keys)
const KEEP = new Set(["password", "newPassword", "currentPassword", "confirmPassword", "image", "images", "photo", "photos", "avatar",
  "offer", "answer", "sdp", "candidate", "description_sdp", "keys", "endpoint", "p256dh", "auth", "token", "idToken", "accessToken", "t", "s"]);
const TAG = /<\/?[a-z!][^>]*>/gi;
function clean(v, key, depth) {
  if (depth > 8) return v;
  if (typeof v === "string") {
    if (KEEP.has(key) || v.startsWith("data:image/")) return v;
    // Strip tags, then neutralise any leftover angle brackets
    return v.replace(TAG, "").replace(/</g, "‹").replace(/>/g, "›");
  }
  if (Array.isArray(v)) return v.map((x) => clean(x, key, depth + 1));
  if (v && typeof v === "object") {
    for (const k of Object.keys(v)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") { delete v[k]; continue; } // prototype pollution
      v[k] = KEEP.has(k) ? v[k] : clean(v[k], k, depth + 1);
    }
  }
  return v;
}
function stripTags(req, res, next) {
  if (req.body && typeof req.body === "object") clean(req.body, "", 0);
  next();
}

/* ── Password guessing protection, per account ── */
const fails = new Map(); // key → { n, until }
const MAX_FAILS = 8, LOCK_MS = 15 * 60 * 1000;
const keyOf = (email) => String(email || "").trim().toLowerCase();
function loginBlocked(email) {
  const f = fails.get(keyOf(email));
  if (f && f.until > Date.now()) return Math.ceil((f.until - Date.now()) / 60000);
  return 0;
}
function loginFailed(email) {
  const k = keyOf(email); const f = fails.get(k) || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= MAX_FAILS) { f.until = Date.now() + LOCK_MS; f.n = 0; }
  fails.set(k, f);
}
function loginOk(email) { fails.delete(keyOf(email)); }

const resets = new Map(); // email → [timestamps]
function resetAllowed(email) {
  const k = keyOf(email); const now = Date.now();
  const list = (resets.get(k) || []).filter((t) => now - t < 60 * 60 * 1000);
  if (list.length >= 3) { resets.set(k, list); return false; }
  list.push(now); resets.set(k, list); return true;
}
// Keep the maps small
setInterval(() => {
  const now = Date.now();
  for (const [k, f] of fails) if (f.until < now && f.n === 0) fails.delete(k);
  for (const [k, l] of resets) if (!l.some((t) => now - t < 3600000)) resets.delete(k);
}, 10 * 60 * 1000).unref();

module.exports = { allowedOrigin, stripTags, loginBlocked, loginFailed, loginOk, resetAllowed };
