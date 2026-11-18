// utils/ice.js
// ServiceHub Kenya - STUN/TURN servers for voice & video calls.
//
// STUN alone only works when both phones are on "friendly" networks. Most Kenyan mobile data
// (Safaricom, Airtel, Telkom) sits behind carrier-grade NAT, so without a TURN relay a call
// "connects" but no audio ever arrives. Configure ONE of these in Railway → Variables:
//
//   A) Cloudflare Realtime TURN (free tier, recommended)
//        CLOUDFLARE_TURN_KEY_ID=...        CLOUDFLARE_TURN_API_TOKEN=...
//   B) Metered.ca TURN
//        METERED_DOMAIN=yourapp.metered.live   METERED_API_KEY=...
//   C) Any TURN server (e.g. your own coturn)
//        TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
//        TURN_USERNAME=...   TURN_CREDENTIAL=...

const axios = require("axios");

const STUN = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];

let cache = { servers: null, expires: 0 };

function turnProvider() {
  if (process.env.CLOUDFLARE_TURN_KEY_ID && process.env.CLOUDFLARE_TURN_API_TOKEN) return "cloudflare";
  if (process.env.METERED_DOMAIN && process.env.METERED_API_KEY) return "metered";
  if (process.env.TURN_URLS && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) return "static";
  return null;
}

async function fetchCloudflare() {
  const id = process.env.CLOUDFLARE_TURN_KEY_ID;
  const headers = { Authorization: `Bearer ${process.env.CLOUDFLARE_TURN_API_TOKEN}`, "Content-Type": "application/json" };
  const base = `https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials`;
  let data;
  try {
    ({ data } = await axios.post(`${base}/generate-ice-servers`, { ttl: 86400 }, { headers, timeout: 8000 }));
  } catch (e) {
    ({ data } = await axios.post(`${base}/generate`, { ttl: 86400 }, { headers, timeout: 8000 }));
  }
  const s = data && data.iceServers;
  return Array.isArray(s) ? s : s ? [s] : [];
}

async function fetchMetered() {
  const url = `https://${process.env.METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${encodeURIComponent(process.env.METERED_API_KEY)}`;
  const { data } = await axios.get(url, { timeout: 8000 });
  return Array.isArray(data) ? data : [];
}

function staticTurn() {
  return [{
    urls: process.env.TURN_URLS.split(",").map((u) => u.trim()).filter(Boolean),
    username: process.env.TURN_USERNAME,
    credential: process.env.TURN_CREDENTIAL,
  }];
}

async function getIceServers() {
  if (cache.servers && cache.expires > Date.now()) return cache.servers;
  const provider = turnProvider();
  let turn = [];
  try {
    if (provider === "cloudflare") turn = await fetchCloudflare();
    else if (provider === "metered") turn = await fetchMetered();
    else if (provider === "static") turn = staticTurn();
  } catch (e) {
    console.error(`TURN (${provider}) credentials error:`, e.response ? e.response.status : e.message);
  }
  const servers = [...STUN, ...turn];
  // Credentials are valid for 24h; refresh well before that.
  cache = { servers, expires: Date.now() + (turn.length ? 6 * 3600 * 1000 : 5 * 60 * 1000) };
  return servers;
}

module.exports = { getIceServers, turnProvider };
