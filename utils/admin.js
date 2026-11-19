// utils/admin.js
// ServiceHub Kenya - who is an admin.
// Admin = the account registered with an admin email address, and that email must be verified
// (so nobody can become admin just by typing the address or the phone number at sign-up).
// Defaults: eokoth2019@gmail.com / 0724090067. Override with ADMIN_EMAILS / ADMIN_PHONES (comma separated).

const EMAILS = String(process.env.ADMIN_EMAILS || "eokoth2019@gmail.com").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
const PHONES = String(process.env.ADMIN_PHONES || "0724090067").split(",").map((p) => p.replace(/\D/g, "").slice(-9)).filter(Boolean);

function phoneKey(p) { return String(p || "").replace(/\D/g, "").slice(-9); }

function isAdminUser(u) {
  if (!u || u.active === false) return false;
  const email = String(u.email || "").toLowerCase();
  return EMAILS.includes(email) && u.emailVerified === true;
}

module.exports = { isAdminUser, ADMIN_EMAILS: EMAILS, ADMIN_PHONES: PHONES, phoneKey };
