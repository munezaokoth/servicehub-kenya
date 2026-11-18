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
const paymentRoutes  = require("./routes/payments");
const chatRoutes     = require("./routes/chat");
const contactRoutes  = require("./routes/contact");
const userRoutes     = require("./routes/users");

const app = express();
const server = http.createServer(app);

app.set("trust proxy", 1);
initSocket(server);

// The website uses inline scripts plus CDN assets (Font Awesome, Firebase, Socket.IO),
// so a strict CSP would break it. Popups must be allowed for Google/Facebook sign-in.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(cors({ origin: true, methods: ["GET","POST","PUT","DELETE","PATCH","OPTIONS"], allowedHeaders: ["Content-Type","Authorization"], credentials: true }));
app.use(morgan("tiny"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

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
    mpesa: Boolean(process.env.MPESA_CONSUMER_KEY),
    timestamp: new Date().toISOString(),
  });
});

// ── API ────────────────────────────────────────────────────────────────────
app.use("/api", apiLimiter);
app.use("/api/auth",     authLimiter, authRoutes);
app.use("/api/jobs",     jobRoutes);
app.use("/api/quotes",   quoteRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/chat",     chatRoutes);
app.use("/api/contact",  contactLimiter, contactRoutes);
app.use("/api/users",    userRoutes);
app.get("/api", (req, res) => res.json({ name: "ServiceHub Kenya API", status: "running", version: "2.0.0" }));
app.use("/api", (req, res) => res.status(404).json({ success: false, message: `Route ${req.method} ${req.originalUrl} not found` }));

// ── Website (same origin as the API, so no CORS or URL mismatch) ──────────
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR, { extensions: ["html"], maxAge: "1h" }));
app.get("*", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`\n🚀 ServiceHub Kenya running on port ${PORT}`);
  console.log(`   Environment : ${process.env.NODE_ENV || "development"}`);
  console.log(`   Health      : http://localhost:${PORT}/health\n`);
});

module.exports = { app, server };
