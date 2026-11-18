const express = require("express");
const { body, validationResult } = require("express-validator");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();
const firebase = require("../config/firebase");
const { verifyJWT, optionalAuth } = require("../middleware/auth");
const { sendJobAlertEmail } = require("../services/email");
const admin = require("firebase-admin");

// Real-time notification if the socket server is up (never blocks the request)
function notify(uid, type, data) {
  if (!uid) return;
  try { const { getIO } = require("../utils/socket"); const io = getIO && getIO(); if (io) io.to(`user:${uid}`).emit("notification", { type, ...data }); } catch (e) {}
  firebase.db.collection(firebase.COLLECTIONS.NOTIFICATIONS).add({ userId: uid, type, ...data, read: false, createdAt: new Date().toISOString() }).catch(() => {});
}

// Sort in memory so no Firestore composite indexes are needed on a fresh project
const byDate = (key = "createdAt", dir = "desc") => (a, b) => dir === "desc" ? String(b[key] || "").localeCompare(String(a[key] || "")) : String(a[key] || "").localeCompare(String(b[key] || ""));

function validationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, errors: errors.array() });
  return null;
}

router.get("/my/posted", verifyJWT, async (req, res) => {
  try {
    const [snap, qSnap] = await Promise.all([
      firebase.db.collection(firebase.COLLECTIONS.JOBS).where("clientId", "==", req.user.uid).get(),
      firebase.db.collection(firebase.COLLECTIONS.QUOTES).where("clientId", "==", req.user.uid).get(),
    ]);
    const byJob = {};
    qSnap.docs.forEach((d) => { const q = { id: d.id, ...d.data() }; (byJob[q.jobId] = byJob[q.jobId] || []).push(q); });
    const jobs = snap.docs.map((d) => {
      const job = { id: d.id, ...d.data() };
      const quotes = (byJob[job.id] || []).filter((q) => q.status !== "withdrawn").sort((a, b) => Number(a.amount || 0) - Number(b.amount || 0));
      job.quotesCount = quotes.length;
      job.quotes = job.status === "completed" ? [] : quotes; // quotes are shown until the job is completed
      return job;
    }).filter((j) => j.status !== "cancelled").sort(byDate());
    return res.json({ success: true, jobs });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not fetch your jobs" });
  }
});

// ── Provider: jobs assigned to me ─────────────────────────────────────────
router.get("/my/assigned", verifyJWT, async (req, res) => {
  try {
    const snap = await firebase.db.collection(firebase.COLLECTIONS.JOBS).where("assignedProviderId", "==", req.user.uid).get();
    const jobs = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((j) => j.status !== "completed" && j.status !== "cancelled").sort(byDate("updatedAt"));
    return res.json({ success: true, jobs });
  } catch (error) {
    console.error("Assigned jobs error:", error);
    return res.status(500).json({ success: false, message: "Could not fetch your assigned jobs" });
  }
});

async function loadJob(req, res) {
  const doc = await firebase.db.collection(firebase.COLLECTIONS.JOBS).doc(req.params.id).get();
  if (!doc.exists) { res.status(404).json({ success: false, message: "Job not found" }); return null; }
  return doc;
}

// ── Provider: mark job complete (client must confirm) ─────────────────────
router.put("/:id/request-completion", verifyJWT, async (req, res) => {
  try {
    const doc = await loadJob(req, res); if (!doc) return;
    const job = doc.data();
    if (job.assignedProviderId !== req.user.uid) return res.status(403).json({ success: false, message: "Only the assigned provider can mark this job complete" });
    if (job.status !== "in-progress") return res.status(400).json({ success: false, message: `Job is ${job.status}, not in progress` });
    const now = new Date().toISOString();
    await doc.ref.update({ status: "pending-completion", completionRequestedAt: now, updatedAt: now });
    notify(job.clientId, "completion_requested", { jobId: doc.id, title: job.title });
    return res.json({ success: true, message: "Marked as complete. Waiting for client confirmation." });
  } catch (error) {
    console.error("Request completion error:", error);
    return res.status(500).json({ success: false, message: "Could not mark job complete" });
  }
});

async function completeJob(doc, job) {
    const now = new Date().toISOString();
    const amount = Number(job.acceptedAmount || 0);
    const share = parseFloat(process.env.PROVIDER_SHARE || "0.8");
    const batch = firebase.db.batch();
    batch.update(doc.ref, { status: "completed", completedAt: now, updatedAt: now });
    if (job.assignedProviderId) {
      batch.update(firebase.db.collection(firebase.COLLECTIONS.USERS).doc(job.assignedProviderId), { jobsCompleted: admin.firestore.FieldValue.increment(1) });
      const payoutId = uuidv4();
      batch.set(firebase.db.collection(firebase.COLLECTIONS.PAYOUTS).doc(payoutId), {
        id: payoutId, jobId: doc.id, jobTitle: job.title, providerId: job.assignedProviderId, providerName: job.assignedProviderName || null,
        jobAmount: amount, providerShare: share, payoutAmount: Math.round(amount * share), paymentStatus: job.paymentStatus || "unpaid",
        status: "pending", createdAt: now, updatedAt: now,
      });
    }
    // close any quotes still pending
    const pend = await firebase.db.collection(firebase.COLLECTIONS.QUOTES).where("jobId", "==", doc.id).get();
    pend.docs.forEach((q) => { if (q.data().status === "pending") batch.update(q.ref, { status: "closed", updatedAt: now }); });
    await batch.commit();
    notify(job.assignedProviderId, "completion_confirmed", { jobId: doc.id, title: job.title });
}

// ── Provider: accept the job offer → job commences ────────────────────────
router.put("/:id/provider-accept", verifyJWT, async (req, res) => {
  try {
    const doc = await loadJob(req, res); if (!doc) return;
    const job = doc.data();
    if (job.assignedProviderId !== req.user.uid) return res.status(403).json({ success: false, message: "This job was not offered to you" });
    if (job.status !== "awaiting-provider") return res.status(400).json({ success: false, message: `This job is ${job.status}` });
    const now = new Date().toISOString();
    const startDate = (req.body && req.body.startDate) || now.slice(0, 10);
    const batch = firebase.db.batch();
    batch.update(doc.ref, { status: "in-progress", providerAcceptedAt: now, startedAt: now, plannedStartDate: startDate, updatedAt: now });
    const qs = await firebase.db.collection(firebase.COLLECTIONS.QUOTES).where("jobId", "==", doc.id).get();
    qs.docs.forEach((q) => {
      if (q.id === job.acceptedQuoteId) batch.update(q.ref, { status: "accepted", updatedAt: now });
      else if (q.data().status === "pending") batch.update(q.ref, { status: "rejected", updatedAt: now });
    });

    // Commencement: open (or reuse) a job conversation between client and provider with a kickoff message
    const convs = await firebase.db.collection(firebase.COLLECTIONS.CONVERSATIONS).where("participants", "array-contains", req.user.uid).get();
    let conv = convs.docs.find((d) => d.data().participants.includes(job.clientId));
    let convId = conv ? conv.id : uuidv4();
    const kickoff = `Job started: "${job.title}". ${req.user.name} accepted the job for KES ${Number(job.acceptedAmount || 0).toLocaleString()} and plans to start on ${startDate}. Use this chat to agree on access, materials and timing.`;
    if (!conv) {
      batch.set(firebase.db.collection(firebase.COLLECTIONS.CONVERSATIONS).doc(convId), {
        id: convId, participants: [job.clientId, req.user.uid], participantNames: { [job.clientId]: job.clientName || "Client", [req.user.uid]: req.user.name },
        jobId: doc.id, lastMessage: kickoff.slice(0, 100), lastMessageAt: now, lastMessageSenderId: req.user.uid, unreadCount: { [job.clientId]: 1, [req.user.uid]: 0 }, createdAt: now,
      });
    } else {
      batch.update(conv.ref, { jobId: doc.id, lastMessage: kickoff.slice(0, 100), lastMessageAt: now, lastMessageSenderId: req.user.uid, [`unreadCount.${job.clientId}`]: admin.firestore.FieldValue.increment(1) });
    }
    const msgId = uuidv4();
    batch.set(firebase.db.collection(firebase.COLLECTIONS.MESSAGES).doc(msgId), { id: msgId, conversationId: convId, senderId: req.user.uid, senderName: req.user.name, text: kickoff, system: true, read: false, createdAt: now });
    batch.update(doc.ref, { conversationId: convId });
    await batch.commit();

    notify(job.clientId, "job_started", { jobId: doc.id, title: job.title, message: `${req.user.name} accepted your job "${job.title}" and will start on ${startDate}.` });
    return res.json({ success: true, message: "Job accepted. The client has been notified and a job chat has been opened.", conversationId: convId });
  } catch (error) {
    console.error("Provider accept error:", error);
    return res.status(500).json({ success: false, message: "Could not accept the job" });
  }
});

// ── Provider: decline the job offer → job reopens for other quotes ────────
router.put("/:id/provider-decline", verifyJWT, async (req, res) => {
  try {
    const doc = await loadJob(req, res); if (!doc) return;
    const job = doc.data();
    if (job.assignedProviderId !== req.user.uid) return res.status(403).json({ success: false, message: "This job was not offered to you" });
    if (job.status !== "awaiting-provider") return res.status(400).json({ success: false, message: `This job is ${job.status}` });
    const now = new Date().toISOString();
    const batch = firebase.db.batch();
    batch.update(doc.ref, { status: "open", assignedProviderId: null, assignedProviderName: null, acceptedQuoteId: null, acceptedAmount: null, offeredAt: null, updatedAt: now });
    if (job.acceptedQuoteId) batch.update(firebase.db.collection(firebase.COLLECTIONS.QUOTES).doc(job.acceptedQuoteId), { status: "declined-by-provider", declineReason: (req.body && req.body.reason) || null, updatedAt: now });
    await batch.commit();
    notify(job.clientId, "offer_declined", { jobId: doc.id, title: job.title, message: `${req.user.name} declined your job "${job.title}". You can accept another quote.` });
    return res.json({ success: true, message: "Job declined. The client can choose another quote." });
  } catch (error) {
    console.error("Provider decline error:", error);
    return res.status(500).json({ success: false, message: "Could not decline the job" });
  }
});

// ── Client: confirm a completion the provider requested ───────────────────
router.put("/:id/confirm-completion", verifyJWT, async (req, res) => {
  try {
    const doc = await loadJob(req, res); if (!doc) return;
    const job = doc.data();
    if (job.clientId !== req.user.uid) return res.status(403).json({ success: false, message: "Only the client can confirm completion" });
    if (job.status !== "pending-completion") return res.status(400).json({ success: false, message: "The provider has not marked this job complete yet" });
    await completeJob(doc, job);
    return res.json({ success: true, message: "Job confirmed as completed. Payment released." });
  } catch (error) {
    console.error("Confirm completion error:", error);
    return res.status(500).json({ success: false, message: "Could not confirm completion" });
  }
});

// ── Client: mark own job as completed at any time ─────────────────────────
router.put("/:id/complete", verifyJWT, async (req, res) => {
  try {
    const doc = await loadJob(req, res); if (!doc) return;
    const job = doc.data();
    if (job.clientId !== req.user.uid) return res.status(403).json({ success: false, message: "Only the client who posted this job can mark it completed" });
    if (job.status === "completed") return res.status(400).json({ success: false, message: "This job is already completed" });
    if (job.status === "cancelled") return res.status(400).json({ success: false, message: "This job was cancelled" });
    await completeJob(doc, job);
    return res.json({ success: true, message: "Job marked as completed." });
  } catch (error) {
    console.error("Complete job error:", error);
    return res.status(500).json({ success: false, message: "Could not mark the job as completed" });
  }
});

// ── Client: dispute completion → back to in-progress ──────────────────────
router.put("/:id/reject-completion", verifyJWT, async (req, res) => {
  try {
    const doc = await loadJob(req, res); if (!doc) return;
    const job = doc.data();
    if (job.clientId !== req.user.uid) return res.status(403).json({ success: false, message: "Only the client can dispute completion" });
    if (job.status !== "pending-completion") return res.status(400).json({ success: false, message: "There is no completion to dispute" });
    const now = new Date().toISOString();
    await doc.ref.update({ status: "in-progress", completionDisputedAt: now, disputeReason: (req.body && req.body.reason) || null, updatedAt: now });
    notify(job.assignedProviderId, "completion_disputed", { jobId: doc.id, title: job.title });
    return res.json({ success: true, message: "Completion disputed. Job reverted to in-progress." });
  } catch (error) {
    console.error("Reject completion error:", error);
    return res.status(500).json({ success: false, message: "Could not dispute completion" });
  }
});

router.get("/", optionalAuth, async (req, res) => {
  try {
    const { category, county, subcounty, budgetMin, budgetMax, status = "open", limit = 20, search } = req.query;
    let q = firebase.db.collection(firebase.COLLECTIONS.JOBS);
    const wanted = (!status || status === "all" || status === "completed" || status === "cancelled") ? "open" : status;
    q = q.where("status", "==", wanted); // completed jobs are private to the client who posted them
    const snapshot = await q.limit(500).get();
    let jobs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    if (category && category !== "all") jobs = jobs.filter((j) => j.category === category);
    if (county && county !== "all") jobs = jobs.filter((j) => j.county === county);
    if (subcounty && subcounty !== "all") jobs = jobs.filter((j) => j.subcounty === subcounty);
    if (budgetMin) jobs = jobs.filter((j) => j.budgetMax >= parseInt(budgetMin));
    if (budgetMax) jobs = jobs.filter((j) => j.budgetMin <= parseInt(budgetMax));
    if (search) { const kw = search.toLowerCase(); jobs = jobs.filter((j) => j.title?.toLowerCase().includes(kw) || j.description?.toLowerCase().includes(kw)); }
    jobs = jobs.sort(byDate()).slice(0, Math.min(parseInt(limit) || 20, 100));
    return res.json({ success: true, count: jobs.length, jobs });
  } catch (error) {
    console.error("Get jobs error:", error);
    return res.status(500).json({ success: false, message: "Could not fetch jobs" });
  }
});

router.get("/:id", optionalAuth, async (req, res) => {
  try {
    const doc = await firebase.db.collection(firebase.COLLECTIONS.JOBS).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ success: false, message: "Job not found" });
    const job = doc.data();
    if ((job.status === "completed" || job.status === "cancelled") && (!req.user || req.user.uid !== job.clientId)) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }
    doc.ref.update({ views: (job.views || 0) + 1 }).catch(() => {});
    return res.json({ success: true, job: { id: doc.id, ...job } });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not fetch job" });
  }
});

router.post("/", verifyJWT, [body("title").trim().notEmpty(), body("description").trim().notEmpty(), body("category").notEmpty(), body("county").notEmpty(), body("budgetMin").isNumeric(), body("budgetMax").isNumeric()], async (req, res) => {
  const err = validationErrors(req, res);
  if (err) return;
  const { title, description, category, county, subcounty, budgetMin, budgetMax, urgency, images } = req.body;
  try {
    const jobId = uuidv4();
    const now = new Date().toISOString();
    const jobData = { id: jobId, title, description, category, county, subcounty: subcounty || null, budgetMin: parseInt(budgetMin), budgetMax: parseInt(budgetMax), urgency: urgency || "normal", images: images || [], status: "open", clientId: req.user.uid, clientName: req.user.name, clientEmail: req.user.email, quotesCount: 0, views: 0, createdAt: now, updatedAt: now };
    await firebase.db.collection(firebase.COLLECTIONS.JOBS).doc(jobId).set(jobData);
    firebase.db.collection(firebase.COLLECTIONS.USERS).doc(req.user.uid).update({ jobsPosted: admin.firestore.FieldValue.increment(1) }).catch(() => {});
    return res.status(201).json({ success: true, message: "Job posted successfully", job: jobData });
  } catch (error) {
    console.error("Post job error:", error);
    return res.status(500).json({ success: false, message: "Could not post job" });
  }
});

router.put("/:id", verifyJWT, async (req, res) => {
  try {
    const doc = await firebase.db.collection(firebase.COLLECTIONS.JOBS).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ success: false, message: "Job not found" });
    if (doc.data().clientId !== req.user.uid) return res.status(403).json({ success: false, message: "Not authorised" });
    const allowed = ["title", "description", "budgetMin", "budgetMax", "urgency", "status", "subcounty"];
    const updates = { updatedAt: new Date().toISOString() };
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    await doc.ref.update(updates);
    return res.json({ success: true, message: "Job updated" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not update job" });
  }
});

router.delete("/:id", verifyJWT, async (req, res) => {
  try {
    const doc = await firebase.db.collection(firebase.COLLECTIONS.JOBS).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ success: false, message: "Job not found" });
    if (doc.data().clientId !== req.user.uid) return res.status(403).json({ success: false, message: "Not authorised" });
    await doc.ref.update({ status: "cancelled", updatedAt: new Date().toISOString() });
    return res.json({ success: true, message: "Job cancelled successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not cancel job" });
  }
});

module.exports = router;
