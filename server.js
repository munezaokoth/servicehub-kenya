require("dotenv").config();
const http = require("http");
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

// ── Init Firebase FIRST before any routes are required ─────────────────────
const { initFirebase, firebaseStatus } = require("./config/firebase");
initFirebase();

const { initSocket } = require("./utils/socket");
const { apiLimiter, authLimiter, contactLimiter } = require("./middleware/rateLimiter");
const authRoutes     = require("./routes/auth");
const jobRoutes      = require("./routes/jobs");
const quoteRoutes    = require("./routes/quotes");
const chatRoutes     = require("./routes/chat");
const contactRoutes  = require("./routes/contact");
const userRoutes     = require("./routes/users");
const callRoutes     = require("./routes/calls");
const adminRoutes    = require("./routes/admin");
const listingRoutes  = require("./routes/listings");
const seoRoutes      = require("./routes/seo");
const { turnProvider } = require("./utils/ice");
const { allowedOrigin, stripTags } = require("./middleware/security");

const app = express();
const server = http.createServer(app);

app.set("trust proxy", 1);
initSocket(server);

// Security headers. The website still uses inline scripts and CDN assets (Font Awesome, Firebase,
// Leaflet), so scripts aren't locked down by CSP; instead user text is stripped of HTML on the way in
// and escaped on screen. These CSP rules block clickjacking/framing, plugins, <base> hijacking and
// mixed content without affecting the site. Popups stay allowed for Google sign-in.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      "default-src": ["'self'", "https:", "data:", "blob:", "wss:", "'unsafe-inline'", "'unsafe-eval'"], // permissive: the site loads CDNs/maps/fonts
      "frame-ancestors": ["'self'"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'", "https:"],
      "upgrade-insecure-requests": [],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));
app.use((req, res, next) => { res.setHeader("Permissions-Policy", "geolocation=(self), camera=(self), microphone=(self), payment=(), usb=()"); next(); });
// Only servicehub.co.ke (and the app) may call the API from a browser
app.use(cors({ origin: allowedOrigin, methods: ["GET","POST","PUT","DELETE","PATCH","OPTIONS"], allowedHeaders: ["Content-Type","Authorization"], credentials: true }));
app.use(morgan("tiny"));
// Photos are sent as data: they need bigger request bodies; everything else is capped at 1 MB
app.use(["/api/chat", "/api/listings", "/api/jobs", "/api/users", "/api/quotes"], express.json({ limit: "8mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
// Remove HTML from everything users submit (names, job titles, messages, reviews...)
app.use(stripTags);

// Force HTTPS behind Railway's proxy
app.use((req, res, next) => {
  if (process.env.NODE_ENV === "production" && req.headers["x-forwarded-proto"] === "http") {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  next();
});

app.get("/health", (req, res) => {
  const fb = firebaseStatus();
  res.status(fb.ok ? 200 : 503).json({
    status: fb.ok ? "OK" : "DEGRADED",
    service: "ServiceHub Kenya",
    firebase: fb,
    jwt: Boolean(process.env.JWT_SECRET),
    email: Boolean(process.env.RESEND_API_KEY),
    // Needed for "Forgot password" emails when Resend isn't set up
    firebaseWebKey: Boolean(process.env.FIREBASE_WEB_API_KEY),
    // Calls need a TURN relay to carry audio over Kenyan mobile data (see utils/ice.js)
    callsTurn: turnProvider() || false,
    timestamp: new Date().toISOString(),
  });
});

// ── API ────────────────────────────────────────────────────────────────────
app.use("/api", apiLimiter);
app.use("/api/auth",     authLimiter, authRoutes);
app.use("/api/jobs",     jobRoutes);
app.use("/api/quotes",   quoteRoutes);
// Payments are switched off: ServiceHub is free and does not handle money.
app.use("/api/chat",     chatRoutes);
app.use("/api/contact",  contactLimiter, contactRoutes);
app.use("/api/users",    userRoutes);
app.use("/api/calls",    callRoutes);
app.use("/api/admin",    adminRoutes);
app.use("/api/listings", listingRoutes);
app.get("/api", (req, res) => res.json({ name: "ServiceHub Kenya API", status: "running", version: "2.0.0" }));
app.use("/api", (req, res) => res.status(404).json({ success: false, message: `Route ${req.method} ${req.originalUrl} not found` }));

// ── Android app download (always the newest build from GitHub Releases) ──
const APK_URL = process.env.ANDROID_APK_URL || "https://github.com/munezaokoth/servicehub-kenya/releases/latest/download/ServiceHub-Kenya.apk";
app.get(["/download/android", "/app", "/apk"], (req, res) => res.redirect(302, APK_URL));

// ── Pages for search engines and AI assistants (sitemap, /services, /service/:id) ──
app.use(seoRoutes);

// ── Website (same origin as the API, so no CORS or URL mismatch) ──────────
const PUBLIC_DIR = path.join(__dirname, "public");
// HTML/JS/CSS are always re-checked so every deploy reaches users immediately (no stale dashboard code)
app.use(express.static(PUBLIC_DIR, {
  extensions: ["html"],
  setHeaders: (res, filePath) => {
    if (filePath.endsWith("sw.js")) { res.setHeader("Service-Worker-Allowed", "/"); res.setHeader("Cache-Control", "no-cache, no-store"); return; }
    if (/\.(html|js|css)$/.test(filePath)) res.setHeader("Cache-Control", "no-cache");
    else res.setHeader("Cache-Control", "public, max-age=86400");
  },
}));
app.get("*", (req, res) => { res.setHeader("Cache-Control", "no-cache"); res.sendFile(path.join(PUBLIC_DIR, "index.html")); });

app.use((err, req, res, next) => {
  // Bad or oversized requests get a clear answer; nothing internal is ever shown to the visitor
  if (err && err.type === "entity.too.large") return res.status(413).json({ success: false, message: "That is too large to send." });
  if (err && (err.type === "entity.parse.failed" || err instanceof SyntaxError)) return res.status(400).json({ success: false, message: "The request could not be read." });
  if (err && err.message === "Not allowed by CORS") return res.status(403).json({ success: false, message: "Not allowed" });
  console.error("Error:", err);
  res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`\n🚀 ServiceHub Kenya running on port ${PORT}`);
  console.log(`   Environment : ${process.env.NODE_ENV || "development"}`);
  console.log(`   Health      : http://localhost:${PORT}/health\n`);
  // One-off: remove HTML from text saved before tag-stripping existed; replace the exposed push keys
  setTimeout(() => {
    require("./utils/clean-stored-text").cleanStoredText();
    require("./utils/push").getPublicKey().catch(() => {});
  }, 5000);
});

module.exports = { app, server };
