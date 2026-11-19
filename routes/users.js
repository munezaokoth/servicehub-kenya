const express = require("express");
const { body, validationResult } = require("express-validator");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();
const firebase = require("../config/firebase");
const { verifyJWT, optionalAuth } = require("../middleware/auth");

function validationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, errors: errors.array() });
  return null;
}

router.get("/dashboard/stats", verifyJWT, async (req, res) => {
  try {
    const uid = req.user.uid;
    const assignedSnap = await firebase.db.collection(firebase.COLLECTIONS.JOBS).where("assignedProviderId", "==", uid).get();
    const assignedJobsCompleted = assignedSnap.docs.filter((d) => d.data().status === "completed").length;
    const assignedInProgress = assignedSnap.docs.filter((d) => ["in-progress", "pending-completion"].includes(d.data().status)).length;
    const [jobsSnap, quotesSnap, paymentsSnap, reviewsSnap] = await Promise.all([
      firebase.db.collection(firebase.COLLECTIONS.JOBS).where("clientId", "==", uid).get(),
      firebase.db.collection(firebase.COLLECTIONS.QUOTES).where("providerId", "==", uid).get(),
      firebase.db.collection(firebase.COLLECTIONS.PAYMENTS).where("userId", "==", uid).where("status", "==", "completed").get(),
      firebase.db.collection(firebase.COLLECTIONS.REVIEWS).where("revieweeId", "==", uid).get(),
    ]);
    const jobs = jobsSnap.docs.map((d) => d.data());
    const quotes = quotesSnap.docs.map((d) => d.data());
    const payments = paymentsSnap.docs.map((d) => d.data());
    const reviews = reviewsSnap.docs.map((d) => d.data());
    const totalSpent = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const avgRating = reviews.length ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10 : 0;
    return res.json({ success: true, stats: { jobsPosted: jobs.filter((j) => j.status !== "cancelled").length, jobsOpen: jobs.filter((j) => j.status === "open").length, jobsInProgress: jobs.filter((j) => ["awaiting-provider", "in-progress", "pending-completion"].includes(j.status)).length, jobsCompleted: jobs.filter((j) => j.status === "completed").length, quotesSubmitted: quotes.length, assignedJobsCompleted, assignedInProgress, quotesAccepted: quotes.filter((q) => q.status === "accepted").length, totalSpent, reviewCount: reviews.length, avgRating } });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    return res.status(500).json({ success: false, message: "Could not fetch dashboard stats" });
  }
});

// ── Profile pictures ─────────────────────────────────────────────────────
// Stored in Firestore (avatars/{uid}) as a small compressed JPEG/PNG/WebP; served at /api/users/:uid/avatar.
const AVATARS = "avatars";
function parseImage(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) return null;
  if (m[2].length > 550000) return null; // ~400 KB; the website shrinks photos to 512px before upload
  return { mime: m[1], data: m[2] };
}

router.post("/me/avatar", verifyJWT, async (req, res) => {
  const img = parseImage(req.body && req.body.image);
  if (!img) return res.status(422).json({ success: false, message: "Please choose a JPG, PNG or WebP photo" });
  try {
    const now = new Date().toISOString();
    await firebase.db.collection(AVATARS).doc(req.user.uid).set({ uid: req.user.uid, mime: img.mime, data: img.data, updatedAt: now });
    const avatar = `/api/users/${req.user.uid}/avatar?v=${Date.now()}`;
    await firebase.db.collection(firebase.COLLECTIONS.USERS).doc(req.user.uid).update({ avatar, avatarUpdatedAt: now, updatedAt: now });
    return res.json({ success: true, avatar });
  } catch (e) {
    console.error("Avatar upload error:", e);
    return res.status(500).json({ success: false, message: "Could not save your photo. Please try again." });
  }
});

router.delete("/me/avatar", verifyJWT, async (req, res) => {
  try {
    await firebase.db.collection(AVATARS).doc(req.user.uid).delete().catch(() => {});
    await firebase.db.collection(firebase.COLLECTIONS.USERS).doc(req.user.uid).update({ avatar: null, updatedAt: new Date().toISOString() });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Could not remove your photo" });
  }
});

router.get("/:uid/avatar", async (req, res) => {
  try {
    const d = await firebase.db.collection(AVATARS).doc(req.params.uid).get();
    if (d.exists) {
      const a = d.data();
      res.setHeader("Content-Type", a.mime);
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.end(Buffer.from(a.data, "base64"));
    }
    // Google / Facebook profile photo
    const u = await firebase.db.collection(firebase.COLLECTIONS.USERS).doc(req.params.uid).get();
    const url = u.exists && u.data().avatar;
    res.setHeader("Cache-Control", "public, max-age=300");
    if (url && /^https:\/\//.test(url)) return res.redirect(302, url);
    return res.status(404).end();
  } catch (e) { return res.status(500).end(); }
});

router.get("/:uid", optionalAuth, async (req, res) => {
  try {
    const doc = await firebase.db.collection(firebase.COLLECTIONS.USERS).doc(req.params.uid).get();
    if (!doc.exists) return res.status(404).json({ success: false, message: "User not found" });
    const { passwordHash, email, phone, ...publicProfile } = doc.data();
    return res.json({ success: true, user: publicProfile });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not fetch user" });
  }
});

router.get("/:uid/reviews", async (req, res) => {
  try {
    const snap = await firebase.db.collection(firebase.COLLECTIONS.REVIEWS).where("revieweeId", "==", req.params.uid).get();
    const reviews = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 30);
    return res.json({ success: true, reviews });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not fetch reviews" });
  }
});

router.post("/:uid/reviews", verifyJWT, [body("rating").isInt({ min: 1, max: 5 }), body("comment").trim().isLength({ min: 5, max: 500 }), body("jobId").notEmpty()], async (req, res) => {
  const err = validationErrors(req, res);
  if (err) return;
  if (req.user.uid === req.params.uid) return res.status(400).json({ success: false, message: "You cannot review yourself" });
  const { rating, comment, jobId } = req.body;
  try {
    const dup = await firebase.db.collection(firebase.COLLECTIONS.REVIEWS).where("jobId", "==", jobId).where("reviewerId", "==", req.user.uid).limit(1).get();
    if (!dup.empty) return res.status(409).json({ success: false, message: "You already reviewed this job" });
    const reviewId = uuidv4();
    const now = new Date().toISOString();
    const reviewData = { id: reviewId, revieweeId: req.params.uid, reviewerId: req.user.uid, reviewerName: req.user.name, jobId, rating: parseInt(rating), comment, createdAt: now };
    await firebase.db.collection(firebase.COLLECTIONS.REVIEWS).doc(reviewId).set(reviewData);
    const allReviews = await firebase.db.collection(firebase.COLLECTIONS.REVIEWS).where("revieweeId", "==", req.params.uid).get();
    const ratings = allReviews.docs.map((d) => d.data().rating);
    const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    await firebase.db.collection(firebase.COLLECTIONS.USERS).doc(req.params.uid).update({ rating: Math.round(avg * 10) / 10, reviewCount: ratings.length, updatedAt: now });
    return res.status(201).json({ success: true, review: reviewData });
  } catch (error) {
    console.error("Submit review error:", error);
    return res.status(500).json({ success: false, message: "Could not submit review" });
  }
});

module.exports = router;
