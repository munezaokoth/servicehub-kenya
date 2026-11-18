const admin = require("firebase-admin");

let initError = null;

// Credentials can be given either as ONE variable holding the whole service-account
// JSON (FIREBASE_SERVICE_ACCOUNT — easiest: paste the downloaded file's contents),
// or as the separate FIREBASE_* variables used before.
function loadCredentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim()) {
    let txt = raw.trim();
    if (!txt.startsWith("{")) txt = Buffer.from(txt, "base64").toString("utf8"); // allow base64
    const json = JSON.parse(txt);
    if (json.private_key) json.private_key = json.private_key.replace(/\\n/g, "\n");
    return json;
  }
  const rawKey = process.env.FIREBASE_PRIVATE_KEY || "";
  const privateKey = rawKey.replace(/^"|"$/g, "").replace(/\\n/g, "\n");
  return {
    type: "service_account",
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: privateKey,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
  };
}

function initFirebase() {
  if (admin.apps.length > 0) return;
  try {
    const cred = loadCredentials();
    if (!cred.project_id || !cred.private_key || !cred.client_email) {
      throw new Error("Firebase credentials missing: set FIREBASE_SERVICE_ACCOUNT (recommended) or FIREBASE_PROJECT_ID / FIREBASE_PRIVATE_KEY / FIREBASE_CLIENT_EMAIL");
    }
    console.log("Initialising Firebase, project:", cred.project_id);
    admin.initializeApp({
      credential: admin.credential.cert(cred),
      databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${cred.project_id}-default-rtdb.firebaseio.com`,
    });
    admin.firestore().settings({ ignoreUndefinedProperties: true });
    console.log("✅ Firebase initialised");
  } catch (e) {
    initError = e.message;
    console.error("❌ Firebase NOT initialised:", e.message);
    // Initialise a placeholder app so the server still boots and /health can report the problem.
    if (admin.apps.length === 0) admin.initializeApp({ projectId: "unconfigured" });
  }
}

function firebaseStatus() {
  return initError ? { ok: false, error: initError } : { ok: admin.apps.length > 0, project: admin.app().options.credential ? (process.env.FIREBASE_PROJECT_ID || "from service account") : null };
}

const COLLECTIONS = {
  USERS: "users", JOBS: "jobs", QUOTES: "quotes",
  MESSAGES: "messages", CONVERSATIONS: "conversations",
  PAYMENTS: "payments", NOTIFICATIONS: "notifications",
  REVIEWS: "reviews", CATEGORIES: "categories", PAYOUTS: "payouts",
};

module.exports = {
  initFirebase,
  firebaseStatus,
  get db() { return admin.firestore(); },
  get auth() { return admin.auth(); },
  get realtimeDb() { return admin.database(); },
  COLLECTIONS,
  admin,
};
