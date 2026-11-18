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
    return res.json({ success: true, stats: { jobsPosted: jobs.filter((j) => j.status !== "cancelled").length, jobsOpen: jobs.filter((j) => j.status === "open").length, jobsInProgress: jobs.filter((j) => j.status === "in-progress").length, jobsCompleted: jobs.filter((j) => j.status === "completed").length, quotesSubmitted: quotes.length, quotesAccepted: quotes.filter((q) => q.status === "accepted").length, totalSpent, reviewCount: reviews.length, avgRating } });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    return res.status(500).json({ success: false, message: "Could not fetch dashboard stats" });
  }
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
