// utils/roles.js
// ServiceHub Kenya - one account, two roles.
// Everyone can hire (client). Anyone can also work as a service provider.
// `role` is the mode the person is using right now; `roles` is everything they can do.

const CLIENT = "client";
const PROVIDER = "service-provider";

function rolesOf(user) {
  const set = new Set([CLIENT]);
  if (user && Array.isArray(user.roles)) user.roles.forEach((r) => { if (r === CLIENT || r === PROVIDER) set.add(r); });
  if (user && user.role === PROVIDER) set.add(PROVIDER);
  return [CLIENT, PROVIDER].filter((r) => set.has(r));
}

function activeRoleOf(user) {
  const roles = rolesOf(user);
  return user && roles.includes(user.role) ? user.role : CLIENT;
}

function isProvider(user) { return rolesOf(user).includes(PROVIDER); }

module.exports = { CLIENT, PROVIDER, rolesOf, activeRoleOf, isProvider };
