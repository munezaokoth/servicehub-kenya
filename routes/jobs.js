const express = require("express");
const { body, validationResult } = require("express-validator");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();
const firebase = require("../config/firebase");
const { verifyJWT, optionalAuth } = require("../middleware/auth");
const { sendJobAlertEmail } = require("../services/email");
const admin = require("firebase-admin");

// ── Job tracking: every important step is added to the job's timeline ─────
function ev(type, label, user, note) {
  return { id: uuidv4(), type, label, note: note || null, byId: user ? user.uid : null, byName: user ? user.name : "ServiceHub", at: new Date().toISOString() };
}
const addEv = (e) => admin.firestore.FieldValue.arrayUnion(e);

// ── Job photos: stored as compressed images in their own documents ────────
const MAX_PHOTOS = 6;
function parsePhoto(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) return null;
  if (m[2].length > 1000000) return null; // ~750 KB image; the website compresses photos before upload
  return { mime: m[1], data: m[2] };
}
// Pinned job location: exact pin for the client and the hired provider, approximate area (~1 km) for everyone else.
function parseLocation(l) {
  if (!l || typeof l !== "object") return null;
  const lat = Number(l.lat), lng = Number(l.lng);
  if (!isFinite(lat) || !isFinite(lng) || lat < -5.5 || lat > 5.5 || lng < 33.5 || lng > 42.5) return null; // Kenya
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, label: String(l.label || "").slice(0, 200) || null, accuracy: isFinite(Number(l.accuracy)) ? Math.round(Number(l.accuracy)) : null, pinnedAt: new Date().toISOString() };
}
function approxLocation(l) {
  if (!l) return null;
  return { lat: Math.round(l.lat * 100) / 100, lng: Math.round(l.lng * 100) / 100, approximate: true };
}

async function savePhotos(jobId, dataUrls, startIndex) {
  const out = [];
  for (const d of (dataUrls || []).slice(0, MAX_PHOTOS - startIndex)) {
    const ph = parsePhoto(d);
    if (!ph) continue;
    const id = uuidv4();
    await firebase.db.collection("job_photos").doc(id).set({ id, jobId, mime: ph.mime, data: ph.data, createdAt: new Date().toISOString() });
    out.push({ id, url: `/api/jobs/${jobId}/photos/${id}` });
  }
  return out;
}

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
      const { timeline, ...rest } = d.data();
      const job = { id: d.id, ...rest };
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
    const all = req.query.include === "all";
    const jobs = snap.docs.map((d) => { const { timeline, ...rest } = d.data(); return { id: d.id, ...rest }; }).filter((j) => all ? j.status !== "cancelled" : (j.status !== "completed" && j.status !== "cancelled")).sort(byDate("updatedAt"));
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
    await doc.ref.update({ status: "pending-completion", completionRequestedAt: now, updatedAt: now, timeline: addEv(ev("completion_requested", "Provider marked the work complete · waiting for client confirmation", req.user)) });
    notify(job.clientId, "completion_requested", { jobId: doc.id, title: job.title });
    return res.json({ success: true, message: "Marked as complete. Waiting for client confirmation." });
  } catch (error) {
    console.error("Request completion error:", error);
    return res.status(500).json({ success: false, message: "Could not mark job complete" });
  }
});

async function completeJob(doc, job, user) {
    const now = new Date().toISOString();
    const batch = firebase.db.batch();
    batch.update(doc.ref, { status: "completed", completedAt: now, updatedAt: now, timeline: addEv(ev("completed", "Job completed", user)) });
    if (job.assignedProviderId) {
      batch.update(firebase.db.collection(firebase.COLLECTIONS.USERS).doc(job.assignedProviderId), { jobsCompleted: admin.firestore.FieldValue.increment(1) });
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
    batch.update(doc.ref, { status: "in-progress", providerAcceptedAt: now, startedAt: now, plannedStartDate: startDate, updatedAt: now, timeline: addEv(ev("provider_accepted", "Provider accepted the job", req.user, `Planned start: ${startDate}`)) });
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
    batch.update(doc.ref, { status: "open", assignedProviderId: null, assignedProviderName: null, acceptedQuoteId: null, acceptedAmount: null, offeredAt: null, updatedAt: now, timeline: addEv(ev("provider_declined", "Provider declined the job · open for other quotes", req.user)) });
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
    await completeJob(doc, job, req.user);
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
    await completeJob(doc, job, req.user);
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
    await doc.ref.update({ status: "in-progress", completionDisputedAt: now, disputeReason: (req.body && req.body.reason) || null, updatedAt: now, timeline: addEv(ev("disputed", "Client disputed completion · job back in progress", req.user, (req.body && req.body.reason) || null)) });
    notify(job.assignedProviderId, "completion_disputed", { jobId: doc.id, title: job.title });
    return res.json({ success: true, message: "Completion disputed. Job reverted to in-progress." });
  } catch (error) {
    console.error("Reject completion error:", error);
    return res.status(500).json({ success: false, message: "Could not dispute completion" });
  }
});

// ── Photos ─────────────────────────────────────────────────────────────────
router.get("/:id/photos/:pid", async (req, res) => {
  try {
    const d = await firebase.db.collection("job_photos").doc(req.params.pid).get();
    if (!d.exists || d.data().jobId !== req.params.id) return res.status(404).end();
    const ph = d.data();
    res.setHeader("Content-Type", ph.mime);
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    return res.end(Buffer.from(ph.data, "base64"));
  } catch (e) { return res.status(500).end(); }
});

router.post("/:id/photos", verifyJWT, async (req, res) => {
  try {
    const doc = await loadJob(req, res); if (!doc) return;
    const job = doc.data();
    if (job.clientId !== req.user.uid) return res.status(403).json({ success: false, message: "Only the client can add photos" });
    if (job.status === "completed" || job.status === "cancelled") return res.status(400).json({ success: false, message: "This job is closed" });
    const existing = job.photos || [];
    if (existing.length >= MAX_PHOTOS) return res.status(400).json({ success: false, message: `A job can have up to ${MAX_PHOTOS} photos` });
    const added = await savePhotos(doc.id, req.body.photos, existing.length);
    if (!added.length) return res.status(422).json({ success: false, message: "No valid photos received" });
    await doc.ref.update({ photos: [...existing, ...added], updatedAt: new Date().toISOString(), timeline: addEv(ev("photos", "Photos added", req.user, `${added.length} photo(s)`)) });
    return res.json({ success: true, photos: [...existing, ...added] });
  } catch (error) {
    console.error("Add photos error:", error);
    return res.status(500).json({ success: false, message: "Could not add photos" });
  }
});

router.delete("/:id/photos/:pid", verifyJWT, async (req, res) => {
  try {
    const doc = await loadJob(req, res); if (!doc) return;
    const job = doc.data();
    if (job.clientId !== req.user.uid) return res.status(403).json({ success: false, message: "Not authorised" });
    const photos = (job.photos || []).filter((p) => p.id !== req.params.pid);
    await doc.ref.update({ photos, updatedAt: new Date().toISOString() });
    firebase.db.collection("job_photos").doc(req.params.pid).delete().catch(() => {});
    return res.json({ success: true, photos });
  } catch (e) { return res.status(500).json({ success: false, message: "Could not remove photo" }); }
});

// ── Tracking ───────────────────────────────────────────────────────────────
const PROGRESS = {
  on_the_way: "Provider is on the way",
  arrived: "Provider has arrived",
  started: "Work started",
  materials: "Buying materials",
  paused: "Work paused",
  resumed: "Work resumed",
  note: "Progress update",
};

router.get("/:id/track", verifyJWT, async (req, res) => {
  try {
    const doc = await loadJob(req, res); if (!doc) return;
    const job = doc.data();
    if (req.user.uid !== job.clientId && req.user.uid !== job.assignedProviderId) return res.status(403).json({ success: false, message: "Only the client and the assigned provider can track this job" });
    let timeline = job.timeline || [];
    // older jobs: rebuild the main steps from their dates
    if (!timeline.length) {
      const t = (type, label, at, byName) => at && { id: type, type, label, at, byName: byName || null };
      timeline = [t("posted", "Job posted", job.createdAt, job.clientName), t("offered", "Quote accepted · offer sent to provider", job.offeredAt, job.clientName),
        t("provider_accepted", "Provider accepted the job", job.providerAcceptedAt, job.assignedProviderName), t("completion_requested", "Provider marked the work complete", job.completionRequestedAt, job.assignedProviderName),
        t("completed", "Job completed", job.completedAt, job.clientName)].filter(Boolean);
    }
    timeline = [...timeline].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const { timeline: _t, ...rest } = job;
    return res.json({ success: true, job: { id: doc.id, ...rest }, timeline, progressOptions: PROGRESS });
  } catch (error) {
    console.error("Track job error:", error);
    return res.status(500).json({ success: false, message: "Could not load job tracking" });
  }
});

router.post("/:id/updates", verifyJWT, async (req, res) => {
  try {
    const doc = await loadJob(req, res); if (!doc) return;
    const job = doc.data();
    const isProvider = req.user.uid === job.assignedProviderId, isClient = req.user.uid === job.clientId;
    if (!isProvider && !isClient) return res.status(403).json({ success: false, message: "Not authorised" });
    if (!["in-progress", "pending-completion"].includes(job.status)) return res.status(400).json({ success: false, message: "Updates can be posted once the job has started" });
    const code = String((req.body && req.body.code) || "note");
    if (!PROGRESS[code] || (!isProvider && code !== "note")) return res.status(422).json({ success: false, message: "Unknown update" });
    const note = String((req.body && req.body.note) || "").trim().slice(0, 300);
    if (code === "note" && !note) return res.status(422).json({ success: false, message: "Write a short note" });
    const e = ev(code, PROGRESS[code], req.user, note || null);
    await doc.ref.update({ timeline: addEv(e), lastUpdate: e, updatedAt: e.at });
    notify(isProvider ? job.clientId : job.assignedProviderId, "job_update", { jobId: doc.id, title: job.title, message: `${job.title}: ${e.label}${note ? " · " + note : ""}` });
    return res.json({ success: true, event: e });
  } catch (error) {
    console.error("Job update error:", error);
    return res.status(500).json({ success: false, message: "Could not post the update" });
  }
});

router.get("/", optionalAuth, async (req, res) => {
  try {
    const { category, county, subcounty, budgetMin, budgetMax, status = "open", limit = 20, search } = req.query;
    let q = firebase.db.collection(firebase.COLLECTIONS.JOBS);
    const wanted = (!status || status === "all" || status === "completed" || status === "cancelled") ? "open" : status;
    q = q.where("status", "==", wanted); // completed jobs are private to the client who posted them
    const snapshot = await q.limit(500).get();
    let jobs = snapshot.docs.map((doc) => { const { timeline, location, ...rest } = doc.data(); return { id: doc.id, ...rest, location: approxLocation(location), hasPin: !!location }; });
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
    const { timeline, location, ...pub } = job;
    const insider = req.user && (req.user.uid === job.clientId || req.user.uid === job.assignedProviderId);
    return res.json({ success: true, job: { id: doc.id, ...(insider ? job : { ...pub, location: approxLocation(location), hasPin: !!location }) } });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not fetch job" });
  }
});

router.post("/", verifyJWT, [body("title").trim().notEmpty(), body("description").trim().notEmpty(), body("category").notEmpty(), body("county").notEmpty(), body("budgetMin").isNumeric(), body("budgetMax").isNumeric()], async (req, res) => {
  const err = validationErrors(req, res);
  if (err) return;
  const { title, description, category, county, subcounty, budgetMin, budgetMax, urgency, photos } = req.body;
  const location = parseLocation(req.body.location);
  try {
    const jobId = uuidv4();
    const now = new Date().toISOString();
    const savedPhotos = await savePhotos(jobId, photos, 0);
    const jobData = { id: jobId, title, description, category, county, subcounty: subcounty || null, budgetMin: parseInt(budgetMin), budgetMax: parseInt(budgetMax), urgency: urgency || "normal", photos: savedPhotos, location, status: "open", clientId: req.user.uid, clientName: req.user.name, clientEmail: req.user.email, quotesCount: 0, views: 0, createdAt: now, updatedAt: now,
      timeline: [ev("posted", "Job posted", req.user, savedPhotos.length ? `${savedPhotos.length} photo(s) attached` : null)] };
    await firebase.db.collection(firebase.COLLECTIONS.JOBS).doc(jobId).set(jobData);
    firebase.db.collection(firebase.COLLECTIONS.USERS).doc(req.user.uid).update({ jobsPosted: admin.firestore.FieldValue.increment(1) }).catch(() => {});
    return res.status(201).json({ success: true, message: "Job posted successfully", job: jobData });
  } catch (error) {
    console.error("Post job error:", error);
    return res.status(500).json({ success: false, message: "Could not post job" });
  }
});

// Client pins / moves / removes the job location
router.put("/:id/location", verifyJWT, async (req, res) => {
  try {
    const doc = await firebase.db.collection(firebase.COLLECTIONS.JOBS).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ success: false, message: "Job not found" });
    const job = doc.data();
    if (job.clientId !== req.user.uid) return res.status(403).json({ success: false, message: "Only the client can pin the job location" });
    if (job.status === "completed" || job.status === "cancelled") return res.status(400).json({ success: false, message: "This job is closed" });
    const clear = req.body && req.body.location === null;
    const location = clear ? null : parseLocation(req.body && req.body.location);
    if (!clear && !location) return res.status(422).json({ success: false, message: "Pin a location inside Kenya" });
    await doc.ref.update({ location, updatedAt: new Date().toISOString(), timeline: addEv(ev("location", clear ? "Location pin removed" : "Location pinned", req.user, location && location.label)) });
    if (job.assignedProviderId) notify(job.assignedProviderId, "location_updated", { jobId: doc.id, title: job.title, message: `The client ${clear ? "removed" : "updated"} the location for "${job.title}"` });
    return res.json({ success: true, location });
  } catch (error) {
    console.error("Pin location error:", error);
    return res.status(500).json({ success: false, message: "Could not save the location" });
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
    await doc.ref.update({ status: "cancelled", updatedAt: new Date().toISOString(), timeline: addEv(ev("cancelled", "Job cancelled", req.user)) });
    return res.json({ success: true, message: "Job cancelled successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not cancel job" });
  }
});

module.exports = router;
