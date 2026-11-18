// routes/quotes.js
// ServiceHub Kenya - Quotes Routes
// Service providers submit quotes; clients accept/reject them

const express = require("express");
const { body, validationResult } = require("express-validator");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();

const { db, COLLECTIONS } = require("../config/firebase");
const { verifyJWT } = require("../middleware/auth");
const { sendQuoteReceivedEmail, sendQuoteAcceptedEmail } = require("../services/email");

// Live + saved notification for a user (never blocks the request)
function alertUser(uid, type, data) {
  if (!uid) return;
  try { const { getIO } = require("../utils/socket"); const io = getIO(); if (io) io.to(`user:${uid}`).emit("notification", { type, ...data }); } catch (e) {}
  db.collection(COLLECTIONS.NOTIFICATIONS).add({ userId: uid, type, ...data, read: false, createdAt: new Date().toISOString() }).catch(() => {});
}
const admin = require("firebase-admin");

function validationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, errors: errors.array() });
  return null;
}

// ── POST /api/quotes  (provider submits a quote) ──────────────────────────
router.post(
  "/",
  verifyJWT,
  [
    body("jobId").notEmpty(),
    body("amount").isNumeric({ min: 1 }).withMessage("Amount must be a positive number"),
    body("message").optional().isLength({ max: 500 }),
    body("estimatedDays").optional().isNumeric({ min: 1 }),
  ],
  async (req, res) => {
    const err = validationErrors(req, res);
    if (err) return;

    if (req.user.role !== "service-provider") {
      return res.status(403).json({ success: false, message: "Only service providers can submit quotes" });
    }

    const { jobId, amount, message, estimatedDays } = req.body;

    try {
      // Verify job exists and is open
      const jobDoc = await db.collection(COLLECTIONS.JOBS).doc(jobId).get();
      if (!jobDoc.exists) return res.status(404).json({ success: false, message: "Job not found" });
      const job = jobDoc.data();
      if (job.status !== "open") {
        return res.status(409).json({ success: false, message: "This job is no longer accepting quotes" });
      }

      // Prevent duplicate quotes from same provider
      const dupSnap = await db.collection(COLLECTIONS.QUOTES)
        .where("jobId", "==", jobId)
        .where("providerId", "==", req.user.uid)
        .limit(1)
        .get();
      if (!dupSnap.empty) {
        return res.status(409).json({ success: false, message: "You already submitted a quote for this job" });
      }

      const quoteId = uuidv4();
      const now = new Date().toISOString();

      const quoteData = {
        id: quoteId,
        jobId,
        jobTitle: job.title,
        clientId: job.clientId,
        clientEmail: job.clientEmail,
        providerId: req.user.uid,
        providerName: req.user.name,
        providerEmail: req.user.email,
        amount: parseFloat(amount),
        message: message || "",
        estimatedDays: estimatedDays ? parseInt(estimatedDays) : null,
        status: "pending",   // pending | accepted | rejected | withdrawn
        createdAt: now,
        updatedAt: now,
      };

      await db.collection(COLLECTIONS.QUOTES).doc(quoteId).set(quoteData);

      // Increment job quotesCount
      await jobDoc.ref.update({
        quotesCount: admin.firestore.FieldValue.increment(1),
        timeline: admin.firestore.FieldValue.arrayUnion({ id: uuidv4(), type: "quote", label: `Quote received from ${req.user.name}`, note: `KES ${Number(amount).toLocaleString()}`, byId: req.user.uid, byName: req.user.name, at: now }),
      });

      // Real-time: the client's dashboard refreshes and shows the new quote under the job
      try { const { getIO } = require("../utils/socket"); const io = getIO(); if (io) io.to(`user:${job.clientId}`).emit("notification", { type: "new_quote", jobId, quoteId }); } catch (e) {}

      // Notify client (non-blocking)
      sendQuoteReceivedEmail({
        clientEmail: job.clientEmail,
        clientName: job.clientName,
        quote: quoteData,
        job,
      }).catch(console.error);

      return res.status(201).json({ success: true, message: "Quote submitted successfully", quote: quoteData });
    } catch (error) {
      console.error("Submit quote error:", error);
      return res.status(500).json({ success: false, message: "Could not submit quote" });
    }
  }
);

// ── GET /api/quotes/job/:jobId  (client: see all quotes for their job) ─────
router.get("/job/:jobId", verifyJWT, async (req, res) => {
  try {
    const jobDoc = await db.collection(COLLECTIONS.JOBS).doc(req.params.jobId).get();
    if (!jobDoc.exists) return res.status(404).json({ success: false, message: "Job not found" });
    if (jobDoc.data().clientId !== req.user.uid) {
      return res.status(403).json({ success: false, message: "Not authorised" });
    }

    const snap = await db.collection(COLLECTIONS.QUOTES)
      .where("jobId", "==", req.params.jobId)
      .get();

    const quotes = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => Number(a.amount || 0) - Number(b.amount || 0));
    return res.json({ success: true, quotes });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not fetch quotes" });
  }
});

// ── GET /api/quotes/my  (provider: see own quotes) ────────────────────────
router.get("/my", verifyJWT, async (req, res) => {
  try {
    const snap = await db.collection(COLLECTIONS.QUOTES)
      .where("providerId", "==", req.user.uid)
      .get();
    const quotes = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return res.json({ success: true, quotes });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not fetch your quotes" });
  }
});

// ── PUT /api/quotes/:id/accept  (client accepts a quote → job is OFFERED to that provider) ──
// The provider must then accept the job (PUT /api/jobs/:id/provider-accept) before work commences.
router.put("/:id/accept", verifyJWT, async (req, res) => {
  try {
    const quoteDoc = await db.collection(COLLECTIONS.QUOTES).doc(req.params.id).get();
    if (!quoteDoc.exists) return res.status(404).json({ success: false, message: "Quote not found" });
    const quote = quoteDoc.data();
    if (quote.clientId !== req.user.uid) return res.status(403).json({ success: false, message: "Not authorised" });
    if (quote.status !== "pending") return res.status(400).json({ success: false, message: `This quote is ${quote.status}` });

    const jobRef = db.collection(COLLECTIONS.JOBS).doc(quote.jobId);
    const jobDoc = await jobRef.get();
    if (!jobDoc.exists) return res.status(404).json({ success: false, message: "Job not found" });
    const job = jobDoc.data();
    if (job.status !== "open") return res.status(409).json({ success: false, message: "This job already has a provider offer in progress" });

    const now = new Date().toISOString();
    const batch = db.batch();
    batch.update(quoteDoc.ref, { status: "awaiting-provider", offeredAt: now, updatedAt: now });
    batch.update(jobRef, {
      status: "awaiting-provider",
      assignedProviderId: quote.providerId,
      assignedProviderName: quote.providerName,
      acceptedQuoteId: quote.id,
      acceptedAmount: quote.amount,
      offeredAt: now,
      updatedAt: now,
      timeline: admin.firestore.FieldValue.arrayUnion({ id: uuidv4(), type: "offered", label: `Quote accepted · offer sent to ${quote.providerName}`, note: `KES ${Number(quote.amount).toLocaleString()}`, byId: req.user.uid, byName: req.user.name, at: now }),
    });
    await batch.commit();

    // Alert the provider: live notification, saved notification, and email
    alertUser(quote.providerId, "job_offer", { jobId: quote.jobId, title: job.title, amount: quote.amount, message: `Your quote for "${job.title}" was accepted. Accept the job to start.` });
    sendQuoteAcceptedEmail({ providerEmail: quote.providerEmail, providerName: quote.providerName, job, amount: quote.amount }).catch(console.error);

    return res.json({ success: true, message: "Quote accepted. The provider has been alerted and must accept the job to start." });
  } catch (error) {
    console.error("Accept quote error:", error);
    return res.status(500).json({ success: false, message: "Could not accept quote" });
  }
});

// ── PUT /api/quotes/:id/reject ─────────────────────────────────────────────
router.put("/:id/reject", verifyJWT, async (req, res) => {
  try {
    const quoteDoc = await db.collection(COLLECTIONS.QUOTES).doc(req.params.id).get();
    if (!quoteDoc.exists) return res.status(404).json({ success: false, message: "Quote not found" });
    if (quoteDoc.data().clientId !== req.user.uid) {
      return res.status(403).json({ success: false, message: "Not authorised" });
    }
    await quoteDoc.ref.update({ status: "rejected", updatedAt: new Date().toISOString() });
    return res.json({ success: true, message: "Quote rejected" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not reject quote" });
  }
});

// ── PUT /api/quotes/:id/withdraw  (provider withdraws own quote) ──────────
router.put("/:id/withdraw", verifyJWT, async (req, res) => {
  try {
    const quoteDoc = await db.collection(COLLECTIONS.QUOTES).doc(req.params.id).get();
    if (!quoteDoc.exists) return res.status(404).json({ success: false, message: "Quote not found" });
    if (quoteDoc.data().providerId !== req.user.uid) {
      return res.status(403).json({ success: false, message: "Not authorised" });
    }
    await quoteDoc.ref.update({ status: "withdrawn", updatedAt: new Date().toISOString() });
    return res.json({ success: true, message: "Quote withdrawn" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not withdraw quote" });
  }
});

module.exports = router;
