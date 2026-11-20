const jwt = require("jsonwebtoken");
const firebaseConfig = require("../config/firebase");

// Only accept tokens signed the way we sign them (blocks "alg: none" and algorithm-confusion tricks)
const JWT_OPTS = { algorithms: ["HS256"] };

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.warn("⚠️  JWT_SECRET is missing or shorter than 32 characters. Set a long random value in Railway.");
}

/* ── Session checks ─────────────────────────────────────────────────────────
   A token stops working when:
   • the password is changed or reset, or "Sign out of all devices" is used (tokensValidAfter), or
   • the account is suspended by an admin (active === false).
   The account is looked up at most once a minute per user (cached), so this costs very little. */
const gateCache = new Map(); // uid → { at, after, active, exists }
const GATE_TTL = 60 * 1000;
async function sessionGate(uid) {
  const hit = gateCache.get(uid);
  if (hit && Date.now() - hit.at < GATE_TTL) return hit;
  const doc = await firebaseConfig.db.collection(firebaseConfig.COLLECTIONS.USERS).doc(uid).get();
  const d = doc.exists ? doc.data() : {};
  const g = { at: Date.now(), exists: doc.exists, active: d.active !== false, after: d.tokensValidAfter ? Math.floor(new Date(d.tokensValidAfter).getTime() / 1000) : 0 };
  gateCache.set(uid, g);
  if (gateCache.size > 20000) gateCache.clear();
  return g;
}
function forgetSession(uid) { gateCache.delete(uid); }

// Verify a token completely. Returns the user payload or throws an Error with .code
async function checkToken(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET, JWT_OPTS);
  if (!decoded || !decoded.uid) { const e = new Error("Invalid token"); e.code = "INVALID"; throw e; }
  const g = await sessionGate(decoded.uid);
  if (!g.exists) { const e = new Error("Account not found"); e.code = "GONE"; throw e; }
  if (!g.active) { const e = new Error("Account suspended. Contact support."); e.code = "SUSPENDED"; throw e; }
  if (g.after && (decoded.iat || 0) < g.after) { const e = new Error("You were signed out. Please sign in again."); e.code = "REVOKED"; throw e; }
  return decoded;
}

// Sign out every device: tokens issued before now stop working
async function revokeSessions(uid) {
  const now = new Date();
  // tokens issued in this same second (the fresh one we hand back) stay valid
  await firebaseConfig.db.collection(firebaseConfig.COLLECTIONS.USERS).doc(uid).update({ tokensValidAfter: now.toISOString() });
  forgetSession(uid);
  // Drop live connections too (the device that asked reconnects at once with its new token)
  try { if (global.io) global.io.in(`user:${uid}`).disconnectSockets(true); } catch (e) {}
}

async function verifyJWT(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "No token provided" });
    }
    req.user = await checkToken(authHeader.split(" ")[1]);
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, code: "EXPIRED", message: "Token expired. Please sign in again." });
    }
    if (error.code === "SUSPENDED") return res.status(403).json({ success: false, code: "SUSPENDED", message: error.message });
    if (error.code === "REVOKED" || error.code === "GONE") return res.status(401).json({ success: false, code: error.code, message: error.message });
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
}

async function verifyFirebaseToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "No token provided" });
    }
    const idToken = authHeader.split(" ")[1];
    const decodedToken = await firebaseConfig.auth.verifyIdToken(idToken, true);
    req.user = { uid: decodedToken.uid, email: decodedToken.email };
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Invalid or expired Firebase token" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authenticated" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: `Access denied. Required role: ${roles.join(" or ")}` });
    }
    next();
  };
}

async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) req.user = await checkToken(authHeader.split(" ")[1]);
  } catch {}
  next();
}

function generateToken(user) {
  return jwt.sign(
    { uid: user.uid, email: user.email, name: user.name, role: user.role, roles: user.roles || [user.role || "client"] },
    process.env.JWT_SECRET,
    { algorithm: "HS256", expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

module.exports = { verifyJWT, verifyFirebaseToken, requireRole, optionalAuth, generateToken, checkToken, revokeSessions, forgetSession };
