/* ServiceHub Kenya — dashboard v2
   Sign-in flow, client "My Jobs" with quotes delivered under each job,
   per-quote viewer, client "Mark as Completed", provider assigned jobs.
   Loaded after the main script: these function declarations replace the older ones. */

const shEsc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shKES = (n) => "KES " + Number(n || 0).toLocaleString("en-KE");
const shDate = (d) => (d ? new Date(d).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "");
const SH_STATUS = {
  open: ["Open for quotes", "#1565c0", "#e3f2fd"],
  "awaiting-provider": ["Waiting for provider to accept", "#6a1b9a", "#f3e5f5"],
  "in-progress": ["In progress", "#e65100", "#fff3e0"],
  "pending-completion": ["Awaiting your confirmation", "#c0392b", "#fdecea"],
  completed: ["Completed", "#2e7d32", "#e8f5e9"],
  cancelled: ["Cancelled", "#616161", "#eeeeee"],
};
const SH_QSTATUS = { "awaiting-provider": ["Accepted · awaiting provider", "#6a1b9a", "#f3e5f5"], "declined-by-provider": ["Provider declined", "#c62828", "#ffebee"], pending: ["New", "#1565c0", "#e3f2fd"], accepted: ["Accepted", "#2e7d32", "#e8f5e9"], rejected: ["Declined", "#c62828", "#ffebee"], closed: ["Closed", "#616161", "#eeeeee"], withdrawn: ["Withdrawn", "#616161", "#eeeeee"] };
const shChip = (map, key) => { const [t, c, b] = map[key] || [key, "#555", "#eee"]; return `<span class="sh-chip" style="color:${c};background:${b}">${shEsc(t)}</span>`; };

let shMyJobs = [];
let shJobsTab = "active";

/* ---------- styles ---------- */
(function injectStyles() {
  const css = `
  .dash-panel{margin-top:32px}
  .sh-panel-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px}
  .sh-panel-head h2{margin:0;font-size:1.5rem;color:var(--dark)}
  .sh-tabs{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap}
  .sh-tab{border:1.5px solid var(--primary);background:transparent;color:var(--primary);padding:8px 16px;border-radius:999px;font-weight:600;cursor:pointer}
  .sh-tab.on{background:var(--primary);color:#fff}
  .sh-job{background:var(--white);border-radius:var(--radius-lg,14px);box-shadow:var(--shadow);margin-bottom:18px;overflow:hidden;border:1px solid var(--light-gray)}
  .sh-job-top{padding:18px 20px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
  .sh-job-top h3{margin:0 0 6px;font-size:1.08rem;color:var(--dark)}
  .sh-meta{color:var(--medium-gray);font-size:.85rem;display:flex;flex-wrap:wrap;gap:12px}
  .sh-chip{display:inline-block;padding:4px 12px;border-radius:999px;font-size:.78rem;font-weight:700;white-space:nowrap}
  .sh-actions{display:flex;gap:8px;flex-wrap:wrap;padding:0 20px 16px}
  .sh-btn{border:0;border-radius:10px;padding:9px 14px;font-weight:600;font-size:.85rem;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
  .sh-btn.pri{background:var(--primary);color:#fff}.sh-btn.ok{background:#2e7d32;color:#fff}
  .sh-btn.ghost{background:transparent;border:1.5px solid var(--light-gray);color:var(--dark-gray)}
  .sh-btn.danger{background:transparent;border:1.5px solid #c62828;color:#c62828}
  .sh-btn:disabled{opacity:.6;cursor:wait}
  .sh-quotes{background:var(--light,#f6f8fb);border-top:1px solid var(--light-gray);padding:14px 20px}
  .sh-quotes h4{margin:0 0 10px;font-size:.92rem;color:var(--dark)}
  .sh-q{display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--white);border:1px solid var(--light-gray);border-radius:12px;padding:10px 12px;margin-bottom:8px;cursor:pointer;transition:border-color .2s}
  .sh-q:hover{border-color:var(--primary)}
  .sh-q b{color:var(--dark)} .sh-q small{color:var(--medium-gray)}
  .sh-q-amt{font-weight:800;color:var(--primary);white-space:nowrap}
  .sh-empty{color:var(--medium-gray);font-size:.88rem;padding:6px 0}
  .sh-assigned{margin:0 20px 14px;padding:10px 12px;border-radius:10px;background:#e8f5e9;color:#1b5e20;font-size:.88rem}
  .sh-loading{padding:30px;text-align:center;color:var(--medium-gray)}
  .sh-qd-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--light-gray);font-size:.92rem}
  .sh-qd-msg{margin-top:14px;padding:14px;border-radius:10px;background:var(--light,#f6f8fb);white-space:pre-wrap;line-height:1.55}
  @media (max-width:600px){.sh-job-top{padding:14px}.sh-actions{padding:0 14px 14px}.sh-quotes{padding:12px 14px}.sh-btn{flex:1 1 auto;justify-content:center}}
  `;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
})();

/* ---------- quote viewer modal ---------- */
(function injectQuoteModal() {
  const m = document.createElement("div");
  m.className = "modal"; m.id = "quote-view-modal";
  m.innerHTML = `<div class="modal-content" style="max-width:520px;">
      <div class="modal-header"><h2 class="modal-title" id="qv-title">Quote</h2>
      <button class="modal-close" onclick="document.getElementById('quote-view-modal').classList.remove('active')">&times;</button></div>
      <div class="modal-body" id="qv-body"></div>
      <div class="modal-footer" id="qv-foot" style="flex-wrap:wrap;gap:8px;"></div></div>`;
  document.body.appendChild(m);
})();

function shPanel() {
  let p = document.getElementById("dash-panel");
  if (!p) { p = document.createElement("div"); p.id = "dash-panel"; p.className = "dash-panel"; (document.querySelector("#dashboard .container") || document.body).appendChild(p); }
  return p;
}
function shGoDashboard() {
  const dash = document.getElementById("dashboard");
  if (dash && !dash.classList.contains("active")) showSection("dashboard");
}
async function shApi(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}`, ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({ success: false, message: `Server error (${res.status})` }));
  return data;
}

/* ---------- sign in / sign up ---------- */
function afterLogin(data, msg) {
  setToken(data.token);
  currentUser = { ...data.user, loggedIn: true };
  window.currentUser = currentUser;
  updateAuthUI();
  try { initSocket(); } catch (e) { console.warn("Chat connection unavailable:", e); }
  showNotification(msg || `Welcome, ${String(data.user.name || "").split(" ")[0]}!`, "success");
  showSection("dashboard");
}

async function handleSignIn() {
  const email = (document.getElementById("signin-email").value || "").trim();
  const password = document.getElementById("signin-password").value;
  if (!email || !password) { showNotification("Please enter both email and password", "error"); return; }
  const btn = document.querySelector("#signin-form-data button[type=submit]");
  if (btn) btn.disabled = true;
  showNotification("Signing in...", "info");
  let data;
  try {
    const res = await fetch(`${API_BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    data = await res.json().catch(() => ({ success: false, message: `Server error (${res.status}). Please try again.` }));
  } catch (err) {
    if (btn) btn.disabled = false;
    showNotification("Cannot reach ServiceHub. Check your internet connection and try again.", "error");
    return;
  }
  if (btn) btn.disabled = false;
  if (!data.success) { showNotification(data.message || (data.errors && data.errors[0] && data.errors[0].msg) || "Sign in failed", "error"); return; }
  afterLogin(data);
}

async function handleSignUp() {
  const v = (id) => { const el = document.getElementById(id); return el ? el.value : ""; };
  const name = v("signup-name").trim(), email = v("signup-email").trim(), phone = v("signup-phone").trim();
  const password = v("signup-password"), confirm = v("signup-confirm-password"), role = v("signup-role");
  const termsEl = document.getElementById("terms-agreement");
  if (!name || !email || !phone || !password || !confirm || !role) { showNotification("Please fill all fields", "error"); return; }
  if (password !== confirm) { showNotification("Passwords do not match", "error"); return; }
  if (termsEl && !termsEl.checked) { showNotification("Please agree to the terms", "error"); return; }
  const btn = document.querySelector("#signup-form-data button[type=submit]");
  if (btn) btn.disabled = true;
  showNotification("Creating account...", "info");
  let data;
  try {
    const res = await fetch(`${API_BASE}/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, phone, password, confirmPassword: confirm, role }) });
    data = await res.json().catch(() => ({ success: false, message: `Server error (${res.status}). Please try again.` }));
  } catch (err) {
    if (btn) btn.disabled = false;
    showNotification("Cannot reach ServiceHub. Check your internet connection and try again.", "error");
    return;
  }
  if (btn) btn.disabled = false;
  if (!data.success) { showNotification(data.message || (data.errors && data.errors[0] && data.errors[0].msg) || "Registration failed", "error"); return; }
  afterLogin(data, "Account created! Welcome to ServiceHub Kenya.");
}

/* ---------- dashboard panel ---------- */
function loadDashboardPanel() {
  if (!getToken() || !currentUser || !currentUser.loggedIn) return;
  if (currentUser.role === "service-provider") loadMyAssignedJobs({ quiet: true });
  else loadMyJobs({ quiet: true });
}

/* ---------- CLIENT: My Jobs with quotes under each job ---------- */
async function loadMyJobs(opts = {}) {
  if (!requireLogin()) return;
  shGoDashboard();
  const panel = shPanel();
  panel.innerHTML = `<div class="sh-loading"><i class="fas fa-spinner fa-spin"></i> Loading your jobs...</div>`;
  if (!opts.quiet) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  let data;
  try { data = await shApi("/jobs/my/posted"); } catch (e) { panel.innerHTML = `<div class="sh-loading">Could not load your jobs. <button class="sh-btn ghost" onclick="loadMyJobs()">Try again</button></div>`; return; }
  if (!data.success) { panel.innerHTML = `<div class="sh-loading">${shEsc(data.message || "Could not load your jobs")}</div>`; return; }
  shMyJobs = data.jobs || [];
  renderMyJobs();
}

function renderMyJobs() {
  const panel = shPanel();
  const active = shMyJobs.filter((j) => j.status !== "completed");
  const done = shMyJobs.filter((j) => j.status === "completed");
  const list = shJobsTab === "completed" ? done : active;
  const newQuotes = active.reduce((n, j) => n + (j.quotes || []).filter((q) => q.status === "pending").length, 0);
  panel.innerHTML = `
    <div class="sh-panel-head"><h2><i class="fas fa-tasks" style="color:var(--primary)"></i> My Jobs</h2>
      <button class="sh-btn pri" onclick="document.getElementById('post-job-modal').classList.add('active')"><i class="fas fa-plus"></i> Post a Job</button></div>
    <div class="sh-tabs">
      <button class="sh-tab ${shJobsTab === "active" ? "on" : ""}" onclick="shJobsTab='active';renderMyJobs()">Active (${active.length})${newQuotes ? ` · ${newQuotes} new quote${newQuotes > 1 ? "s" : ""}` : ""}</button>
      <button class="sh-tab ${shJobsTab === "completed" ? "on" : ""}" onclick="shJobsTab='completed';renderMyJobs()">Completed (${done.length})</button>
    </div>
    ${list.length ? list.map(shJobCard).join("") : `<div class="sh-job"><div class="sh-loading">${shJobsTab === "completed" ? "No completed jobs yet. Jobs you mark as completed appear here, visible only to you." : "You have no active jobs. Post a job to start receiving quotes from service providers."}</div></div>`}`;
}

function shJobCard(job) {
  const quotes = job.quotes || [];
  const accepted = quotes.find((q) => q.status === "accepted");
  const isDone = job.status === "completed";
  const acts = [];
  if (!isDone) {
    if (job.status === "pending-completion") {
      acts.push(`<button class="sh-btn ok" onclick="confirmJobCompletion('${job.id}')"><i class="fas fa-check-double"></i> Confirm Completion</button>`);
      acts.push(`<button class="sh-btn danger" onclick="rejectJobCompletion('${job.id}')"><i class="fas fa-flag"></i> Dispute</button>`);
    } else {
      acts.push(`<button class="sh-btn ok" onclick="markJobCompleted('${job.id}')"><i class="fas fa-check"></i> Mark as Completed</button>`);
    }
    if (job.conversationId) acts.push(`<button class="sh-btn ghost" onclick="openJobChat('${job.conversationId}','${shEsc(job.assignedProviderName || "Provider").replace(/'/g, "")}')"><i class="fas fa-comments"></i> Job Chat</button>`);
    if (job.status === "open") acts.push(`<button class="sh-btn danger" onclick="cancelJob('${job.id}')"><i class="fas fa-times"></i> Cancel Job</button>`);
  }
  return `<div class="sh-job" id="job-${job.id}">
    <div class="sh-job-top"><div>
      <h3>${shEsc(job.title)}</h3>
      <div class="sh-meta"><span><i class="fas fa-map-marker-alt"></i> ${shEsc(job.county)}${job.subcounty ? ", " + shEsc(job.subcounty) : ""}</span>
        <span><i class="fas fa-money-bill-wave"></i> ${shKES(job.budgetMin)} – ${shKES(job.budgetMax)}</span>
        <span><i class="far fa-calendar"></i> ${isDone ? "Completed " + shDate(job.completedAt) : "Posted " + shDate(job.createdAt)}</span></div>
    </div>${shChip(SH_STATUS, job.status)}</div>
    ${job.status === "awaiting-provider" ? `<div class="sh-assigned" style="background:#f3e5f5;color:#4a148c"><i class="fas fa-hourglass-half"></i> Offer sent to <b>${shEsc(job.assignedProviderName)}</b> for <b>${shKES(job.acceptedAmount)}</b>. Waiting for them to accept the job.</div>`
      : (accepted || job.assignedProviderName) ? `<div class="sh-assigned"><i class="fas fa-user-check"></i> <b>${shEsc(job.assignedProviderName || accepted.providerName)}</b> is doing this job for <b>${shKES(job.acceptedAmount || (accepted && accepted.amount))}</b>${job.plannedStartDate ? ` · starts ${shDate(job.plannedStartDate)}` : ""}</div>` : ""}
    ${acts.length ? `<div class="sh-actions">${acts.join("")}</div>` : ""}
    ${isDone ? "" : `<div class="sh-quotes"><h4><i class="fas fa-file-invoice-dollar" style="color:var(--primary)"></i> Quotes received (${quotes.length})</h4>
      ${quotes.length ? quotes.map((q) => `<div class="sh-q" role="button" tabindex="0" onclick="openQuote('${job.id}','${q.id}')" onkeydown="if(event.key==='Enter')openQuote('${job.id}','${q.id}')">
          <div><b>${shEsc(q.providerName || "Service provider")}</b><br><small>${shDate(q.createdAt)}${q.estimatedDays ? ` · ${q.estimatedDays} day(s)` : ""}</small></div>
          <div style="text-align:right"><div class="sh-q-amt">${shKES(q.amount)}</div>${shChip(SH_QSTATUS, q.status)}</div>
          <i class="fas fa-chevron-right" style="color:var(--medium-gray)"></i></div>`).join("")
        : `<div class="sh-empty">No quotes yet. Service providers' quotes will appear here.</div>`}</div>`}
  </div>`;
}

function openQuote(jobId, quoteId) {
  const job = shMyJobs.find((j) => j.id === jobId);
  const q = job && (job.quotes || []).find((x) => x.id === quoteId);
  if (!job || !q) { showNotification("Quote not found. Refreshing...", "info"); loadMyJobs(); return; }
  document.getElementById("qv-title").innerHTML = `<i class="fas fa-file-invoice-dollar" style="color:var(--primary);margin-right:8px"></i>Quote from ${shEsc(q.providerName || "provider")}`;
  document.getElementById("qv-body").innerHTML = `
    <div class="sh-qd-row"><span>Job</span><b>${shEsc(job.title)}</b></div>
    <div class="sh-qd-row"><span>Quoted amount</span><b style="color:var(--primary)">${shKES(q.amount)}</b></div>
    <div class="sh-qd-row"><span>Your budget</span><span>${shKES(job.budgetMin)} – ${shKES(job.budgetMax)}</span></div>
    ${q.estimatedDays ? `<div class="sh-qd-row"><span>Estimated time</span><span>${q.estimatedDays} day(s)</span></div>` : ""}
    <div class="sh-qd-row"><span>Submitted</span><span>${shDate(q.createdAt)}</span></div>
    <div class="sh-qd-row"><span>Status</span>${shChip(SH_QSTATUS, q.status)}</div>
    <div class="sh-qd-msg">${q.message ? shEsc(q.message) : "<i>No message included with this quote.</i>"}</div>
    <p style="margin-top:12px;font-size:.82rem;color:var(--medium-gray)"><i class="fas fa-info-circle"></i> ServiceHub is free. You pay the provider directly for the work. We don't charge fees or handle payments.</p>`;
  const foot = [];
  foot.push(`<button class="sh-btn ghost" onclick="messageProvider('${q.providerId}','${job.id}')"><i class="fas fa-comments"></i> Message Provider</button>`);
  if (q.status === "pending" && job.status === "open") {
    foot.push(`<button class="sh-btn danger" onclick="rejectQuote('${q.id}','${job.id}')"><i class="fas fa-times"></i> Decline</button>`);
    foot.push(`<button class="sh-btn ok" onclick="acceptQuote('${q.id}','${job.id}')"><i class="fas fa-check"></i> Accept Quote</button>`);
  }
  document.getElementById("qv-foot").innerHTML = foot.join("");
  document.getElementById("quote-view-modal").classList.add("active");
}
function closeQuoteModal() { const m = document.getElementById("quote-view-modal"); if (m) m.classList.remove("active"); }

function messageProvider(providerId, jobId) {
  closeQuoteModal();
  const u = document.getElementById("new-chat-uid"), j = document.getElementById("new-chat-jobid");
  if (u && j && typeof handleStartConversation === "function") { u.value = providerId; j.value = jobId; showSection("chat"); handleStartConversation(); }
}

async function acceptQuote(quoteId, jobId) {
  if (!confirm("Accept this quote? The provider will be alerted and asked to accept the job. Other quotes stay on hold until they respond.")) return;
  const data = await shApi(`/quotes/${quoteId}/accept`, { method: "PUT" }).catch(() => ({ success: false }));
  closeQuoteModal();
  showNotification(data.success ? "Quote accepted. The provider has been alerted and must accept the job to start." : data.message || "Could not accept the quote", data.success ? "success" : "error");
  loadMyJobs({ quiet: true });
}
async function rejectQuote(quoteId, jobId) {
  if (!confirm("Decline this quote?")) return;
  const data = await shApi(`/quotes/${quoteId}/reject`, { method: "PUT" }).catch(() => ({ success: false }));
  closeQuoteModal();
  showNotification(data.success ? "Quote declined." : data.message || "Could not decline the quote", data.success ? "info" : "error");
  loadMyJobs({ quiet: true });
}
async function markJobCompleted(jobId) {
  if (!confirm("Mark this job as completed? It will move to your Completed jobs, visible only to you, and stop receiving quotes.")) return;
  const data = await shApi(`/jobs/${jobId}/complete`, { method: "PUT" }).catch(() => ({ success: false }));
  showNotification(data.success ? "Job marked as completed." : data.message || "Could not mark the job as completed", data.success ? "success" : "error");
  if (data.success) { shJobsTab = "completed"; loadDashboardStats(); }
  loadMyJobs({ quiet: true });
}
async function confirmJobCompletion(jobId) {
  if (!confirm("Confirm this job was completed to your satisfaction?")) return;
  const data = await shApi(`/jobs/${jobId}/confirm-completion`, { method: "PUT" }).catch(() => ({ success: false }));
  showNotification(data.success ? "Job confirmed as completed." : data.message || "Could not confirm completion", data.success ? "success" : "error");
  if (data.success) { shJobsTab = "completed"; loadDashboardStats(); }
  loadMyJobs({ quiet: true });
}
async function rejectJobCompletion(jobId) {
  if (!confirm("Dispute this completion? The job will go back to in progress.")) return;
  const data = await shApi(`/jobs/${jobId}/reject-completion`, { method: "PUT" }).catch(() => ({ success: false }));
  showNotification(data.success ? "Completion disputed. The job is back in progress." : data.message || "Could not dispute completion", data.success ? "info" : "error");
  loadMyJobs({ quiet: true });
}
async function cancelJob(jobId) {
  if (!confirm("Cancel this job? This cannot be undone.")) return;
  const data = await shApi(`/jobs/${jobId}`, { method: "DELETE" }).catch(() => ({ success: false }));
  showNotification(data.success ? "Job cancelled." : data.message || "Could not cancel the job", data.success ? "info" : "error");
  loadMyJobs({ quiet: true }); loadDashboardStats();
}
// legacy entry point (old "View Quotes" buttons): open the job in the new view
function loadJobQuotes(jobId) { loadMyJobs().then(() => { const el = document.getElementById("job-" + jobId); if (el) el.scrollIntoView({ behavior: "smooth" }); }); }

/* ---------- PROVIDER: job offers + assigned jobs ---------- */
async function loadMyAssignedJobs(opts = {}) {
  if (!requireLogin()) return;
  shGoDashboard();
  const panel = shPanel();
  panel.innerHTML = `<div class="sh-loading"><i class="fas fa-spinner fa-spin"></i> Loading your jobs...</div>`;
  if (!opts.quiet) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  const data = await shApi("/jobs/my/assigned").catch(() => ({ success: false }));
  if (!data.success) { panel.innerHTML = `<div class="sh-loading">Could not load your jobs. <button class="sh-btn ghost" onclick="loadMyAssignedJobs()">Try again</button></div>`; return; }
  const jobs = data.jobs || [];
  const offers = jobs.filter((j) => j.status === "awaiting-provider");
  const working = jobs.filter((j) => j.status !== "awaiting-provider");
  const today = new Date().toISOString().slice(0, 10);
  const meta = (job) => `<div class="sh-meta"><span><i class="fas fa-map-marker-alt"></i> ${shEsc(job.county)}${job.subcounty ? ", " + shEsc(job.subcounty) : ""}</span>
        <span><i class="fas fa-money-bill-wave"></i> ${shKES(job.acceptedAmount || job.budgetMin)}</span><span><i class="fas fa-user"></i> ${shEsc(job.clientName || "Client")}</span></div>`;
  panel.innerHTML = `<div class="sh-panel-head"><h2><i class="fas fa-briefcase" style="color:var(--primary)"></i> My Jobs</h2>
      <button class="sh-btn pri" onclick="showSection('find-services')"><i class="fas fa-search"></i> Find Jobs</button></div>
    ${offers.length ? `<div class="sh-assigned" style="margin:0 0 14px;background:#f3e5f5;color:#4a148c;font-weight:600"><i class="fas fa-bell"></i> You have ${offers.length} new job offer${offers.length > 1 ? "s" : ""}. Accept to start the job.</div>` : ""}
    ${offers.map((job) => `<div class="sh-job" style="border:2px solid #8e24aa"><div class="sh-job-top"><div><h3>${shEsc(job.title)}</h3>${meta(job)}</div>${shChip({ "awaiting-provider": ["New job offer", "#6a1b9a", "#f3e5f5"] }, "awaiting-provider")}</div>
        ${job.description ? `<div class="sh-empty" style="padding:0 20px 10px">${shEsc(job.description).slice(0, 220)}</div>` : ""}
        <div class="sh-actions" style="align-items:center"><label style="font-size:.85rem;color:var(--dark-gray)">Start date <input type="date" id="start-${job.id}" value="${today}" min="${today}" style="margin-left:6px;padding:7px;border:1px solid var(--light-gray);border-radius:8px"></label>
          <button class="sh-btn ok" onclick="providerAcceptJob('${job.id}')"><i class="fas fa-handshake"></i> Accept Job</button>
          <button class="sh-btn danger" onclick="providerDeclineJob('${job.id}')"><i class="fas fa-times"></i> Decline</button></div></div>`).join("")}
    ${working.map((job) => `<div class="sh-job"><div class="sh-job-top"><div><h3>${shEsc(job.title)}</h3>${meta(job)}
        ${job.plannedStartDate ? `<div class="sh-meta" style="margin-top:4px"><span><i class="far fa-calendar-check"></i> Start date ${shDate(job.plannedStartDate)}</span></div>` : ""}</div>${shChip(SH_STATUS, job.status)}</div>
      <div class="sh-actions">${job.status === "in-progress" ? `<button class="sh-btn ok" onclick="requestJobCompletion('${job.id}')"><i class="fas fa-check"></i> Mark Complete</button>` : `<span class="sh-empty"><i class="fas fa-clock"></i> Waiting for the client to confirm completion</span>`}
        ${job.conversationId ? `<button class="sh-btn ghost" onclick="openJobChat('${job.conversationId}','${shEsc(job.clientName || "Client").replace(/'/g, "")}')"><i class="fas fa-comments"></i> Job Chat</button>` : ""}</div></div>`).join("")}
    ${!jobs.length ? `<div class="sh-job"><div class="sh-loading">No jobs yet. Send quotes on open jobs. When a client accepts your quote, the offer appears here for you to accept.</div></div>` : ""}`;
}
async function providerAcceptJob(jobId) {
  const d = document.getElementById("start-" + jobId);
  const startDate = d && d.value ? d.value : undefined;
  if (!confirm(`Accept this job${startDate ? " and start on " + startDate : ""}? The client will be notified and a job chat will open. Agree on payment directly with the client; ServiceHub charges nothing.`)) return;
  const data = await shApi(`/jobs/${jobId}/provider-accept`, { method: "PUT", body: JSON.stringify({ startDate }) }).catch(() => ({ success: false }));
  showNotification(data.success ? "Job accepted! The client has been notified. Agree on the details in the job chat." : data.message || "Could not accept the job", data.success ? "success" : "error");
  loadMyAssignedJobs({ quiet: true }); loadDashboardStats();
}
async function providerDeclineJob(jobId) {
  if (!confirm("Decline this job offer? The client will be able to choose another provider.")) return;
  const data = await shApi(`/jobs/${jobId}/provider-decline`, { method: "PUT" }).catch(() => ({ success: false }));
  showNotification(data.success ? "Job offer declined." : data.message || "Could not decline the job", data.success ? "info" : "error");
  loadMyAssignedJobs({ quiet: true });
}
function openJobChat(convId, otherName) {
  showSection("chat");
  if (typeof openConversation === "function") setTimeout(() => openConversation(convId, otherName), 400);
}
async function requestJobCompletion(jobId) {
  if (!confirm("Mark this job as complete? The client will be asked to confirm.")) return;
  const data = await shApi(`/jobs/${jobId}/request-completion`, { method: "PUT" }).catch(() => ({ success: false }));
  showNotification(data.success ? "Marked as complete. Waiting for client confirmation." : data.message || "Could not mark complete", data.success ? "success" : "error");
  loadMyAssignedJobs({ quiet: true });
}

/* show the new quote under the job right away if the client is looking at the dashboard */
(function liveQuotes() {
  const hook = () => {
    if (typeof socket !== "undefined" && socket && !socket.__shHooked) {
      socket.__shHooked = true;
      socket.on("notification", (n) => {
        if (n && n.message) showNotification(n.message, n.type === "offer_declined" ? "warning" : "success");
        else if (n && n.type === "new_quote") showNotification("New quote received on one of your jobs.", "success");
        const d = document.getElementById("dashboard"); if (d && d.classList.contains("active")) loadDashboardPanel();
      });
    }
  };
  setInterval(hook, 3000);
})();

/* account menu items (Dashboard, Messages, Email Settings) were not wired to navigation */
document.addEventListener("click", (e) => {
  const item = e.target.closest(".dropdown-item[data-section]");
  if (!item) return;
  e.preventDefault();
  showSection(item.getAttribute("data-section"));
  const dd = document.getElementById("user-dropdown") || item.closest(".dropdown-menu, .user-dropdown");
  if (dd) dd.classList.remove("show");
});

/* ---------- ACCOUNT folder inside the dashboard ---------- */
function loadAccountPanel(opts = {}) {
  if (!requireLogin()) return;
  shGoDashboard();
  const u = currentUser || {};
  const initials = String(u.name || "U").split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  const tile = (icon, title, desc, action, danger) => `<div class="sh-q" role="button" tabindex="0" onclick="${action}" onkeydown="if(event.key==='Enter'){${action}}" style="padding:16px;${danger ? "border-color:#f5c2c2" : ""}">
      <div style="display:flex;gap:14px;align-items:center"><i class="fas ${icon}" style="font-size:1.4rem;width:28px;text-align:center;color:${danger ? "#c62828" : "var(--primary)"}"></i>
      <div><b style="${danger ? "color:#c62828" : ""}">${title}</b><br><small>${desc}</small></div></div><i class="fas fa-chevron-right" style="color:var(--medium-gray)"></i></div>`;
  const panel = shPanel();
  panel.innerHTML = `
    <div class="sh-panel-head"><h2><i class="fas fa-user-circle" style="color:var(--primary)"></i> My Account</h2>
      <button class="sh-btn ghost" onclick="loadDashboardPanel()"><i class="fas fa-arrow-left"></i> Back to My Jobs</button></div>
    <div class="sh-job"><div class="sh-job-top" style="align-items:center;justify-content:flex-start;gap:16px">
      <div style="width:64px;height:64px;border-radius:50%;background:var(--gradient-primary,var(--primary));color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:800;flex:0 0 64px">${shEsc(initials)}</div>
      <div><h3 style="margin:0">${shEsc(u.name || "")}</h3>
        <div class="sh-meta"><span><i class="fas fa-envelope"></i> ${shEsc(u.email || "")}</span>${u.phone ? `<span><i class="fas fa-phone"></i> ${shEsc(u.phone)}</span>` : ""}
        ${u.county ? `<span><i class="fas fa-map-marker-alt"></i> ${shEsc(u.county)}</span>` : ""}</div>
        <div style="margin-top:6px">${shChip({ client: ["Client", "#1565c0", "#e3f2fd"], "service-provider": ["Service Provider", "#2e7d32", "#e8f5e9"] }, u.role)}</div></div></div></div>
    <div style="display:grid;gap:10px">
      ${tile("fa-user-edit", "Edit Profile", "Name, phone, county, bio" + (u.role === "service-provider" ? " and skills" : ""), "openProfileSettings()")}
      ${tile("fa-comments", "Messages", "Chats with clients and providers", "showSection('chat')")}
      ${tile("fa-envelope-open-text", "Email Settings", "Choose which emails you receive", "showSection('email-settings')")}
      ${tile("fa-key", "Change Password", "We'll email you a secure reset link", "accountPasswordReset()")}
      ${tile("fa-sign-out-alt", "Log Out", "Sign out of ServiceHub on this device", "handleLogout()", true)}
    </div>`;
  if (!opts.quiet) panel.scrollIntoView({ behavior: "smooth", block: "start" });
}
async function accountPasswordReset() {
  const email = currentUser && currentUser.email;
  if (!email) return;
  if (!confirm(`Send a password reset link to ${email}?`)) return;
  const res = await fetch(`${API_BASE}/auth/password-reset`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }).catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : {};
  showNotification(data.success ? "Reset link sent. Check your email (and spam folder)." : data.message || "Could not send the reset link", data.success ? "success" : "error");
}
