// routes/listings.js
// ServiceHub Kenya - service listings.
// Anyone (fundis, mama mboga, boda boda riders, barbers, kiosks ... the informal sector included)
// lists the services they offer with a map pin. Clients browse and search by service and distance,
// then call, WhatsApp or message the provider directly.
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();
const firebase = require("../config/firebase");
const { verifyJWT, optionalAuth, generateToken } = require("../middleware/auth");
const { rolesOf, activeRoleOf, PROVIDER } = require("../utils/roles");
const { isAdminUser } = require("../utils/admin");

const LISTINGS = "listings";
const PHOTOS = "listing_photos";
const MAX_PER_USER = 10;
const MAX_PHOTOS = 4;
const PRICE_UNITS = ["per job", "per hour", "per day", "per item", "per km", "per trip", "per kg", "per month", "negotiable"];

const str = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const longStr = (v, max) => String(v == null ? "" : v).replace(/\r/g, "").trim().slice(0, max);
const num = (v) => (v === "" || v == null || !isFinite(Number(v)) ? null : Number(v));

function haversineKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function normalisePhone(p) {
  let d = String(p || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (/^0[17]\d{8}$/.test(d)) d = "254" + d.slice(1);
  if (/^[17]\d{8}$/.test(d)) d = "254" + d;
  return /^\d{9,15}$/.test(d) ? d : null; // stored as 2547XXXXXXXX
}

// Validate and clean what the provider typed. Returns { data } or { error }.
function cleanInput(b, partial) {
  const out = {};
  const has = (k) => !partial || Object.prototype.hasOwnProperty.call(b, k);
  if (has("title")) {
    out.title = str(b.title, 80);
    if (out.title.length < 3) return { error: "Give your service a short name (at least 3 letters), e.g. \"Shoe repair at Kondele stage\"" };
  }
  if (has("category")) {
    out.category = str(b.category, 40).toLowerCase();
    if (!/^[a-z0-9-]{2,40}$/.test(out.category)) return { error: "Choose the type of service" };
    out.categoryLabel = str(b.categoryLabel, 60) || out.category.replace(/-/g, " ");
  }
  if (has("description")) {
    out.description = longStr(b.description, 1000);
    if (out.description.length < 10) return { error: "Describe what you offer (at least 10 letters)" };
  }
  if (has("priceFrom")) {
    out.priceFrom = num(b.priceFrom);
    if (out.priceFrom != null && (out.priceFrom < 0 || out.priceFrom > 10000000)) return { error: "Enter a valid price" };
    if (out.priceFrom != null) out.priceFrom = Math.round(out.priceFrom);
  }
  if (has("priceUnit")) out.priceUnit = PRICE_UNITS.includes(b.priceUnit) ? b.priceUnit : "negotiable";
  if (has("phone")) {
    out.phone = normalisePhone(b.phone);
    if (!out.phone) return { error: "Enter the phone number clients should call, e.g. 0712 345 678" };
  }
  if (has("whatsapp")) out.whatsapp = !!b.whatsapp;
  if (has("location")) {
    const l = b.location || {};
    const lat = num(l.lat), lng = num(l.lng);
    if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return { error: "Pin where you work on the map so clients near you can find you" };
    out.location = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, label: str(l.label, 200) };
  }
  if (has("showExact")) out.showExact = b.showExact !== false;
  if (has("area")) out.area = str(b.area, 120);
  if (has("county")) out.county = str(b.county, 40).toLowerCase();
  if (has("subcounty")) out.subcounty = str(b.subcounty, 60);
  if (has("mobile")) out.mobile = !!b.mobile;
  if (has("serviceRadiusKm")) {
    const r = num(b.serviceRadiusKm);
    out.serviceRadiusKm = r == null ? null : Math.min(200, Math.max(1, Math.round(r)));
  }
  if (has("availability")) out.availability = str(b.availability, 120);
  return { data: out };
}

// What a visitor sees. The phone number only shows to signed-in users;
// a provider who works from home can show only the area (about 1 km).
function publicView(l, viewer, from) {
  const owner = viewer && viewer.uid === l.providerId;
  const exact = l.showExact !== false || owner;
  const loc = l.location
    ? exact ? { ...l.location, approximate: false }
      : { lat: Math.round(l.location.lat * 100) / 100, lng: Math.round(l.location.lng * 100) / 100, label: [l.area, l.subcounty].filter(Boolean).join(", "), approximate: true }
    : null;
  const v = {
    id: l.id, providerId: l.providerId, providerName: l.providerName, title: l.title, category: l.category, categoryLabel: l.categoryLabel,
    description: l.description, priceFrom: l.priceFrom, priceUnit: l.priceUnit, whatsapp: !!l.whatsapp, area: l.area || "",
    county: l.county || "", subcounty: l.subcounty || "", mobile: !!l.mobile, serviceRadiusKm: l.serviceRadiusKm || null,
    availability: l.availability || "", photos: l.photos || [], status: l.status, location: loc,
    createdAt: l.createdAt, updatedAt: l.updatedAt,
  };
  if (viewer) v.phone = l.phone;
  if (owner) { v.views = l.views || 0; v.contacts = l.contacts || 0; v.showExact = l.showExact !== false; }
  if (from && loc) v.distanceKm = Math.round(haversineKm(from, l.location) * 10) / 10;
  return v;
}

function sessionFor(u) {
  const roles = rolesOf(u);
  const role = activeRoleOf(u);
  const token = generateToken({ uid: u.uid, email: u.email, name: u.name, role, roles });
  const { passwordHash, ...rest } = u;
  return { token, user: { ...rest, role, roles, isAdmin: isAdminUser(u) } };
}

/* ── Browse / search (public) ─────────────────────────────────────────────
   GET /api/listings?q=&category=&county=&lat=&lng=&radiusKm=&limit=   */
router.get("/", optionalAuth, async (req, res) => {
  try {
    const q = str(req.query.q, 80).toLowerCase();
    const category = str(req.query.category, 40).toLowerCase();
    const county = str(req.query.county, 40).toLowerCase();
    const lat = num(req.query.lat), lng = num(req.query.lng);
    const from = lat != null && lng != null ? { lat, lng } : null;
    const radiusKm = num(req.query.radiusKm);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 60));

    const snap = await firebase.db.collection(LISTINGS).where("status", "==", "active").get();
    let list = snap.docs.map((d) => d.data());
    if (category && category !== "all") list = list.filter((l) => l.category === category);
    if (county && county !== "all") list = list.filter((l) => l.county === county);
    if (q) {
      const words = q.split(/\s+/).filter(Boolean);
      list = list.filter((l) => {
        const hay = [l.title, l.description, l.categoryLabel, l.category, l.area, l.county, l.subcounty, l.providerName, l.location && l.location.label].join(" ").toLowerCase();
        return words.every((w) => hay.includes(w));
      });
    }
    let out = list.map((l) => ({ l, d: from && l.location ? haversineKm(from, l.location) : null }));
    if (from && radiusKm) out = out.filter((x) => x.d != null && x.d <= radiusKm);
    out.sort((a, b) => (from ? (a.d ?? 1e9) - (b.d ?? 1e9) : String(b.l.updatedAt || b.l.createdAt).localeCompare(String(a.l.updatedAt || a.l.createdAt))));
    const total = out.length;
    return res.json({ success: true, total, listings: out.slice(0, limit).map((x) => publicView(x.l, req.user, from)) });
  } catch (e) {
    console.error("Browse listings error:", e);
    return res.status(500).json({ success: false, message: "Could not load services. Please try again." });
  }
});

/* ── My listings ── */
router.get("/mine", verifyJWT, async (req, res) => {
  try {
    const snap = await firebase.db.collection(LISTINGS).where("providerId", "==", req.user.uid).get();
    const listings = snap.docs.map((d) => publicView(d.data(), req.user)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return res.json({ success: true, listings });
  } catch (e) {
    console.error("My listings error:", e);
    return res.status(500).json({ success: false, message: "Could not load your services" });
  }
});

/* ── Create ── */
router.post("/", verifyJWT, async (req, res) => {
  const { data, error } = cleanInput(req.body || {}, false);
  if (error) return res.status(422).json({ success: false, message: error });
  try {
    const userRef = firebase.db.collection(firebase.COLLECTIONS.USERS).doc(req.user.uid);
    const [userDoc, mine] = await Promise.all([userRef.get(), firebase.db.collection(LISTINGS).where("providerId", "==", req.user.uid).get()]);
    if (!userDoc.exists) return res.status(404).json({ success: false, message: "Account not found. Please sign in again." });
    if (mine.size >= MAX_PER_USER) return res.status(422).json({ success: false, message: `You can list up to ${MAX_PER_USER} services. Delete one you no longer offer to add another.` });
    const u = userDoc.data();
    const now = new Date().toISOString();
    const id = uuidv4();
    const listing = { id, providerId: req.user.uid, providerName: u.name || req.user.name || "Service provider", ...data, photos: [], status: "active", views: 0, contacts: 0, createdAt: now, updatedAt: now };
    await firebase.db.collection(LISTINGS).doc(id).set(listing);

    // Listing a service makes the account a service provider too (keeps the current Hiring/Working mode)
    let session = null;
    if (!rolesOf(u).includes(PROVIDER)) {
      const roles = Array.from(new Set([...rolesOf(u), PROVIDER]));
      const updates = { roles, updatedAt: now, providerSince: u.providerSince || now };
      const skills = Array.isArray(u.skills) ? u.skills : [];
      if (!skills.includes(listing.categoryLabel)) updates.skills = [...skills, listing.categoryLabel].slice(0, 20);
      await userRef.update(updates);
      session = sessionFor({ ...u, ...updates });
    }
    return res.status(201).json({ success: true, listing: publicView(listing, req.user), ...(session || {}) });
  } catch (e) {
    console.error("Create listing error:", e);
    return res.status(500).json({ success: false, message: "Could not save your service. Please try again." });
  }
});

async function ownListing(req, res) {
  const doc = await firebase.db.collection(LISTINGS).doc(req.params.id).get();
  if (!doc.exists) { res.status(404).json({ success: false, message: "Service not found" }); return null; }
  const l = doc.data();
  if (l.providerId !== req.user.uid && !isAdminUser(req.user)) { res.status(403).json({ success: false, message: "Not your service" }); return null; }
  return { ref: doc.ref, l };
}

/* ── Edit ── */
router.put("/:id", verifyJWT, async (req, res) => {
  const { data, error } = cleanInput(req.body || {}, true);
  if (error) return res.status(422).json({ success: false, message: error });
  try {
    const own = await ownListing(req, res); if (!own) return;
    const updates = { ...data, updatedAt: new Date().toISOString() };
    if (req.body && ["active", "paused"].includes(req.body.status)) updates.status = req.body.status;
    await own.ref.update(updates);
    return res.json({ success: true, listing: publicView({ ...own.l, ...updates }, req.user) });
  } catch (e) {
    console.error("Update listing error:", e);
    return res.status(500).json({ success: false, message: "Could not update your service" });
  }
});

/* ── Delete ── */
router.delete("/:id", verifyJWT, async (req, res) => {
  try {
    const own = await ownListing(req, res); if (!own) return;
    const batch = firebase.db.batch();
    (own.l.photos || []).forEach((pid) => batch.delete(firebase.db.collection(PHOTOS).doc(`${own.l.id}_${pid}`)));
    batch.delete(own.ref);
    await batch.commit();
    return res.json({ success: true });
  } catch (e) {
    console.error("Delete listing error:", e);
    return res.status(500).json({ success: false, message: "Could not delete the service" });
  }
});

/* ── Photos (stored in Firestore, about 200 KB each, the website shrinks them first) ── */
function parseImage(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m || m[2].length > 700000) return null;
  return { mime: m[1], data: m[2] };
}
router.post("/:id/photos", verifyJWT, async (req, res) => {
  const img = parseImage(req.body && req.body.image);
  if (!img) return res.status(422).json({ success: false, message: "Please choose a JPG, PNG or WebP photo" });
  try {
    const own = await ownListing(req, res); if (!own) return;
    const photos = own.l.photos || [];
    if (photos.length >= MAX_PHOTOS) return res.status(422).json({ success: false, message: `Up to ${MAX_PHOTOS} photos per service` });
    const pid = uuidv4().slice(0, 12);
    await firebase.db.collection(PHOTOS).doc(`${own.l.id}_${pid}`).set({ listingId: own.l.id, mime: img.mime, data: img.data, createdAt: new Date().toISOString() });
    const next = [...photos, pid];
    await own.ref.update({ photos: next, updatedAt: new Date().toISOString() });
    return res.json({ success: true, photos: next });
  } catch (e) {
    console.error("Listing photo error:", e);
    return res.status(500).json({ success: false, message: "Could not save the photo" });
  }
});
router.delete("/:id/photos/:pid", verifyJWT, async (req, res) => {
  try {
    const own = await ownListing(req, res); if (!own) return;
    const next = (own.l.photos || []).filter((p) => p !== req.params.pid);
    await firebase.db.collection(PHOTOS).doc(`${own.l.id}_${req.params.pid}`).delete();
    await own.ref.update({ photos: next, updatedAt: new Date().toISOString() });
    return res.json({ success: true, photos: next });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Could not remove the photo" });
  }
});
router.get("/:id/photos/:pid", async (req, res) => {
  try {
    const doc = await firebase.db.collection(PHOTOS).doc(`${req.params.id}_${req.params.pid}`).get();
    if (!doc.exists) return res.status(404).end();
    const p = doc.data();
    res.setHeader("Content-Type", p.mime);
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    return res.end(Buffer.from(p.data, "base64"));
  } catch (e) {
    return res.status(500).end();
  }
});

/* ── One listing (public; counts a view) ── */
router.get("/:id", optionalAuth, async (req, res) => {
  try {
    const doc = await firebase.db.collection(LISTINGS).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ success: false, message: "Service not found" });
    const l = doc.data();
    const owner = req.user && req.user.uid === l.providerId;
    if (l.status !== "active" && !owner) return res.status(404).json({ success: false, message: "This service is not available right now" });
    if (!owner) doc.ref.update({ views: firebase.admin.firestore.FieldValue.increment(1) }).catch(() => {});
    const lat = num(req.query.lat), lng = num(req.query.lng);
    return res.json({ success: true, listing: publicView(l, req.user, lat != null && lng != null ? { lat, lng } : null) });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Could not load this service" });
  }
});

/* ── A client tapped Call / WhatsApp / Message (helps the provider see interest) ── */
router.post("/:id/contact", verifyJWT, async (req, res) => {
  try {
    const ref = firebase.db.collection(LISTINGS).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ success: false });
    if (doc.data().providerId !== req.user.uid) await ref.update({ contacts: firebase.admin.firestore.FieldValue.increment(1) });
    return res.json({ success: true });
  } catch (e) {
    return res.json({ success: false });
  }
});

module.exports = router;
