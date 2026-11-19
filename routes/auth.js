// routes/auth.js
// ServiceHub Kenya - Authentication Routes
// POST /api/auth/register, /api/auth/login, /api/auth/logout,
//      /api/auth/password-reset, /api/auth/verify-email, /api/auth/me

const express = require("express");
const { body, validationResult } = require("express-validator");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();

const { db, auth, COLLECTIONS } = require("../config/firebase");
const { generateToken, verifyJWT } = require("../middleware/auth");
const { sendWelcomeEmail, sendPasswordResetEmail } = require("../services/email");
const { rolesOf, activeRoleOf, PROVIDER } = require("../utils/roles");
const { isAdminUser } = require("../utils/admin");
const https = require("https");

// Kenyan phone → E.164 (+2547XXXXXXXX / +2541XXXXXXXX)
function toE164(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("254")) return "+" + d;
  if (d.startsWith("0")) return "+254" + d.slice(1);
  if (d.length === 9) return "+254" + d;
  return "+" + d;
}

// Ask Firebase itself to email a password-reset link (works with no email provider configured)
function firebaseSendReset(email) {
  const key = process.env.FIREBASE_WEB_API_KEY;
  if (!key) return Promise.resolve(false);
  const body = JSON.stringify({ requestType: "PASSWORD_RESET", email });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: "identitytoolkit.googleapis.com",
      path: `/v1/accounts:sendOobCode?key=${encodeURIComponent(key)}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 10000,
    }, (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => { if (res.statusCode !== 200) console.error("Firebase reset email failed:", d); resolve(res.statusCode === 200); }); });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.write(body); req.end();
  });
}

// Check a password against Firebase Auth (used after a password reset, because the
// reset link changes the Firebase Auth password, not our stored hash).
function firebasePasswordOk(email, password) {
  const key = process.env.FIREBASE_WEB_API_KEY;
  if (!key) return Promise.resolve(false);
  const body = JSON.stringify({ email, password, returnSecureToken: false });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: "identitytoolkit.googleapis.com",
      path: `/v1/accounts:signInWithPassword?key=${encodeURIComponent(key)}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 8000,
    }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.write(body); req.end();
  });
}

// ── Validation helpers ────────────────────────────────────────────────────
const registerValidation = [
  body("name").trim().notEmpty().withMessage("Name is required").isLength({ min: 2 }).withMessage("Name must be at least 2 characters"),
  body("email").isEmail().normalizeEmail().withMessage("Valid email required"),
  body("phone")
    .customSanitizer((v) => String(v || "").replace(/[\s-]/g, ""))
    .matches(/^(\+?254|0)?[17]\d{8}$/)
    .withMessage("Enter a valid Kenyan phone number, e.g. 0712345678"),
  body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),
  body("confirmPassword").custom((val, { req }) => {
    if (val !== req.body.password) throw new Error("Passwords do not match");
    return true;
  }),
  body("role").isIn(["client", "service-provider"]).withMessage("Role must be client or service-provider"),
];

const loginValidation = [
  body("email").isEmail().normalizeEmail(),
  body("password").notEmpty(),
];

// Remember the email exactly as typed (lower-cased) before normalizeEmail() rewrites it,
// so accounts stored either way can be found.
const keepRawEmail = (req, res, next) => { req.rawEmail = String((req.body && req.body.email) || "").trim().toLowerCase(); next(); };
async function findUserByEmail(normalised, raw) {
  let snap = await db.collection(COLLECTIONS.USERS).where("email", "==", normalised).limit(1).get();
  if (snap.empty && raw && raw !== normalised) snap = await db.collection(COLLECTIONS.USERS).where("email", "==", raw).limit(1).get();
  return snap;
}

function validationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }
  return null;
}

// ── POST /api/auth/register ───────────────────────────────────────────────
router.post("/register", registerValidation, async (req, res) => {
  const err = validationErrors(req, res);
  if (err) return;

  const { name, email, phone, password, role, county, subcounty } = req.body;

  try {
    // Check if user exists in Firestore
    const existing = await db.collection(COLLECTIONS.USERS).where("email", "==", email).limit(1).get();
    if (!existing.empty) {
      return res.status(409).json({ success: false, message: "This email is already registered. Please sign in or reset your password." });
    }

    // Clean up a half-created account (Firebase Auth user without a profile) from an earlier failed sign-up
    try {
      const orphan = await auth.getUserByEmail(email);
      if (orphan) await auth.deleteUser(orphan.uid);
    } catch (e) { /* auth/user-not-found is the normal case */ }

    // Create Firebase Auth user
    const e164 = toE164(phone);
    let firebaseUser;
    try {
      firebaseUser = await auth.createUser({ email, password, displayName: name, phoneNumber: e164 });
    } catch (e) {
      if (e.code === "auth/phone-number-already-exists") {
        return res.status(409).json({ success: false, message: "This phone number is already linked to another account." });
      }
      throw e;
    }

    // Hash password for Firestore record (defence in depth)
    const passwordHash = await bcrypt.hash(password, 12);

    const uid = firebaseUser.uid;
    const now = new Date().toISOString();

    const userData = {
      uid,
      name,
      email,
      phone: e164,
      role,
      roles: role === "service-provider" ? ["client", "service-provider"] : ["client"],
      county: county || null,
      subcounty: subcounty || null,
      passwordHash,
      emailVerified: false,
      profileComplete: false,
      rating: 0,
      reviewCount: 0,
      jobsPosted: 0,
      jobsCompleted: 0,
      createdAt: now,
      updatedAt: now,
      active: true,
    };

    try {
      await db.collection(COLLECTIONS.USERS).doc(uid).set(userData);
    } catch (e) {
      await auth.deleteUser(uid).catch(() => {}); // never leave a half-created account behind
      throw e;
    }

    const token = generateToken({ uid, email, name, role, roles: role === "service-provider" ? ["client", "service-provider"] : ["client"] });

    // Send welcome email (non-blocking)
    sendWelcomeEmail({ name, email, role }).catch(console.error);

    // Send email verification link
    auth.generateEmailVerificationLink(email).then(link => {
      // In production, email this link — here we just log it
      console.log(`Verification link for ${email}: ${link}`);
    }).catch(console.error);

    const safeUser = { uid, name, email, phone, role, roles: role === "service-provider" ? ["client", "service-provider"] : ["client"], county, subcounty, emailVerified: false };
    return res.status(201).json({ success: true, message: "Account created successfully", token, user: safeUser });
  } catch (error) {
    console.error("Register error:", error);
    if (error.code === "auth/email-already-exists") {
      return res.status(409).json({ success: false, message: "Email already registered" });
    }
    if (error.code === "auth/invalid-phone-number") {
      return res.status(422).json({ success: false, message: "Invalid phone number format" });
    }
    return res.status(500).json({ success: false, message: "Registration failed. Please try again." });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────
router.post("/login", keepRawEmail, loginValidation, async (req, res) => {
  const err = validationErrors(req, res);
  if (err) return;

  const { email, password } = req.body;

  try {
    // Get user from Firestore
    const snap = await findUserByEmail(email, req.rawEmail);
    if (snap.empty) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const userData = snap.docs[0].data();

    // Verify password: our stored hash first, then Firebase Auth (covers password resets)
    let valid = userData.passwordHash ? await bcrypt.compare(password, userData.passwordHash) : false;
    if (!valid && await firebasePasswordOk(userData.email, password)) {
      valid = true;
      const passwordHash = await bcrypt.hash(password, 12);
      await db.collection(COLLECTIONS.USERS).doc(userData.uid).update({ passwordHash, updatedAt: new Date().toISOString() });
    }
    if (!valid) {
      if (!userData.passwordHash && userData.authProvider) {
        return res.status(401).json({ success: false, message: "This account uses Google/Facebook sign-in. Use that button, or reset your password to set one." });
      }
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    if (userData.active === false) {
      return res.status(403).json({ success: false, message: "Account suspended. Contact support." });
    }

    // Update last login
    await db.collection(COLLECTIONS.USERS).doc(userData.uid).update({
      lastLogin: new Date().toISOString(),
    });

    const token = generateToken({
      uid: userData.uid,
      email: userData.email,
      name: userData.name,
      role: activeRoleOf(userData),
      roles: rolesOf(userData),
    });

    const safeUser = {
      uid: userData.uid,
      name: userData.name,
      email: userData.email,
      phone: userData.phone,
      role: activeRoleOf(userData),
      roles: rolesOf(userData),
      isAdmin: isAdminUser(userData),
      county: userData.county,
      subcounty: userData.subcounty,
      emailVerified: userData.emailVerified,
      rating: userData.rating,
    };

    return res.json({ success: true, message: "Signed in successfully", token, user: safeUser });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ success: false, message: "Login failed. Please try again." });
  }
});

// ── POST /api/auth/password-reset ─────────────────────────────────────────
router.post("/password-reset", keepRawEmail, body("email").isEmail().normalizeEmail(), async (req, res) => {
  const err = validationErrors(req, res);
  if (err) return;

  let { email } = req.body;

  try {
    // Check user exists
    const snap = await findUserByEmail(email, req.rawEmail);
    if (snap.empty) {
      // Don't reveal if email exists — return success anyway
      return res.json({ success: true, message: "If this email is registered, a reset link has been sent." });
    }

    email = snap.docs[0].data().email; // use the address exactly as stored
    // Make sure a Firebase Auth user exists (social or older accounts may lack one)
    try { await auth.getUserByEmail(email); }
    catch (e) { const u = snap.docs[0].data(); await auth.createUser({ uid: u.uid, email }).catch(() => {}); }
    // Branded email via Resend when configured; otherwise (or if it fails) Firebase sends its own reset email
    let sent = false;
    if (process.env.RESEND_API_KEY) {
      try {
        const resetLink = await auth.generatePasswordResetLink(email);
        await sendPasswordResetEmail({ email, resetLink });
        sent = true;
      } catch (e) { console.error("Resend reset email failed, falling back to Firebase:", e.message); }
    }
    if (!sent) sent = await firebaseSendReset(email);
    if (!sent) throw new Error("No reset email could be sent");

    return res.json({ success: true, message: "Password reset link sent to your email. Check your inbox and spam folder." });
  } catch (error) {
    console.error("Password reset error:", error);
    return res.status(500).json({ success: false, message: "Could not send reset email. Try again later." });
  }
});

// ── GET /api/auth/me (requires auth) ──────────────────────────────────────
router.get("/me", verifyJWT, async (req, res) => {
  try {
    const doc = await db.collection(COLLECTIONS.USERS).doc(req.user.uid).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const { passwordHash, ...safeUser } = doc.data();
    safeUser.roles = rolesOf(safeUser);
    safeUser.role = activeRoleOf(safeUser);
    safeUser.isAdmin = isAdminUser(safeUser);
    safeUser.hasPassword = !!passwordHash;
    return res.json({ success: true, user: safeUser });
  } catch (error) {
    console.error("Get me error:", error);
    return res.status(500).json({ success: false, message: "Could not fetch user" });
  }
});

// ── PUT /api/auth/profile (update profile) ────────────────────────────────
router.put("/profile", verifyJWT, async (req, res) => {
  const { name, phone, county, subcounty, bio, skills } = req.body;
  try {
    const updates = { updatedAt: new Date().toISOString() };
    if (name) updates.name = name;
    if (phone) updates.phone = phone;
    if (county) updates.county = county;
    if (subcounty) updates.subcounty = subcounty;
    if (bio !== undefined) updates.bio = bio;
    if (skills) updates.skills = skills;

    await db.collection(COLLECTIONS.USERS).doc(req.user.uid).update(updates);
    return res.json({ success: true, message: "Profile updated successfully" });
  } catch (error) {
    console.error("Update profile error:", error);
    return res.status(500).json({ success: false, message: "Could not update profile" });
  }
});

// ── POST /api/auth/change-password (signed in) ────────────────────────────
// { currentPassword, newPassword }. Accounts made with Google/Facebook can set a first password
// without a current one.
router.post("/change-password", verifyJWT, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(422).json({ success: false, message: "The new password must be at least 8 characters" });
  }
  try {
    const ref = db.collection(COLLECTIONS.USERS).doc(req.user.uid);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ success: false, message: "User not found" });
    const u = doc.data();
    const hasPassword = !!u.passwordHash || !u.authProvider;
    if (hasPassword) {
      if (!currentPassword) return res.status(422).json({ success: false, message: "Enter your current password" });
      let ok = u.passwordHash ? await bcrypt.compare(currentPassword, u.passwordHash) : false;
      if (!ok) ok = await firebasePasswordOk(u.email, currentPassword);
      if (!ok) return res.status(401).json({ success: false, code: "WRONG_PASSWORD", message: "Your current password is not correct" });
    }
    if (currentPassword && currentPassword === newPassword) {
      return res.status(422).json({ success: false, message: "Choose a password different from your current one" });
    }
    // Keep Firebase Auth in step (used for sign-in and password resets)
    try {
      await auth.updateUser(u.uid, { password: newPassword });
    } catch (e) {
      try {
        const fu = await auth.getUserByEmail(u.email);
        await auth.updateUser(fu.uid, { password: newPassword });
      } catch (e2) {
        await auth.createUser({ uid: u.uid, email: u.email, password: newPassword }).catch((e3) => console.error("Firebase password sync:", e3.message));
      }
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await ref.update({ passwordHash, passwordChangedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    return res.json({ success: true, message: "Password changed. Use your new password next time you sign in." });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({ success: false, message: "Could not change your password. Please try again." });
  }
});

// ── One account, two roles ────────────────────────────────────────────────
function sessionFor(u) {
  const roles = rolesOf(u);
  const role = activeRoleOf(u);
  const token = generateToken({ uid: u.uid, email: u.email, name: u.name, role, roles });
  const { passwordHash, ...rest } = u;
  return { token, user: { ...rest, role, roles, isAdmin: isAdminUser(u) } };
}

// POST /api/auth/become-provider  { skills: ["Plumbing", ...] | "Plumbing, Tiling", bio? }
// A client also starts offering services. Switches them to provider mode.
router.post("/become-provider", verifyJWT, async (req, res) => {
  try {
    const ref = db.collection(COLLECTIONS.USERS).doc(req.user.uid);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ success: false, message: "User not found" });
    const u = doc.data();
    let skills = req.body && req.body.skills;
    if (typeof skills === "string") skills = skills.split(",");
    skills = Array.isArray(skills) ? skills.map((x) => String(x).trim()).filter(Boolean).slice(0, 20) : [];
    if (!skills.length && !(Array.isArray(u.skills) && u.skills.length)) {
      return res.status(422).json({ success: false, message: "Add at least one service you offer (for example: Plumbing)" });
    }
    const roles = Array.from(new Set([...rolesOf(u), PROVIDER]));
    const updates = { roles, role: PROVIDER, updatedAt: new Date().toISOString(), providerSince: u.providerSince || new Date().toISOString() };
    if (skills.length) updates.skills = skills;
    if (req.body && typeof req.body.bio === "string" && req.body.bio.trim()) updates.bio = req.body.bio.trim().slice(0, 500);
    await ref.update(updates);
    return res.json({ success: true, message: "You can now offer services on ServiceHub", ...sessionFor({ ...u, ...updates }) });
  } catch (error) {
    console.error("Become provider error:", error);
    return res.status(500).json({ success: false, message: "Could not update your account. Please try again." });
  }
});

// POST /api/auth/switch-role  { role: "client" | "service-provider" }
router.post("/switch-role", verifyJWT, async (req, res) => {
  const role = req.body && req.body.role;
  try {
    const ref = db.collection(COLLECTIONS.USERS).doc(req.user.uid);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ success: false, message: "User not found" });
    const u = doc.data();
    if (!rolesOf(u).includes(role)) {
      return res.status(403).json({ success: false, code: "ROLE_NOT_ENABLED", message: role === PROVIDER ? "Set up your service provider profile first" : "That role is not available on your account" });
    }
    await ref.update({ role, roles: rolesOf(u), updatedAt: new Date().toISOString() });
    return res.json({ success: true, ...sessionFor({ ...u, role, roles: rolesOf(u) }) });
  } catch (error) {
    console.error("Switch role error:", error);
    return res.status(500).json({ success: false, message: "Could not switch. Please try again." });
  }
});

// ── POST /api/auth/social-login (Google / Facebook via Firebase) ──────────
router.post("/social-login", async (req, res) => {
  const { idToken, role } = req.body;

  if (!idToken) {
    return res.status(422).json({ success: false, message: "ID token is required" });
  }

  try {
    // Verify the Firebase ID token
    const decoded = await auth.verifyIdToken(idToken);
    const { uid, email, name: displayName, picture } = decoded;

    if (!email) {
      return res.status(422).json({ success: false, message: "No email found in social account" });
    }

    // Check if user already exists in Firestore
    const userRef = db.collection(COLLECTIONS.USERS).doc(uid);
    const userDoc = await userRef.get();

    let userData;

    if (userDoc.exists) {
      // Existing user — just log them in
      userData = userDoc.data();

      if (userData.active === false) {
        return res.status(403).json({ success: false, message: "Account suspended. Contact support." });
      }

      // Update last login
      await userRef.update({ lastLogin: new Date().toISOString() });

    } else {
      // New user — create their Firestore record
      const now = new Date().toISOString();
      const assignedRole = role === "service-provider" ? "service-provider" : "client";

      userData = {
        uid,
        name: displayName || email.split("@")[0],
        email,
        phone: null,
        role: assignedRole,
        roles: assignedRole === "service-provider" ? ["client", "service-provider"] : ["client"],
        county: null,
        subcounty: null,
        passwordHash: null, // social users have no password
        avatar: picture || null,
        emailVerified: true, // social login emails are pre-verified
        profileComplete: false,
        rating: 0,
        reviewCount: 0,
        jobsPosted: 0,
        jobsCompleted: 0,
        createdAt: now,
        updatedAt: now,
        lastLogin: now,
        active: true,
        authProvider: decoded.firebase.sign_in_provider, // "google.com" or "facebook.com"
      };

      await userRef.set(userData);

      // Send welcome email (non-blocking)
      sendWelcomeEmail({ name: userData.name, email, role: assignedRole }).catch(console.error);
    }

    const token = generateToken({
      uid: userData.uid,
      email: userData.email,
      name: userData.name,
      role: activeRoleOf(userData),
      roles: rolesOf(userData),
    });

    const safeUser = {
      uid: userData.uid,
      name: userData.name,
      email: userData.email,
      phone: userData.phone,
      role: activeRoleOf(userData),
      roles: rolesOf(userData),
      isAdmin: isAdminUser(userData),
      county: userData.county,
      subcounty: userData.subcounty,
      emailVerified: userData.emailVerified,
      avatar: userData.avatar,
      rating: userData.rating,
    };

    return res.status(200).json({
      success: true,
      message: userDoc.exists ? "Signed in successfully" : "Account created successfully",
      token,
      user: safeUser,
    });

  } catch (error) {
    console.error("Social login error:", error);
    if (error.code === "auth/id-token-expired") {
      return res.status(401).json({ success: false, message: "Session expired. Please sign in again." });
    }
    if (error.code === "auth/invalid-id-token") {
      return res.status(401).json({ success: false, message: "Invalid authentication token." });
    }
    return res.status(500).json({ success: false, message: "Social login failed. Please try again." });
  }
});

module.exports = router;
