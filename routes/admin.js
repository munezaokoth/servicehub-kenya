// routes/admin.js
// ServiceHub Kenya - Admin portal API (/api/admin/...)
// Only the admin account (see utils/admin.js) can use these. Every request re-checks the account
// in the database, so a suspended or changed account loses access immediately.

const express = require("express");
const router = express.Router();
const firebase = require("../config/firebase");
const { verifyJWT, forgetSession } = require("../middleware/auth");
const { isAdminUser, ADMIN_PHONES } = require("../utils/admin");
const { rolesOf, activeRoleOf, PROVIDER } = require("../utils/roles");

const C = () => firebase.COLLECTIONS;
const col = (name) => firebase.db.collection(name);
const MAX = 3000;

async function requireAdmin(req, res, next) {
  try {
    const doc = await col(C().USERS).doc(req.user.uid).get();
    if (!doc.exists || !isAdminUser(doc.data())) {
      return res.status(403).json({ success: false, code: "NOT_ADMIN", message: "This account is not an admin" });
    }
    req.admin = doc.data();
    next();
  } catch (e) {
    console.error("Admin check error:", e.message);
    res.status(500).json({ success: false, message: "Could not check admin access" });
  }
}

router.use(verifyJWT, requireAdmin);

function publicUser(u) {
  const { passwordHash, verifyToken, verifyTokenExpires, ...rest } = u;
  return { ...rest, roles: rolesOf(u), role: activeRoleOf(u), isAdmin: isAdminUser(u) };
}
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const byNewest = (a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
async function all(name) {
  const snap = await col(name).limit(MAX).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ── Who am I ────────────────────────────────────────────────────────────
router.get("/me", (req, res) => {
  res.json({ success: true, admin: { uid: req.admin.uid, name: req.admin.name, email: req.admin.email, phone: req.admin.phone || null, adminPhones: ADMIN_PHONES } });
});

// ── Overview numbers ────────────────────────────────────────────────────
router.get("/overview", async (req, res) => {
  try {
    const [users, jobs, quotes, convs, msgs] = await Promise.all([
      all(C().USERS), all(C().JOBS), all(C().QUOTES), all(C().CONVERSATIONS), all("contact_messages").catch(() => []),
    ]);
    const d7 = daysAgo(7), d30 = daysAgo(30);
    const jobStatus = {};
    jobs.forEach((j) => { jobStatus[j.status || "unknown"] = (jobStatus[j.status || "unknown"] || 0) + 1; });
    const counties = {};
    jobs.forEach((j) => { if (j.county) counties[j.county] = (counties[j.county] || 0) + 1; });
    const categories = {};
    jobs.forEach((j) => { if (j.category) categories[j.category] = (categories[j.category] || 0) + 1; });
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
    res.json({
      success: true,
      overview: {
        users: {
          total: users.length,
          providers: users.filter((u) => rolesOf(u).includes(PROVIDER)).length,
          clientsOnly: users.filter((u) => !rolesOf(u).includes(PROVIDER)).length,
          suspended: users.filter((u) => u.active === false).length,
          unverified: users.filter((u) => u.emailVerified !== true).length,
          new7: users.filter((u) => String(u.createdAt || "") >= d7).length,
          new30: users.filter((u) => String(u.createdAt || "") >= d30).length,
        },
        jobs: { total: jobs.length, byStatus: jobStatus, new7: jobs.filter((j) => String(j.createdAt || "") >= d7).length, topCounties: top(counties), topCategories: top(categories) },
        quotes: { total: quotes.length, accepted: quotes.filter((q) => q.status === "accepted").length, new7: quotes.filter((q) => String(q.createdAt || "") >= d7).length },
        conversations: convs.length,
        contactMessages: { total: msgs.length, open: msgs.filter((m) => !m.handled).length },
        recentUsers: users.sort(byNewest).slice(0, 6).map((u) => ({ uid: u.uid || u.id, name: u.name, email: u.email, roles: rolesOf(u), createdAt: u.createdAt })),
        recentJobs: jobs.sort(byNewest).slice(0, 6).map((j) => ({ id: j.id, title: j.title, county: j.county, status: j.status, clientName: j.clientName, createdAt: j.createdAt })),
      },
    });
  } catch (e) {
    console.error("Admin overview error:", e);
    res.status(500).json({ success: false, message: "Could not load the overview" });
  }
});

// ── Users ───────────────────────────────────────────────────────────────
router.get("/users", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    const filter = String(req.query.filter || "all");
    let users = (await all(C().USERS)).map(publicUser);
    if (q) users = users.filter((u) => [u.name, u.email, u.phone, u.county, u.subcounty, (u.skills || []).join(" ")].join(" ").toLowerCase().includes(q));
    if (filter === "providers") users = users.filter((u) => u.roles.includes(PROVIDER));
    if (filter === "clients") users = users.filter((u) => !u.roles.includes(PROVIDER));
    if (filter === "suspended") users = users.filter((u) => u.active === false);
    if (filter === "unverified") users = users.filter((u) => u.emailVerified !== true);
    users.sort(byNewest);
    res.json({ success: true, total: users.length, users: users.slice(0, 500) });
  } catch (e) {
    console.error("Admin users error:", e);
    res.status(500).json({ success: false, message: "Could not load users" });
  }
});

router.get("/users/:uid", async (req, res) => {
  try {
    const doc = await col(C().USERS).doc(req.params.uid).get();
    if (!doc.exists) return res.status(404).json({ success: false, message: "User not found" });
    const uid = req.params.uid;
    const [posted, assigned, quotes] = await Promise.all([
      col(C().JOBS).where("clientId", "==", uid).get(),
      col(C().JOBS).where("assignedProviderId", "==", uid).get(),
      col(C().QUOTES).where("providerId", "==", uid).get(),
    ]);
    res.json({
      success: true,
      user: publicUser(doc.data()),
      jobsPosted: posted.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byNewest).map((j) => ({ id: j.id, title: j.title, status: j.status, county: j.county, createdAt: j.createdAt })),
      jobsWorked: assigned.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byNewest).map((j) => ({ id: j.id, title: j.title, status: j.status, county: j.county, createdAt: j.createdAt })),
      quotesSent: quotes.size,
    });
  } catch (e) {
    console.error("Admin user error:", e);
    res.status(500).json({ success: false, message: "Could not load this user" });
  }
});

// { active?: bool, emailVerified?: bool, provider?: bool }
router.patch("/users/:uid", async (req, res) => {
  try {
    const ref = col(C().USERS).doc(req.params.uid);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ success: false, message: "User not found" });
    const u = doc.data();
    const b = req.body || {};
    const updates = { updatedAt: new Date().toISOString() };
    if (typeof b.active === "boolean") {
      if (req.params.uid === req.admin.uid && b.active === false) return res.status(400).json({ success: false, message: "You can't suspend your own admin account" });
      updates.active = b.active;
      updates[b.active ? "reactivatedAt" : "suspendedAt"] = updates.updatedAt;
    }
    if (typeof b.emailVerified === "boolean") updates.emailVerified = b.emailVerified;
    if (typeof b.provider === "boolean") {
      const roles = new Set(rolesOf(u));
      if (b.provider) roles.add(PROVIDER); else roles.delete(PROVIDER);
      updates.roles = Array.from(roles);
      if (!b.provider && u.role === PROVIDER) updates.role = "client";
    }
    await ref.update(updates);
    forgetSession(req.params.uid); // a suspension takes effect on the very next request
    if (updates.active === false && global.io) global.io.in(`user:${req.params.uid}`).disconnectSockets(true);
    res.json({ success: true, user: publicUser({ ...u, ...updates }) });
  } catch (e) {
    console.error("Admin update user error:", e);
    res.status(500).json({ success: false, message: "Could not update this user" });
  }
});

// ── Jobs ────────────────────────────────────────────────────────────────
router.get("/jobs", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    const status = String(req.query.status || "all");
    let jobs = await all(C().JOBS);
    if (status !== "all") jobs = jobs.filter((j) => j.status === status);
    if (q) jobs = jobs.filter((j) => [j.title, j.description, j.county, j.subcounty, j.category, j.clientName, j.assignedProviderName].join(" ").toLowerCase().includes(q));
    jobs.sort(byNewest);
    res.json({
      success: true, total: jobs.length,
      jobs: jobs.slice(0, 500).map((j) => ({
        id: j.id, title: j.title, category: j.category, county: j.county, subcounty: j.subcounty, status: j.status,
        budgetMin: j.budgetMin, budgetMax: j.budgetMax, clientId: j.clientId, clientName: j.clientName,
        assignedProviderId: j.assignedProviderId || null, assignedProviderName: j.assignedProviderName || null,
        quotesCount: j.quotesCount || 0, photos: (j.photos || []).length, createdAt: j.createdAt,
      })),
    });
  } catch (e) {
    console.error("Admin jobs error:", e);
    res.status(500).json({ success: false, message: "Could not load jobs" });
  }
});

router.get("/jobs/:id", async (req, res) => {
  try {
    const doc = await col(C().JOBS).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ success: false, message: "Job not found" });
    const quotes = await col(C().QUOTES).where("jobId", "==", req.params.id).get();
    const j = doc.data();
    const { photos, ...job } = j;
    res.json({ success: true, job: { id: doc.id, ...job, photosCount: (photos || []).length }, quotes: quotes.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byNewest) });
  } catch (e) {
    console.error("Admin job error:", e);
    res.status(500).json({ success: false, message: "Could not load this job" });
  }
});

// Cancel a job (spam, fraud, duplicates). Kept for the record.
router.post("/jobs/:id/cancel", async (req, res) => {
  try {
    const ref = col(C().JOBS).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ success: false, message: "Job not found" });
    const now = new Date().toISOString();
    const reason = String((req.body && req.body.reason) || "Removed by ServiceHub admin").slice(0, 300);
    await ref.update({ status: "cancelled", cancelledAt: now, cancelledBy: "admin", cancelReason: reason, updatedAt: now });
    const io = global.io;
    const j = doc.data();
    if (io && j.clientId) io.to(`user:${j.clientId}`).emit("notification", { type: "job_cancelled", jobId: req.params.id, message: `Your job "${j.title}" was removed by ServiceHub: ${reason}` });
    res.json({ success: true });
  } catch (e) {
    console.error("Admin cancel job error:", e);
    res.status(500).json({ success: false, message: "Could not cancel this job" });
  }
});

// Delete a job and its quotes for good (spam).
router.delete("/jobs/:id", async (req, res) => {
  try {
    const ref = col(C().JOBS).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ success: false, message: "Job not found" });
    const quotes = await col(C().QUOTES).where("jobId", "==", req.params.id).get();
    const batch = firebase.db.batch();
    quotes.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(ref);
    await batch.commit();
    res.json({ success: true });
  } catch (e) {
    console.error("Admin delete job error:", e);
    res.status(500).json({ success: false, message: "Could not delete this job" });
  }
});

// ── Contact form messages ───────────────────────────────────────────────
router.get("/messages", async (req, res) => {
  try {
    const msgs = (await all("contact_messages")).sort(byNewest);
    res.json({ success: true, messages: msgs.slice(0, 500) });
  } catch (e) {
    console.error("Admin messages error:", e);
    res.status(500).json({ success: false, message: "Could not load messages" });
  }
});

router.patch("/messages/:id", async (req, res) => {
  try {
    const handled = !!(req.body && req.body.handled);
    await col("contact_messages").doc(req.params.id).update({ handled, handledAt: handled ? new Date().toISOString() : null });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: "Could not update this message" });
  }
});

module.exports = router;
