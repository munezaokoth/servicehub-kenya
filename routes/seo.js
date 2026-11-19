// routes/seo.js
// ServiceHub Kenya - pages that search engines and AI assistants can read.
//   /sitemap.xml         every public page, refreshed from live data
//   /services            directory of all service types
//   /services/:slug      one service type, with the live providers listed for it
//   /service/:id         one provider's listed service
// Each page is plain HTML with structured data (schema.org) and opens the full app for contacting.
const express = require("express");
const router = express.Router();
const firebase = require("../config/firebase");
const categories = require("../utils/categories");

const SITE = (process.env.SITE_URL || "https://servicehub.co.ke").replace(/\/$/, "");
const ORG_ID = `${SITE}/#organization`;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const xml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
const json = (o) => JSON.stringify(o).replace(/</g, "\\u003c");
const titleCase = (s) => String(s || "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const kes = (n) => "KES " + Number(n || 0).toLocaleString("en-KE");
const cut = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };

/* Live listings, cached for 5 minutes so crawlers don't hammer the database */
let cache = { at: 0, list: [] };
async function activeListings() {
  if (Date.now() - cache.at < 5 * 60 * 1000) return cache.list;
  try {
    const snap = await firebase.db.collection("listings").where("status", "==", "active").get();
    cache = { at: Date.now(), list: snap.docs.map((d) => d.data()) };
  } catch (e) { console.error("SEO listings error:", e.message); }
  return cache.list;
}
const placeOf = (l) => [l.area, l.subcounty, titleCase(l.county)].filter(Boolean).join(", ");
const priceOf = (l) => (l.priceFrom != null ? `From ${kes(l.priceFrom)}${l.priceUnit && l.priceUnit !== "negotiable" ? " " + l.priceUnit : " (negotiable)"}` : "Price: negotiable");

/* ── Shared page shell ── */
function page({ title, description, canonical, robots, body, ld, ogType }) {
  return `<!DOCTYPE html>
<html lang="en-KE"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${robots || "index, follow, max-image-preview:large"}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="theme-color" content="#0b2a5b">
<meta name="geo.region" content="KE"><meta name="geo.placename" content="Kenya">
<meta property="og:site_name" content="ServiceHub Kenya"><meta property="og:type" content="${ogType || "website"}"><meta property="og:locale" content="en_KE">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}"><meta property="og:image" content="${SITE}/icons/og-image.jpg">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${SITE}/icons/og-image.jpg">
<link rel="icon" href="/icons/icon-96.png"><link rel="manifest" href="/manifest.webmanifest">
${(ld || []).map((o) => `<script type="application/ld+json">${json(o)}</script>`).join("\n")}
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1f2d3d;background:#f5f8fc;line-height:1.55}
a{color:#1557d6}header{background:#0b2a5b;color:#fff}header .w{display:flex;align-items:center;gap:12px;justify-content:space-between}
.w{max-width:1040px;margin:0 auto;padding:14px 18px}.brand{display:flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font-weight:800;font-size:1.15rem}
.brand img{width:36px;height:36px;border-radius:9px;background:#fff}.cta{background:#f28a12;color:#fff;text-decoration:none;font-weight:700;border-radius:10px;padding:9px 14px;font-size:.92rem;white-space:nowrap}
nav.bc{font-size:.85rem;color:#5b6b7f;margin:6px 0 4px}nav.bc a{color:#5b6b7f}h1{font-size:1.75rem;line-height:1.25;margin:6px 0 10px;color:#0b2a5b}
h2{font-size:1.25rem;margin:28px 0 10px;color:#0b2a5b}.lead{font-size:1.05rem;color:#3d4b5c}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.card{background:#fff;border:1px solid #dfe7f2;border-radius:12px;padding:14px;text-decoration:none;color:inherit;display:block}.card:hover{border-color:#1557d6}
.card b{display:block;color:#0b2a5b}.muted{color:#5b6b7f;font-size:.9rem}.tag{display:inline-block;font-size:.72rem;font-weight:700;color:#f28a12;text-transform:uppercase;letter-spacing:.3px}
.box{background:#fff;border:1px solid #dfe7f2;border-radius:12px;padding:16px}.btn{display:inline-block;background:#1557d6;color:#fff;text-decoration:none;font-weight:700;border-radius:10px;padding:11px 16px;margin:6px 6px 0 0}
.btn.alt{background:#fff;color:#1557d6;border:1.5px solid #1557d6}ol li,ul li{margin:4px 0}details{background:#fff;border:1px solid #dfe7f2;border-radius:10px;padding:10px 14px;margin:8px 0}
summary{font-weight:700;cursor:pointer;color:#0b2a5b}.cats{columns:3 220px;padding-left:18px}footer{margin-top:40px;background:#0b2a5b;color:#cfd8e6;font-size:.88rem}footer a{color:#fff}
</style></head><body>
<header><div class="w"><a class="brand" href="/"><img src="/icons/icon-96.png" alt="ServiceHub Kenya logo" width="36" height="36">ServiceHub Kenya</a><a class="cta" href="/download/android">Get the app</a></div></header>
<main class="w">${body}</main>
<footer><div class="w"><p><b>ServiceHub Kenya Limited</b>: a free marketplace connecting clients with service providers in all 47 counties of Kenya. A product of Jatelo Technologies, Kisumu.</p>
<p><a href="/">Home</a> · <a href="/services">All services</a> · <a href="/download/android">Android app</a> · support@servicehub.co.ke · +254 724 090 067</p></div></footer>
</body></html>`;
}
const breadcrumb = (items) => ({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map(([name, url], i) => ({ "@type": "ListItem", position: i + 1, name, item: url })) });
const faqLd = (qa) => ({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: qa.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) });
const faqHtml = (qa) => qa.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("");
function notFound(res, msg) {
  res.status(404).set("Cache-Control", "no-cache").send(page({ title: "Not found | ServiceHub Kenya", description: msg, canonical: SITE + "/services", robots: "noindex, follow",
    body: `<h1>${esc(msg)}</h1><p><a class="btn" href="/services">Browse all services</a> <a class="btn alt" href="/">Go to ServiceHub</a></p>` }));
}

/* ── /services : every service type ── */
router.get("/services", async (req, res) => {
  const list = await activeListings();
  const count = {}; list.forEach((l) => { count[l.category] = (count[l.category] || 0) + 1; });
  const cats = categories.all();
  const groups = [...new Set(cats.map((c) => c.group))];
  const body = `<nav class="bc"><a href="/">Home</a> › Services</nav>
    <h1>All services on ServiceHub Kenya</h1>
    <p class="lead">Find fundis, boda bodas, barbers, mama mbogas, caterers, cleaners, tutors and every kind of service provider near you in Kenya. Pick a service to see the providers listed for it, then call, WhatsApp or message them directly. ServiceHub is free for clients and providers.</p>
    ${groups.map((g) => `<h2>${esc(g)}</h2><ul class="cats">${cats.filter((c) => c.group === g).map((c) => `<li><a href="/services/${c.slug}">${esc(c.label)}</a>${count[c.slug] ? ` <span class="muted">(${count[c.slug]})</span>` : ""}</li>`).join("")}</ul>`).join("")}
    <h2>Offer a service?</h2><p>Anyone can list what they do for free, from a fundi or a kiosk to a registered business. <a class="btn" href="/?list=1">List your service</a></p>`;
  res.set("Cache-Control", "public, max-age=600").send(page({
    title: "All Services in Kenya – Fundis, Boda Boda, Cleaning & More | ServiceHub Kenya",
    description: "Browse every service type on ServiceHub Kenya: plumbers, electricians, boda bodas, barbers, cleaners, caterers, mechanics and more across all 47 counties. Free to use.",
    canonical: `${SITE}/services`, body,
    ld: [breadcrumb([["Home", SITE + "/"], ["Services", SITE + "/services"]]),
      { "@context": "https://schema.org", "@type": "ItemList", name: "Service types on ServiceHub Kenya", itemListElement: cats.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.label, url: `${SITE}/services/${c.slug}` })) }],
  }));
});

/* ── /services/:slug : one service type ── */
router.get("/services/:slug", async (req, res) => {
  const cat = categories.bySlug(String(req.params.slug || "").toLowerCase());
  if (!cat) return notFound(res, "That service type was not found");
  const list = (await activeListings()).filter((l) => l.category === cat.slug)
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  const name = cat.label, lower = name.toLowerCase();
  const counties = [...new Set(list.map((l) => titleCase(l.county)).filter(Boolean))].sort();
  const prices = list.map((l) => l.priceFrom).filter((p) => p != null && p > 0).sort((a, b) => a - b);
  const priceAnswer = prices.length >= 2
    ? `On ServiceHub, providers list ${lower} from ${kes(prices[0])} to ${kes(prices[prices.length - 1])} as a starting price. The final price depends on the job, so agree on it with the provider before work starts.`
    : `Each provider on ServiceHub shows their own starting price for ${lower}. The final price depends on the job, so agree on it with the provider before work starts. You pay the provider directly; ServiceHub charges no commission.`;
  const qa = [
    [`How do I find ${lower} near me?`, `Open ServiceHub, go to Find Services and tap Services near me. It uses your location to show ${lower} providers closest to you first, with how far away each one is. You can then call, WhatsApp or message them.`],
    [`How much does ${lower} cost in Kenya?`, priceAnswer],
    [`Is it free to hire or offer ${lower} on ServiceHub?`, `Yes. ServiceHub Kenya is free for clients and service providers. There are no fees or commissions, and you pay the provider directly by cash, M-Pesa or bank.`],
    [`How do I list my ${lower} business on ServiceHub?`, `Create a free account, then choose List your service. Add what you offer, your price, phone number and a pin of where you work, so clients near you can find and contact you.`],
  ];
  const body = `<nav class="bc"><a href="/">Home</a> › <a href="/services">Services</a> › ${esc(name)}</nav>
    <span class="tag">${esc(cat.group)}</span>
    <h1>${esc(name)} near you in Kenya</h1>
    <p class="lead">Find ${esc(lower)} providers across Kenya on ServiceHub. See who is nearest, compare their prices and contact them directly by call, WhatsApp or in-app chat. Free for clients and providers, with no commission.</p>
    <p><a class="btn" href="/?service=${cat.slug}">Find ${esc(lower)} near me</a> <a class="btn alt" href="/?list=1">List your ${esc(lower)} service</a></p>
    <h2>${list.length ? `${list.length} ${esc(lower)} provider${list.length > 1 ? "s" : ""} on ServiceHub` : `${esc(name)} providers`}</h2>
    ${list.length ? `<div class="grid">${list.slice(0, 60).map((l) => `<a class="card" href="/service/${esc(l.id)}"><b>${esc(l.title)}</b><span class="muted">${esc(l.providerName)}${placeOf(l) ? " · " + esc(placeOf(l)) : ""}</span><br><span>${esc(priceOf(l))}</span>${l.mobile ? '<br><span class="muted">Comes to you</span>' : ""}</a>`).join("")}</div>`
      : `<div class="box">No ${esc(lower)} providers are listed yet. Offer this service? <a href="/?list=1">List it free</a> and clients near you will find you.</div>`}
    ${counties.length ? `<h2>Where</h2><p>${esc(name)} providers are listed in ${esc(counties.join(", "))}. ServiceHub covers all 47 counties of Kenya.</p>` : ""}
    <h2>How to hire on ServiceHub</h2><ol><li>Open Find Services and choose ${esc(name)}, or tap Services near me.</li><li>Compare providers by distance, price and details.</li><li>Call, WhatsApp, use Relay or chat in the app, agree on the price, and pay the provider directly.</li></ol>
    <p>Prefer to get quotes? <a href="/?post=1">Post a job for free</a> and providers near you will send you quotes.</p>
    <h2>Questions about ${esc(lower)}</h2>${faqHtml(qa)}`;
  const url = `${SITE}/services/${cat.slug}`;
  res.set("Cache-Control", "public, max-age=600").send(page({
    title: `${name} Near You in Kenya | ServiceHub Kenya`,
    description: cut(`Find ${lower} near you in Kenya. Compare prices, see who is closest and call, WhatsApp or message them directly. Free on ServiceHub Kenya, all 47 counties.`, 158),
    canonical: url, robots: list.length ? undefined : "noindex, follow", body,
    ld: [breadcrumb([["Home", SITE + "/"], ["Services", SITE + "/services"], [name, url]]), faqLd(qa),
      { "@context": "https://schema.org", "@type": "Service", name: `${name} in Kenya`, serviceType: name, url, areaServed: { "@type": "Country", name: "Kenya" },
        provider: { "@id": ORG_ID }, offers: { "@type": "Offer", price: "0", priceCurrency: "KES", description: "Free to use ServiceHub; the provider sets the price of the work" } },
      ...(list.length ? [{ "@context": "https://schema.org", "@type": "ItemList", name: `${name} providers on ServiceHub Kenya`, itemListElement: list.slice(0, 60).map((l, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/service/${l.id}`, name: l.title })) }] : [])],
  }));
});

/* ── /service/:id : one listed service ── */
router.get("/service/:id", async (req, res) => {
  let l = null;
  try { const doc = await firebase.db.collection("listings").doc(String(req.params.id)).get(); if (doc.exists) l = doc.data(); } catch (e) {}
  if (!l || l.status !== "active") return notFound(res, "This service is not available right now");
  const cat = categories.bySlug(l.category) || { slug: l.category, label: l.categoryLabel || titleCase(l.category) };
  const place = placeOf(l);
  const url = `${SITE}/service/${l.id}`;
  const photo = (l.photos || [])[0] ? `${SITE}/api/listings/${l.id}/photos/${l.photos[0]}` : null;
  const exact = l.showExact !== false && l.location;
  const business = {
    "@context": "https://schema.org", "@type": "LocalBusiness", "@id": `${url}#business`, name: l.title, description: cut(l.description, 500), url,
    address: { "@type": "PostalAddress", addressLocality: l.subcounty || l.area || undefined, addressRegion: l.county ? titleCase(l.county) : undefined, addressCountry: "KE" },
    ...(exact ? { geo: { "@type": "GeoCoordinates", latitude: l.location.lat, longitude: l.location.lng } } : {}),
    ...(photo ? { image: photo } : {}),
    ...(l.priceFrom != null ? { priceRange: `From ${kes(l.priceFrom)}` } : {}),
    makesOffer: { "@type": "Offer", itemOffered: { "@type": "Service", name: cat.label, serviceType: cat.label },
      ...(l.priceFrom != null ? { priceSpecification: { "@type": "PriceSpecification", minPrice: l.priceFrom, priceCurrency: "KES" } } : {}) },
    ...(l.mobile && l.serviceRadiusKm && exact ? { areaServed: { "@type": "GeoCircle", geoMidpoint: { "@type": "GeoCoordinates", latitude: l.location.lat, longitude: l.location.lng }, geoRadius: l.serviceRadiusKm * 1000 } } : {}),
  };
  const body = `<nav class="bc"><a href="/">Home</a> › <a href="/services">Services</a> › <a href="/services/${esc(cat.slug)}">${esc(cat.label)}</a> › ${esc(cut(l.title, 40))}</nav>
    <span class="tag">${esc(cat.label)}</span>
    <h1>${esc(l.title)}</h1>
    <p class="muted">By ${esc(l.providerName)}${place ? " · " + esc(place) : ""}</p>
    ${photo ? `<p><img src="${esc(photo)}" alt="${esc(l.title)}" style="max-width:100%;max-height:340px;border-radius:12px;object-fit:cover"></p>` : ""}
    <div class="box"><p style="white-space:pre-wrap;margin-top:0">${esc(l.description)}</p>
      <ul><li><b>Price:</b> ${esc(priceOf(l))}</li>${place ? `<li><b>Area:</b> ${esc(place)}</li>` : ""}${l.mobile ? `<li><b>Comes to you</b>${l.serviceRadiusKm ? ` within about ${l.serviceRadiusKm} km` : ""}</li>` : ""}${l.availability ? `<li><b>Available:</b> ${esc(l.availability)}</li>` : ""}</ul>
      <a class="btn" href="/?listing=${esc(l.id)}">Call, WhatsApp or message ${esc(String(l.providerName || "").split(" ")[0] || "the provider")}</a>
      <p class="muted">Sign in to ServiceHub (free) to see the phone number. Agree on the price with the provider and pay them directly; ServiceHub charges no commission.</p></div>
    <p><a href="/services/${esc(cat.slug)}">More ${esc(cat.label.toLowerCase())} providers</a> · <a href="/services">All services</a></p>`;
  res.set("Cache-Control", "public, max-age=300").send(page({
    title: `${cut(`${l.title} – ${cat.label}${l.subcounty || l.county ? " in " + (l.subcounty || titleCase(l.county)) : ""}`, 58)} | ServiceHub Kenya`,
    description: cut(`${l.title} by ${l.providerName}${place ? " in " + place : ""}. ${priceOf(l)}. ${l.description}`, 158),
    canonical: url, ogType: "business.business", body,
    ld: [breadcrumb([["Home", SITE + "/"], ["Services", SITE + "/services"], [cat.label, `${SITE}/services/${cat.slug}`], [l.title, url]]), business],
  }));
});

/* ── /sitemap.xml ── */
router.get("/sitemap.xml", async (req, res) => {
  const list = await activeListings();
  const now = new Date().toISOString().slice(0, 10);
  const used = new Set(list.map((l) => l.category));
  const urls = [
    { loc: `${SITE}/`, lastmod: now, pri: "1.0", freq: "daily" },
    { loc: `${SITE}/services`, lastmod: now, pri: "0.9", freq: "daily" },
    ...categories.all().filter((c) => used.has(c.slug)).map((c) => ({ loc: `${SITE}/services/${c.slug}`, lastmod: now, pri: "0.8", freq: "daily" })),
    ...list.map((l) => ({ loc: `${SITE}/service/${l.id}`, lastmod: String(l.updatedAt || l.createdAt || now).slice(0, 10), pri: "0.6", freq: "weekly" })),
  ];
  res.set("Content-Type", "application/xml; charset=utf-8").set("Cache-Control", "public, max-age=3600").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${xml(u.loc)}</loc><lastmod>${u.lastmod}</lastmod><changefreq>${u.freq}</changefreq><priority>${u.pri}</priority></url>`).join("\n")}\n</urlset>\n`);
});

module.exports = router;
