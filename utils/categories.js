// utils/categories.js
// Every service type on ServiceHub: the everyday/informal ones first, then the categories listed
// on the website (read from the "Service Category" list in public/index.html so they never drift apart).
const fs = require("fs");
const path = require("path");

const INFORMAL = [
  ["boda-boda", "Boda Boda Rides & Deliveries"], ["mama-mboga", "Mama Mboga & Fresh Produce"], ["food-kiosk", "Food Kiosk & Mama Lishe"],
  ["barber", "Barber Shop"], ["salon", "Salon & Hair Braiding"], ["shoe-repair", "Shoe Repair & Shoe Shining"],
  ["jua-kali", "Jua Kali & Metal Work"], ["tyre-repair", "Puncture & Tyre Repair"], ["car-wash", "Car Wash"],
  ["electronics-repair", "Radio, TV & Electronics Repair"], ["mitumba", "Mitumba & Second-hand Clothes"], ["hand-cart", "Mkokoteni & Hand-cart Transport"],
  ["water-vendor", "Water Vendor"], ["charcoal-firewood", "Charcoal & Firewood"], ["phone-charging", "Phone Charging & Accessories"],
  ["casual-labour", "Casual Labour (Kibarua)"], ["house-help", "House Help & Nanny"], ["watchman", "Watchman"],
];

let cache = null;
function decode(s) { return s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim(); }

function all() {
  if (cache) return cache;
  const list = INFORMAL.map(([slug, label]) => ({ slug, label, group: "Everyday & informal services" }));
  const seen = new Set(list.map((c) => c.slug));
  try {
    const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
    const start = html.indexOf('id="category-filter"');
    const block = start >= 0 ? html.slice(start, html.indexOf("</select>", start)) : "";
    const re = /<option value="([a-z0-9-]+)">([^<]+)<\/option>/g;
    let m;
    while ((m = re.exec(block))) {
      if (m[1] === "all" || seen.has(m[1])) continue;
      seen.add(m[1]);
      list.push({ slug: m[1], label: decode(m[2]), group: "More services" });
    }
  } catch (e) { console.warn("Could not read service categories from index.html:", e.message); }
  cache = list;
  return list;
}
function bySlug(slug) { return all().find((c) => c.slug === slug) || null; }

module.exports = { all, bySlug };
