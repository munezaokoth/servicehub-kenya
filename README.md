# ServiceHub Kenya

Free marketplace connecting clients and service providers across Kenya: clients post jobs, providers quote, clients choose, providers accept and do the work. ServiceHub charges no fees and does not handle payments; clients pay providers directly.

One Railway service serves both:
- the website (`public/index.html`), and
- the API (`/api/...`) with Socket.IO chat, on the same domain.

## Run locally
```
npm install
cp .env.example .env   # fill in values
npm start              # http://localhost:5000
```

## Deploy (Railway)
1. New project → Deploy from GitHub repo → this repo.
2. Variables: see `.env.example` (at minimum `JWT_SECRET`, `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_WEB_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `NODE_ENV=production`).
3. Calls: add a TURN relay so call audio works on mobile data — `CLOUDFLARE_TURN_KEY_ID` + `CLOUDFLARE_TURN_API_TOKEN` (free, Cloudflare dashboard → Realtime → TURN). Push alerts that make phones ring need no setup.
4. Settings → Networking → Generate domain, then add the custom domain `servicehub.co.ke`.
5. Check `https://<domain>/health` — every item should be `true` / `"ok": true`.

## What changed in v2.0
- Website + API merged into one service (no hard-coded backend URL, no CORS issues).
- Login fixed after password reset (checks Firebase Auth and re-syncs the stored hash).
- Half-created accounts cleaned up automatically; duplicate phone numbers get a clear message.
- Rate limits suited to Kenyan mobile networks (shared IPs).
- Job flow: quotes under each job, client accepts a quote, provider accepts the offer and sets a start date (job chat opens), completion by either side.
- All queries work on a brand-new Firebase project without creating composite indexes.
- `/health` reports exactly which setting is missing.
