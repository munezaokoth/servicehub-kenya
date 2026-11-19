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
  const acts = [`<button class="sh-btn ghost" onclick="openTrack('${job.id}')"><i class="fas fa-route"></i> Track Job</button>`];
  if (!isDone) {
    if (job.status === "pending-completion") {
      acts.push(`<button class="sh-btn ok" onclick="confirmJobCompletion('${job.id}')"><i class="fas fa-check-double"></i> Confirm Completion</button>`);
      acts.push(`<button class="sh-btn danger" onclick="rejectJobCompletion('${job.id}')"><i class="fas fa-flag"></i> Dispute</button>`);
    } else {
      acts.push(`<button class="sh-btn ok" onclick="markJobCompleted('${job.id}')"><i class="fas fa-check"></i> Mark as Completed</button>`);
    }
    if ((job.photos || []).length < SH_MAX_PHOTOS) acts.push(`<label class="sh-btn ghost" style="cursor:pointer"><input type="file" accept="image/*" multiple hidden onchange="shAddJobPhotos('${job.id}', this)"><i class="fas fa-camera"></i> Add Photos</label>`);
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
    ${shPhotoStrip(job)}
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
  const offers = jobs.filter((j) => j.status === "awaiting-provider" || (j.acceptedQuoteId && !j.providerAcceptedAt && j.status !== "in-progress" && j.status !== "pending-completion"));
  const working = jobs.filter((j) => !offers.includes(j));
  const today = new Date().toISOString().slice(0, 10);
  const meta = (job) => `<div class="sh-meta"><span><i class="fas fa-map-marker-alt"></i> ${shEsc(job.county)}${job.subcounty ? ", " + shEsc(job.subcounty) : ""}</span>
        <span><i class="fas fa-money-bill-wave"></i> ${shKES(job.acceptedAmount || job.budgetMin)}</span><span><i class="fas fa-user"></i> ${shEsc(job.clientName || "Client")}</span></div>`;
  panel.innerHTML = `<div class="sh-panel-head"><h2><i class="fas fa-briefcase" style="color:var(--primary)"></i> My Jobs</h2>
      <button class="sh-btn pri" onclick="showSection('find-services')"><i class="fas fa-search"></i> Find Jobs</button></div>
    ${offers.length ? `<div class="sh-assigned" style="margin:0 0 14px;background:#f3e5f5;color:#4a148c;font-weight:600"><i class="fas fa-bell"></i> You have ${offers.length} new job offer${offers.length > 1 ? "s" : ""}. Accept to start the job.</div>` : ""}
    ${offers.map((job) => `<div class="sh-job" style="border:2px solid #8e24aa"><div class="sh-job-top"><div><h3>${shEsc(job.title)}</h3>${meta(job)}</div>${shChip({ "awaiting-provider": ["New job offer", "#6a1b9a", "#f3e5f5"] }, "awaiting-provider")}</div>
        ${job.description ? `<div class="sh-empty" style="padding:0 20px 10px">${shEsc(job.description).slice(0, 220)}</div>` : ""}
        ${shPhotoStrip(job)}
        <div class="sh-actions" style="align-items:center"><label style="font-size:.85rem;color:var(--dark-gray)">Start date <input type="date" id="start-${job.id}" value="${today}" min="${today}" style="margin-left:6px;padding:7px;border:1px solid var(--light-gray);border-radius:8px"></label>
          <button class="sh-btn ok" onclick="providerAcceptJob('${job.id}')"><i class="fas fa-handshake"></i> Accept Job</button>
          <button class="sh-btn danger" onclick="providerDeclineJob('${job.id}')"><i class="fas fa-times"></i> Decline</button></div></div>`).join("")}
    ${working.map((job) => `<div class="sh-job"><div class="sh-job-top"><div><h3>${shEsc(job.title)}</h3>${meta(job)}
        ${job.plannedStartDate ? `<div class="sh-meta" style="margin-top:4px"><span><i class="far fa-calendar-check"></i> Start date ${shDate(job.plannedStartDate)}</span></div>` : ""}</div>${shChip(SH_STATUS, job.status)}</div>
      <div class="sh-actions">${job.status === "in-progress" ? `<button class="sh-btn ok" onclick="requestJobCompletion('${job.id}')"><i class="fas fa-check"></i> Mark Complete</button>` : `<span class="sh-empty"><i class="fas fa-clock"></i> Waiting for the client to confirm completion</span>`}
        <button class="sh-btn ghost" onclick="openTrack('${job.id}')"><i class="fas fa-route"></i> Track &amp; Update</button>
        ${job.conversationId ? `<button class="sh-btn ghost" onclick="openJobChat('${job.conversationId}','${shEsc(job.clientName || "Client").replace(/'/g, "")}')"><i class="fas fa-comments"></i> Job Chat</button>` : ""}</div>${shPhotoStrip(job)}</div>`).join("")}
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
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${shRoles().map((r) => shChip({ client: ["Client", "#1565c0", "#e3f2fd"], "service-provider": ["Service Provider", "#2e7d32", "#e8f5e9"] }, r)).join("")}</div></div></div></div>
    <div style="display:grid;gap:10px">
      ${u.isAdmin ? tile("fa-user-shield", "Admin Portal", "Manage users, jobs and messages", "window.location.href='/admin'") : ""}
      ${shIsProvider()
        ? tile("fa-exchange-alt", u.role === "service-provider" ? "Switch to Client mode" : "Switch to Service Provider mode", u.role === "service-provider" ? "Post jobs and hire providers" : "Find jobs and send quotes", u.role === "service-provider" ? "switchRole('client')" : "switchRole('service-provider')")
        : tile("fa-tools", "Become a Service Provider", "Offer your services and get hired, using this same account", "openBecomeProvider()")}
      ${tile("fa-user-edit", "Edit Profile", "Name, phone, county, bio" + (shIsProvider() ? " and skills" : ""), "openProfileSettings()")}
      ${tile("fa-comments", "Messages", "Chats with clients and providers", "showSection('chat')")}
      ${tile("fa-envelope-open-text", "Email Settings", "Choose which emails you receive", "showSection('email-settings')")}
      ${tile("fa-key", "Change Password", "Set a new password for your account", "accountPasswordReset()")}
      ${tile("fa-sign-out-alt", "Log Out", "Sign out of ServiceHub on this device", "handleLogout()", true)}
    </div>`;
  if (!opts.quiet) panel.scrollIntoView({ behavior: "smooth", block: "start" });
}
// Change password while signed in (no email needed). "Forgot it?" still emails a reset link.
function accountPasswordReset() {
  if (!requireLogin()) return;
  let m = document.getElementById("sh-change-pw");
  if (!m) {
    m = document.createElement("div");
    m.className = "modal";
    m.id = "sh-change-pw";
    m.innerHTML = `<div class="modal-content" style="max-width:460px">
      <div class="modal-header"><h2 class="modal-title"><i class="fas fa-key" style="color:var(--primary);margin-right:10px"></i>Change Password</h2>
        <button class="modal-close" type="button" aria-label="Close" onclick="document.getElementById('sh-change-pw').classList.remove('active')">&times;</button></div>
      <div class="modal-body"><form id="sh-cpw-form" autocomplete="on">
        <input type="text" name="username" autocomplete="username" value="" hidden>
        <div class="form-group" id="sh-cpw-cur-g"><label class="form-label" for="sh-cpw-cur">Current password</label>
          <input id="sh-cpw-cur" type="password" class="form-control" autocomplete="current-password"></div>
        <div class="form-group"><label class="form-label" for="sh-cpw-new">New password</label>
          <input id="sh-cpw-new" type="password" class="form-control" autocomplete="new-password" minlength="8" required>
          <small style="color:var(--medium-gray)">At least 8 characters.</small></div>
        <div class="form-group"><label class="form-label" for="sh-cpw-new2">Confirm new password</label>
          <input id="sh-cpw-new2" type="password" class="form-control" autocomplete="new-password" minlength="8" required></div>
        <label style="display:flex;gap:8px;align-items:center;font-size:.9rem;margin:4px 0 14px"><input type="checkbox" id="sh-cpw-show"> Show passwords</label>
        <button type="submit" class="btn btn-primary btn-block" id="sh-cpw-go"><i class="fas fa-check"></i> Change Password</button>
        <div style="text-align:center;margin-top:14px;font-size:.9rem"><a href="#" id="sh-cpw-forgot">Forgot your current password? Email me a reset link</a></div>
      </form></div></div>`;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => { if (e.target === m) m.classList.remove("active"); });
    m.querySelector("#sh-cpw-show").onchange = (e) => m.querySelectorAll("input[type=password],input[data-pw]").forEach((i) => { i.type = e.target.checked ? "text" : "password"; i.dataset.pw = "1"; });
    m.querySelector("#sh-cpw-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const cur = m.querySelector("#sh-cpw-cur").value, nw = m.querySelector("#sh-cpw-new").value, nw2 = m.querySelector("#sh-cpw-new2").value;
      if (nw.length < 8) { showNotification("The new password must be at least 8 characters", "error"); return; }
      if (nw !== nw2) { showNotification("The new passwords do not match", "error"); return; }
      const btn = m.querySelector("#sh-cpw-go"); btn.disabled = true;
      const d = await shApi("/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword: cur, newPassword: nw }) }).catch(() => ({ success: false, message: "Connection error. Please try again." }));
      btn.disabled = false;
      if (!d.success) { showNotification(d.message || "Could not change your password", "error"); return; }
      m.classList.remove("active");
      m.querySelector("#sh-cpw-form").reset();
      showNotification(d.message || "Password changed.", "success");
    });
    m.querySelector("#sh-cpw-forgot").onclick = async (e) => {
      e.preventDefault();
      const email = currentUser && currentUser.email;
      if (!email) return;
      const res = await fetch(`${API_BASE}/auth/password-reset`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }).catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : {};
      showNotification(data.success ? `Reset link sent to ${email}. Check your inbox and spam folder.` : data.message || "Could not send the reset link", data.success ? "success" : "error");
    };
  }
  const social = currentUser && currentUser.authProvider && !currentUser.hasPassword;
  m.querySelector("#sh-cpw-cur-g").style.display = social ? "none" : "";
  m.querySelector("input[name=username]").value = (currentUser && currentUser.email) || "";
  m.classList.add("active");
  setTimeout(() => m.querySelector(social ? "#sh-cpw-new" : "#sh-cpw-cur").focus(), 50);
}

/* =====================================================================
   CHAT v2 — WhatsApp-style layout: no truncated messages, mobile list/chat views
   ===================================================================== */
(function chatStyles() {
  const css = `
  #chat .chat-container{height:min(78vh,720px);display:flex;flex-direction:row}
  #chat .chat-main{min-width:0;display:flex;flex-direction:column;background:var(--white)}
  #chat .chat-header{padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex:0 0 auto}
  #chat .chat-user-info{display:flex;align-items:center;gap:10px;min-width:0;flex:1}
  #chat .chat-user-info>div:last-child{min-width:0}
  #chat .chat-user-avatar{width:42px;height:42px;flex:0 0 42px;font-size:.95rem}
  #chat .chat-user-name{font-size:1rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-transform:none}
  #chat .chat-user-status{font-size:.78rem;color:var(--medium-gray)}
  #chat .chat-actions{display:flex;gap:6px;flex:0 0 auto}
  #chat .chat-actions .btn{width:40px;height:40px;padding:0;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;min-width:0}
  .shc-back{display:none;border:0;background:transparent;font-size:1.15rem;color:var(--primary);width:34px;height:34px;border-radius:50%;cursor:pointer;flex:0 0 34px}
  #chat .chat-messages{display:block!important;justify-content:initial!important;align-items:initial!important;padding:14px 12px!important;overflow-y:auto;flex:1 1 auto;min-height:0;
    background:var(--light,#eef3f8) radial-gradient(circle at 1px 1px,rgba(0,0,0,.04) 1px,transparent 0) 0 0/18px 18px}
  .shc-row{display:flex;margin:3px 0}
  .shc-row.me{justify-content:flex-end}
  .shc-b{max-width:min(82%,560px);padding:8px 12px 6px;border-radius:16px;box-shadow:0 1px 2px rgba(0,0,0,.08);font-size:.95rem;line-height:1.45;
    white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;background:var(--white);color:var(--dark)}
  .shc-row.me .shc-b{background:var(--primary);color:#fff;border-bottom-right-radius:4px}
  .shc-row.them .shc-b{border-bottom-left-radius:4px}
  .shc-name{font-size:.74rem;font-weight:700;color:var(--primary);margin-bottom:2px}
  .shc-time{font-size:.68rem;opacity:.75;text-align:right;margin-top:3px;white-space:nowrap}
  .shc-day{text-align:center;margin:12px 0 8px}
  .shc-day span{background:rgba(255,255,255,.9);color:var(--dark-gray);font-size:.74rem;font-weight:600;padding:4px 12px;border-radius:999px;box-shadow:0 1px 2px rgba(0,0,0,.06)}
  .shc-sys{text-align:center;margin:10px auto;max-width:90%}
  .shc-sys span{display:inline-block;background:#fff8e1;color:#795548;font-size:.82rem;padding:8px 12px;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere}
  .shc-empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--medium-gray);padding:30px}
  #chat .chat-input{display:flex;align-items:flex-end;gap:8px;padding:10px;flex:0 0 auto;border-top:1px solid var(--light-gray);background:var(--white)}
  #chat .chat-input-field{flex:1;min-width:0;resize:none;max-height:130px;min-height:44px;padding:11px 16px;border-radius:22px;line-height:1.4;font:inherit;font-size:.95rem}
  #chat #send-message{width:46px;height:46px;flex:0 0 46px;padding:0;border-radius:50%;display:inline-flex;align-items:center;justify-content:center}
  .conversation-item.active{background:rgba(52,152,219,.12)!important}
  body.shc-in-chat .theme-toggle{display:none!important}
  @media (max-width:768px){
    #chat .section{padding-top:10px;padding-bottom:10px}
    #chat .container{padding-left:8px;padding-right:8px}
    #chat .chat-container{height:calc(100dvh - 120px);min-height:460px;flex-direction:column}
    #chat .chat-sidebar{width:100%!important;height:100%!important;border-right:0}
    #chat .chat-main{display:none}
    #chat .chat-container.shc-open .chat-sidebar{display:none}
    #chat .chat-container.shc-open .chat-main{display:flex;height:100%}
    #chat .chat-container.shc-open ~ .shc-backdash{display:none}
    .shc-back{display:inline-flex;align-items:center;justify-content:center}
    #chat .chat-actions .dropdown{display:none}
    .shc-b{max-width:86%}
  }`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
})();

const shcTime = (d) => new Date(d || Date.now()).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
function shcDayLabel(d) {
  const x = new Date(d || Date.now()), t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  if (x.toDateString() === t.toDateString()) return "Today";
  if (x.toDateString() === y.toDateString()) return "Yesterday";
  return x.toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
let shcLastDay = "";
function shcMsgHTML(msg) {
  let html = "";
  const day = shcDayLabel(msg.createdAt);
  if (day !== shcLastDay) { html += `<div class="shc-day"><span>${day}</span></div>`; shcLastDay = day; }
  if (msg.system) return html + `<div class="shc-sys"><span><i class="fas fa-info-circle"></i> ${shEsc(msg.text)}</span></div>`;
  const mine = currentUser && msg.senderId === currentUser.uid;
  return html + `<div class="shc-row ${mine ? "me" : "them"}"><div class="shc-b">${mine ? "" : `<div class="shc-name">${shEsc(msg.senderName || "")}</div>`}${shEsc(msg.text)}<div class="shc-time">${shcTime(msg.createdAt)}</div></div></div>`;
}
function shcScrollBottom() { const el = document.getElementById("chat-messages"); if (el) el.scrollTop = el.scrollHeight; }
function shcInitials(name) { return String(name || "?").split(" ").filter(Boolean).map((n) => n[0]).join("").toUpperCase().slice(0, 2) || "?"; }

async function loadConversations() {
  if (!getToken()) return;
  const listEl = document.getElementById("conversation-list");
  const data = await shApi("/chat/conversations").catch(() => ({ success: false }));
  if (!listEl) return;
  const active = (document.getElementById("active-conversation-id") || {}).value;
  if (data.success && data.conversations && data.conversations.length) {
    listEl.innerHTML = data.conversations.map((conv) => {
      const otherName = Object.entries(conv.participantNames || {}).find(([k]) => k !== currentUser.uid)?.[1] || "User";
      const unread = (conv.unreadCount && conv.unreadCount[currentUser.uid]) || 0;
      const safeName = shEsc(otherName).replace(/'/g, "&#39;");
      return `<div class="conversation-item ${conv.id === active ? "active" : ""}" onclick="openConversation('${conv.id}', this.dataset.name)" data-name="${shEsc(otherName)}" style="display:flex;align-items:center;gap:12px;padding:12px 14px;cursor:pointer;border-bottom:1px solid var(--light-gray);">
        <div style="width:46px;height:46px;border-radius:50%;background:var(--gradient-primary,var(--primary));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;flex-shrink:0;">${shEsc(shcInitials(otherName))}</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <span style="font-weight:700;color:var(--dark);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${safeName}</span>
            <span style="font-size:.72rem;color:${unread ? "var(--primary)" : "var(--medium-gray)"};white-space:nowrap">${conv.lastMessageAt ? shcTime(conv.lastMessageAt) : ""}</span></div>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <span style="color:var(--medium-gray);font-size:.84rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${shEsc(conv.lastMessage || "No messages yet")}</span>
            ${unread ? `<span style="background:var(--primary);color:#fff;border-radius:999px;min-width:20px;height:20px;padding:0 6px;display:inline-flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;">${unread}</span>` : ""}</div>
        </div></div>`;
    }).join("");
  } else {
    listEl.innerHTML = `<div class="shc-empty"><i class="fas fa-comments" style="font-size:2.6rem;margin-bottom:12px"></i><b>No conversations yet</b><span>Chats with clients and providers appear here.</span></div>`;
  }
}

async function openConversation(convId, otherName) {
  otherName = otherName || "Chat";
  try { joinConversationRoom(convId); } catch (e) {}
  document.getElementById("active-conversation-id").value = convId;
  document.getElementById("current-chat-user").textContent = otherName;
  document.getElementById("current-chat-status").textContent = "Online";
  const av = document.getElementById("current-chat-avatar"); if (av) av.textContent = shcInitials(otherName);
  const input = document.getElementById("chat-input");
  input.disabled = false; document.getElementById("send-message").disabled = false;
  input.placeholder = `Message ${otherName}...`;
  const cont = document.querySelector("#chat .chat-container"); if (cont) cont.classList.add("shc-open");
  document.querySelectorAll(".conversation-item").forEach((el) => el.classList.toggle("active", el.getAttribute("onclick").includes(convId)));
  const msgsEl = document.getElementById("chat-messages");
  msgsEl.innerHTML = `<div class="shc-empty"><i class="fas fa-spinner fa-spin"></i></div>`;
  const data = await shApi(`/chat/conversations/${convId}/messages`).catch(() => ({ success: false }));
  shcLastDay = "";
  if (data.success && data.messages && data.messages.length) msgsEl.innerHTML = data.messages.map(shcMsgHTML).join("");
  else msgsEl.innerHTML = `<div class="shc-empty"><i class="fas fa-comment-dots" style="font-size:2.6rem;margin-bottom:12px"></i><b>No messages yet</b><span>Say hello to ${shEsc(otherName)}.</span></div>`;
  shcScrollBottom();
  if (window.matchMedia("(min-width:769px)").matches) input.focus();
}

function appendMessage(msg, isMine) {
  const msgsEl = document.getElementById("chat-messages");
  if (!msgsEl) return;
  const empty = msgsEl.querySelector(".shc-empty, .text-center"); if (empty) empty.remove();
  if (isMine && currentUser) msg = { ...msg, senderId: currentUser.uid };
  msgsEl.insertAdjacentHTML("beforeend", shcMsgHTML(msg));
  shcScrollBottom();
  const input = document.getElementById("chat-input"); if (input && isMine) { input.style.height = ""; }
}

function closeChatView() {
  const cont = document.querySelector("#chat .chat-container"); if (cont) cont.classList.remove("shc-open");
  document.getElementById("active-conversation-id").value = "";
  loadConversations();
}

(function chatInputBehaviour() {
  const input = document.getElementById("chat-input");
  if (!input) return;
  const grow = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 130) + "px"; };
  input.addEventListener("input", grow);
  input.addEventListener("keydown", (e) => {
    const touch = window.matchMedia("(pointer:coarse)").matches;
    if (e.key === "Enter" && !e.shiftKey && !touch) { e.preventDefault(); handleSendMessage(); setTimeout(grow, 50); }
  });
  // on touch phones Enter makes a new line; the send button sends
})();

(function chatBodyClass() {
  const sec = document.getElementById("chat");
  if (!sec) return;
  const upd = () => document.body.classList.toggle("shc-in-chat", sec.classList.contains("active"));
  new MutationObserver(upd).observe(sec, { attributes: true, attributeFilter: ["class"] }); upd();
})();

/* =====================================================================
   JOB PHOTOS — client attaches photos (compressed on the phone before upload)
   ===================================================================== */
(function photoStyles() {
  const css = `
  .shp-picker{display:flex;flex-wrap:wrap;gap:8px}
  .shp-th{position:relative;width:78px;height:78px;border-radius:10px;overflow:hidden;background:#eee;flex:0 0 78px}
  .shp-th img{width:100%;height:100%;object-fit:cover;cursor:zoom-in;display:block}
  .shp-th button{position:absolute;top:3px;right:3px;width:22px;height:22px;border-radius:50%;border:0;background:rgba(0,0,0,.65);color:#fff;font-size:.8rem;line-height:22px;cursor:pointer;padding:0}
  .shp-add{width:78px;height:78px;border:2px dashed var(--light-gray);border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;color:var(--primary);font-size:.75rem;font-weight:600;flex:0 0 78px}
  .shp-add:hover{border-color:var(--primary)}
  .sh-photos{display:flex;gap:8px;overflow-x:auto;padding:0 20px 12px;scrollbar-width:thin}
  .sh-photos img{width:84px;height:84px;object-fit:cover;border-radius:10px;cursor:zoom-in;flex:0 0 84px;background:#eee}
  #detail-job-images{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}
  #detail-job-images img{width:150px;height:150px;object-fit:cover;border-radius:12px;cursor:zoom-in}
  @media(max-width:600px){.sh-photos{padding:0 14px 12px}#detail-job-images img{width:calc(50% - 5px);height:140px}}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
})();

const SH_MAX_PHOTOS = 6;
let shPendingPhotos = [];

function shCompress(file, maxSide = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error("Not an image"));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      const k = Math.min(1, maxSide / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      let q = quality, out = c.toDataURL("image/jpeg", q);
      while (out.length > 950000 && q > 0.35) { q -= 0.1; out = c.toDataURL("image/jpeg", q); }
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image")); };
    img.src = url;
  });
}
async function shFilesToPhotos(files, room) {
  const list = [...(files || [])].slice(0, room);
  const out = [];
  for (const f of list) { try { out.push(await shCompress(f)); } catch (e) { showNotification(`Skipped ${f.name}: not a supported image`, "warning"); } }
  if (files && files.length > room) showNotification(`Only ${SH_MAX_PHOTOS} photos per job. Extra photos were skipped.`, "info");
  return out;
}

function renderPostJobPhotos() {
  const box = document.getElementById("job-photo-picker");
  if (!box) return;
  box.innerHTML = shPendingPhotos.map((d, i) => `<div class="shp-th"><img src="${d}" alt="Job photo ${i + 1}" onclick="openImageModal(this.src)"><button type="button" aria-label="Remove photo" onclick="shPendingPhotos.splice(${i},1);renderPostJobPhotos()">×</button></div>`).join("")
    + (shPendingPhotos.length < SH_MAX_PHOTOS ? `<label class="shp-add"><input type="file" accept="image/*" multiple hidden onchange="shAddPendingPhotos(this)"><i class="fas fa-camera" style="font-size:1.3rem"></i><span>Add photo</span></label>` : "");
}
async function shAddPendingPhotos(input) {
  const room = SH_MAX_PHOTOS - shPendingPhotos.length;
  const add = await shFilesToPhotos(input.files, room);
  shPendingPhotos.push(...add);
  input.value = "";
  renderPostJobPhotos();
}
document.addEventListener("DOMContentLoaded", renderPostJobPhotos);
renderPostJobPhotos();

async function handlePostJob() {
  const v = (id) => { const el = document.getElementById(id); return el ? el.value : ""; };
  const title = v("job-title").trim(), category = v("job-category"), county = v("job-county"), description = v("job-description").trim();
  const budgetMin = v("job-budget-min"), budgetMax = v("job-budget-max"), subcounty = v("job-subcounty"), urgency = v("job-urgency") || "normal";
  if (!title || !category || !county || !description || !budgetMin || !budgetMax) { showNotification("Please fill all required fields", "error"); return; }
  if (Number(budgetMin) > Number(budgetMax)) { showNotification("Minimum budget can't be more than the maximum", "error"); return; }
  if (!getToken()) { showNotification("Please sign in to post a job", "error"); showSection("auth"); return; }
  const btn = document.getElementById("submit-post-job"); if (btn) btn.disabled = true;
  showNotification(shPendingPhotos.length ? `Posting your job with ${shPendingPhotos.length} photo(s)...` : "Posting your job...", "info");
  const data = await shApi("/jobs", { method: "POST", body: JSON.stringify({ title, category, county, subcounty, description, budgetMin: parseInt(budgetMin), budgetMax: parseInt(budgetMax), urgency, photos: shPendingPhotos }) }).catch(() => ({ success: false, message: "Cannot reach ServiceHub. Check your connection." }));
  if (btn) btn.disabled = false;
  if (!data.success) { showNotification(data.message || (data.errors && data.errors[0] && data.errors[0].msg) || "Failed to post job", "error"); return; }
  document.getElementById("post-job-modal").classList.remove("active");
  ["job-title", "job-description", "job-budget-min", "job-budget-max"].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
  shPendingPhotos = []; renderPostJobPhotos();
  showNotification("Job posted! Service providers can now see it and send quotes.", "success");
  if (typeof loadJobs === "function") loadJobs();
  const dash = document.getElementById("dashboard");
  if (dash && dash.classList.contains("active")) { shJobsTab = "active"; loadMyJobs({ quiet: true }); loadDashboardStats(); }
}

async function shAddJobPhotos(jobId, input) {
  const job = shMyJobs.find((j) => j.id === jobId);
  const room = SH_MAX_PHOTOS - ((job && job.photos) || []).length;
  if (room <= 0) { showNotification(`This job already has ${SH_MAX_PHOTOS} photos`, "info"); return; }
  const photos = await shFilesToPhotos(input.files, room); input.value = "";
  if (!photos.length) return;
  showNotification("Uploading photos...", "info");
  const data = await shApi(`/jobs/${jobId}/photos`, { method: "POST", body: JSON.stringify({ photos }) }).catch(() => ({ success: false }));
  showNotification(data.success ? "Photos added to your job." : data.message || "Could not add photos", data.success ? "success" : "error");
  loadMyJobs({ quiet: true });
}
const shPhotoStrip = (job) => (job.photos && job.photos.length) ? `<div class="sh-photos">${job.photos.map((p, i) => `<img src="${p.url}" loading="lazy" alt="Photo ${i + 1} of ${shEsc(job.title)}" onclick="openImageModal(this.src)">`).join("")}</div>` : "";

/* job details page (providers viewing a job) now shows the client's real photos */
async function handleViewJob(jobId) {
  showNotification("Loading job details...", "info");
  let data;
  try { const res = await fetch(`${API_BASE}/jobs/${jobId}`, { headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {} }); data = await res.json(); }
  catch (e) { showNotification("Connection error. Please try again.", "error"); return; }
  if (!data.success) { showNotification(data.message || "Could not load job details", "error"); return; }
  const job = data.job, set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("detail-job-title", job.title); set("detail-job-category", job.category);
  set("detail-job-price", `KES ${Number(job.budgetMin).toLocaleString()} - ${Number(job.budgetMax).toLocaleString()}`);
  set("detail-job-description", job.description); set("detail-job-location", `${job.county}${job.subcounty ? ", " + job.subcounty : ""}`);
  set("detail-job-time", new Date(job.createdAt).toLocaleDateString("en-KE", { year: "numeric", month: "long", day: "numeric" }));
  set("detail-job-client", job.clientName || "Client");
  const imgs = document.getElementById("detail-job-images");
  if (imgs) imgs.innerHTML = (job.photos || []).map((p, i) => `<img src="${p.url}" loading="lazy" alt="Job photo ${i + 1}" onclick="openImageModal(this.src)">`).join("") || `<span style="color:var(--medium-gray);font-size:.9rem"><i class="far fa-image"></i> No photos attached</span>`;
  const q = document.getElementById("quote-job-id"); if (q) q.value = jobId;
  ["quote-amount", "quote-message"].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
  showSection("job-details");
}

/* =====================================================================
   JOB TRACKING — shared by client and provider
   ===================================================================== */
(function trackingUI() {
  const css = `
  .sht-steps{display:flex;justify-content:space-between;position:relative;margin:6px 0 20px}
  .sht-steps:before{content:"";position:absolute;left:8%;right:8%;top:15px;height:3px;background:var(--light-gray)}
  .sht-bar{position:absolute;left:8%;top:15px;height:3px;background:#2e7d32;transition:width .4s}
  .sht-step{position:relative;z-index:1;text-align:center;flex:1;font-size:.72rem;color:var(--medium-gray);font-weight:600}
  .sht-dot{width:32px;height:32px;border-radius:50%;margin:0 auto 6px;background:var(--white);border:3px solid var(--light-gray);display:flex;align-items:center;justify-content:center;font-size:.8rem}
  .sht-step.done .sht-dot{background:#2e7d32;border-color:#2e7d32;color:#fff}
  .sht-step.now .sht-dot{border-color:var(--primary);color:var(--primary);box-shadow:0 0 0 5px rgba(52,152,219,.15)}
  .sht-step.done,.sht-step.now{color:var(--dark)}
  .sht-tl{list-style:none;margin:0;padding:0 0 0 18px;border-left:2px solid var(--light-gray)}
  .sht-tl li{position:relative;padding:0 0 14px 14px}
  .sht-tl li:before{content:"";position:absolute;left:-25px;top:3px;width:12px;height:12px;border-radius:50%;background:var(--primary);border:2px solid var(--white);box-shadow:0 0 0 2px var(--primary)}
  .sht-tl li.latest:before{background:#2e7d32;box-shadow:0 0 0 2px #2e7d32}
  .sht-tl b{display:block;color:var(--dark);font-size:.92rem}
  .sht-tl small{color:var(--medium-gray)}
  .sht-tl .sht-note{margin-top:4px;background:var(--light,#f6f8fb);padding:6px 10px;border-radius:8px;font-size:.86rem;white-space:pre-wrap;overflow-wrap:anywhere}
  .sht-quick{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
  .sht-quick button{border:1.5px solid var(--primary);background:transparent;color:var(--primary);border-radius:999px;padding:7px 12px;font-size:.8rem;font-weight:600;cursor:pointer}
  .sht-quick button:hover{background:var(--primary);color:#fff}
  #track-note{width:100%;min-height:60px;border:1px solid var(--light-gray);border-radius:10px;padding:10px;font:inherit;resize:vertical}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const m = document.createElement("div");
  m.className = "modal"; m.id = "track-modal";
  m.innerHTML = `<div class="modal-content" style="max-width:600px;">
    <div class="modal-header"><h2 class="modal-title" id="track-title"><i class="fas fa-route" style="color:var(--primary);margin-right:8px"></i>Track Job</h2>
    <button class="modal-close" onclick="closeTrack()">&times;</button></div>
    <div class="modal-body" id="track-body"></div></div>`;
  document.body.appendChild(m);
})();

let shTrackJobId = null;
const SHT_STAGES = [["fa-clipboard-list", "Posted"], ["fa-user-check", "Provider chosen"], ["fa-handshake", "Accepted"], ["fa-tools", "Work done"], ["fa-flag-checkered", "Completed"]];
const SHT_STAGE_OF = { open: 0, "awaiting-provider": 1, "in-progress": 2, "pending-completion": 3, completed: 4, cancelled: 0 };
const SHT_ICON = { posted: "fa-clipboard-list", quote: "fa-file-invoice-dollar", offered: "fa-user-check", provider_accepted: "fa-handshake", provider_declined: "fa-times-circle", on_the_way: "fa-motorcycle", arrived: "fa-map-marker-alt", started: "fa-tools", materials: "fa-shopping-cart", paused: "fa-pause-circle", resumed: "fa-play-circle", note: "fa-comment", completion_requested: "fa-clipboard-check", disputed: "fa-flag", completed: "fa-flag-checkered", cancelled: "fa-ban", photos: "fa-camera" };

function closeTrack() { shTrackJobId = null; document.getElementById("track-modal").classList.remove("active"); }

async function openTrack(jobId) {
  if (!requireLogin()) return;
  shTrackJobId = jobId;
  const body = document.getElementById("track-body");
  body.innerHTML = `<div class="sh-loading"><i class="fas fa-spinner fa-spin"></i> Loading job progress...</div>`;
  document.getElementById("track-modal").classList.add("active");
  const data = await shApi(`/jobs/${jobId}/track`).catch(() => ({ success: false }));
  if (shTrackJobId !== jobId) return;
  if (!data.success) { body.innerHTML = `<div class="sh-loading">${shEsc(data.message || "Could not load job tracking")}</div>`; return; }
  const job = data.job, tl = data.timeline || [];
  const isProvider = currentUser.uid === job.assignedProviderId;
  const stage = SHT_STAGE_OF[job.status] ?? 0;
  const pct = job.status === "cancelled" ? 0 : (stage / (SHT_STAGES.length - 1)) * 84;
  document.getElementById("track-title").innerHTML = `<i class="fas fa-route" style="color:var(--primary);margin-right:8px"></i>${shEsc(job.title)}`;
  const canUpdate = ["in-progress", "pending-completion"].includes(job.status);
  const quick = isProvider && job.status === "in-progress"
    ? `<div class="sht-quick">${[["on_the_way", "🛵 On my way"], ["arrived", "📍 Arrived"], ["started", "🔧 Started work"], ["materials", "🛒 Buying materials"], ["paused", "⏸ Paused"], ["resumed", "▶ Resumed"]].map(([c, l]) => `<button type="button" onclick="postTrackUpdate('${job.id}','${c}')">${l}</button>`).join("")}</div>` : "";
  body.innerHTML = `
    ${job.status === "cancelled" ? `<div class="sh-assigned" style="margin:0 0 14px;background:#eee;color:#555">This job was cancelled.</div>` : `
    <div class="sht-steps"><div class="sht-bar" style="width:${pct}%"></div>
      ${SHT_STAGES.map(([ic, label], i) => `<div class="sht-step ${i < stage || job.status === "completed" ? "done" : i === stage ? "now" : ""}"><div class="sht-dot"><i class="fas ${i < stage || job.status === "completed" ? "fa-check" : ic}"></i></div>${label}</div>`).join("")}
    </div>`}
    <div class="sh-meta" style="margin-bottom:12px">
      ${job.assignedProviderName ? `<span><i class="fas fa-user-cog"></i> ${shEsc(job.assignedProviderName)}</span>` : ""}
      <span><i class="fas fa-user"></i> ${shEsc(job.clientName || "Client")}</span>
      ${job.acceptedAmount ? `<span><i class="fas fa-money-bill-wave"></i> ${shKES(job.acceptedAmount)}</span>` : ""}
      ${job.plannedStartDate ? `<span><i class="far fa-calendar-check"></i> Start ${shDate(job.plannedStartDate)}</span>` : ""}
    </div>
    ${canUpdate ? `<div style="margin-bottom:16px">${quick}
      <textarea id="track-note" maxlength="300" placeholder="${isProvider ? "Add a progress note for the client (optional)..." : "Add a note for the provider..."}"></textarea>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;flex-wrap:wrap">
        ${job.conversationId ? `<button class="sh-btn ghost" onclick="closeTrack();openJobChat('${job.conversationId}','${shEsc(isProvider ? job.clientName || "Client" : job.assignedProviderName || "Provider").replace(/'/g, "")}')"><i class="fas fa-comments"></i> Job Chat</button>` : ""}
        <button class="sh-btn pri" onclick="postTrackUpdate('${job.id}','note')"><i class="fas fa-paper-plane"></i> Post Note</button>
        ${isProvider && job.status === "in-progress" ? `<button class="sh-btn ok" onclick="closeTrack();requestJobCompletion('${job.id}')"><i class="fas fa-check"></i> Work Done</button>` : ""}
      </div></div>` : ""}
    <h4 style="margin:0 0 10px;font-size:.95rem">Activity</h4>
    <ul class="sht-tl">${tl.length ? [...tl].reverse().map((e, i) => `<li class="${i === 0 ? "latest" : ""}"><b><i class="fas ${SHT_ICON[e.type] || "fa-circle"}" style="color:var(--primary);margin-right:6px"></i>${shEsc(e.label)}</b>
      <small>${e.at ? new Date(e.at).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}${e.byName ? " · " + shEsc(e.byName) : ""}</small>
      ${e.note ? `<div class="sht-note">${shEsc(e.note)}</div>` : ""}</li>`).join("") : `<li><small>No activity yet.</small></li>`}</ul>`;
}

async function postTrackUpdate(jobId, code) {
  const noteEl = document.getElementById("track-note");
  const note = noteEl ? noteEl.value.trim() : "";
  if (code === "note" && !note) { showNotification("Write a short note first", "info"); return; }
  const data = await shApi(`/jobs/${jobId}/updates`, { method: "POST", body: JSON.stringify({ code, note }) }).catch(() => ({ success: false }));
  showNotification(data.success ? "Update shared." : data.message || "Could not post the update", data.success ? "success" : "error");
  if (data.success) openTrack(jobId);
}

/* live: refresh the tracker when the other side posts an update */
setInterval(() => {
  if (typeof socket !== "undefined" && socket && !socket.__shTrackHooked) {
    socket.__shTrackHooked = true;
    socket.on("notification", (n) => { if (n && n.jobId && n.jobId === shTrackJobId) openTrack(n.jobId); });
  }
}, 3000);


/* ---------- one account, two roles: hire (client) and work (service provider) ---------- */
(function () {
  const css = document.createElement("style");
  css.textContent = `
  #sh-role-switch{margin-top:16px;display:flex;justify-content:center}
  .sh-role-toggle{display:inline-flex;background:var(--light,#f1f5f9);border:1px solid var(--light-gray,#e2e8f0);border-radius:999px;padding:4px;gap:4px;max-width:100%}
  .sh-role-toggle button{border:0;background:transparent;border-radius:999px;padding:9px 16px;font-weight:700;cursor:pointer;color:var(--dark-gray,#475569);display:inline-flex;align-items:center;gap:8px;white-space:nowrap}
  .sh-role-toggle button small{font-weight:500;opacity:.75}
  .sh-role-toggle button.on{background:var(--primary);color:#fff;box-shadow:0 4px 12px rgba(46,134,222,.3)}
  @media (max-width:420px){.sh-role-toggle button{padding:8px 11px}.sh-role-toggle button small{display:none}}`;
  document.head.appendChild(css);
})();

function shRoles() {
  const u = currentUser || {};
  const r = Array.isArray(u.roles) && u.roles.length ? u.roles.slice() : [u.role || "client"];
  if (!r.includes("client")) r.unshift("client");
  return r;
}
function shIsProvider() { return shRoles().includes("service-provider"); }

function shApplySession(data, msg) {
  setToken(data.token);
  currentUser = { ...data.user, loggedIn: true };
  window.currentUser = currentUser;
  updateAuthUI();
  try { loadDashboardStats(); } catch (e) {}
  try { loadDashboardPanel(); } catch (e) {}
  if (msg) showNotification(msg, "success");
}

async function switchRole(role) {
  if (!requireLogin()) return;
  if (currentUser.role === role) return;
  if (role === "service-provider" && !shIsProvider()) { openBecomeProvider(); return; }
  const d = await shApi("/auth/switch-role", { method: "POST", body: JSON.stringify({ role }) }).catch(() => ({ success: false }));
  if (!d.success) {
    if (d.code === "ROLE_NOT_ENABLED") { openBecomeProvider(); return; }
    showNotification(d.message || "Could not switch. Please try again.", "error");
    return;
  }
  shApplySession(d, role === "service-provider" ? "Service Provider mode: find jobs and send quotes." : "Client mode: post jobs and hire service providers.");
}

function renderRoleSwitch() {
  const head = document.querySelector("#dashboard .dashboard-header");
  if (!head) return;
  let el = document.getElementById("sh-role-switch");
  if (!currentUser || !currentUser.loggedIn) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement("div"); el.id = "sh-role-switch"; head.appendChild(el); }
  const prov = currentUser.role === "service-provider";
  el.innerHTML = shIsProvider()
    ? `<div class="sh-role-toggle" role="group" aria-label="Choose what you are doing now">
         <button type="button" class="${!prov ? "on" : ""}" aria-pressed="${!prov}" onclick="switchRole('client')"><i class="fas fa-briefcase"></i> Hiring <small>Client</small></button>
         <button type="button" class="${prov ? "on" : ""}" aria-pressed="${prov}" onclick="switchRole('service-provider')"><i class="fas fa-tools"></i> Working <small>Service Provider</small></button>
       </div>`
    : `<button type="button" class="sh-btn pri" onclick="openBecomeProvider()"><i class="fas fa-tools"></i> Also offer your services: become a Service Provider</button>`;
}

function openBecomeProvider() {
  if (!requireLogin()) return;
  let m = document.getElementById("sh-become-provider");
  if (!m) {
    m = document.createElement("div");
    m.className = "modal";
    m.id = "sh-become-provider";
    m.innerHTML = `<div class="modal-content" style="max-width:520px">
      <div class="modal-header"><h2 class="modal-title"><i class="fas fa-tools" style="color:var(--primary);margin-right:10px"></i>Offer your services</h2>
        <button class="modal-close" type="button" aria-label="Close" onclick="document.getElementById('sh-become-provider').classList.remove('active')">&times;</button></div>
      <div class="modal-body">
        <p style="color:var(--dark-gray);margin-bottom:16px">Use this same account to get hired. Your jobs, chats and details stay as they are, and you can switch between <b>Hiring</b> and <b>Working</b> any time.</p>
        <div class="form-group"><label class="form-label" for="sh-bp-skills">Services you offer *</label>
          <input id="sh-bp-skills" class="form-control" placeholder="e.g. Plumbing, Electrical, Tiling" maxlength="300">
          <small style="color:var(--medium-gray)">Separate with commas.</small></div>
        <div class="form-group"><label class="form-label" for="sh-bp-bio">About you (optional)</label>
          <textarea id="sh-bp-bio" class="form-control" rows="3" maxlength="500" placeholder="Experience, areas you cover, working hours"></textarea></div>
        <button type="button" class="btn btn-primary btn-block" id="sh-bp-go"><i class="fas fa-check"></i> Start offering services</button>
      </div></div>`;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => { if (e.target === m) m.classList.remove("active"); });
    m.querySelector("#sh-bp-go").onclick = becomeProvider;
  }
  const skills = (currentUser && currentUser.skills) || [];
  m.querySelector("#sh-bp-skills").value = Array.isArray(skills) ? skills.join(", ") : String(skills || "");
  m.querySelector("#sh-bp-bio").value = (currentUser && currentUser.bio) || "";
  m.classList.add("active");
  setTimeout(() => m.querySelector("#sh-bp-skills").focus(), 50);
}

async function becomeProvider() {
  const m = document.getElementById("sh-become-provider");
  const skills = m.querySelector("#sh-bp-skills").value.split(",").map((x) => x.trim()).filter(Boolean);
  const bio = m.querySelector("#sh-bp-bio").value.trim();
  if (!skills.length) { showNotification("Add at least one service you offer (for example: Plumbing)", "error"); return; }
  const btn = m.querySelector("#sh-bp-go"); btn.disabled = true;
  const d = await shApi("/auth/become-provider", { method: "POST", body: JSON.stringify({ skills, bio }) }).catch(() => ({ success: false }));
  btn.disabled = false;
  if (!d.success) { showNotification(d.message || "Could not update your account. Please try again.", "error"); return; }
  m.classList.remove("active");
  shApplySession(d, "You're now a Service Provider too. Find jobs and send quotes; switch to Hiring any time.");
}

// Show the Hiring / Working switch whenever sign-in state changes
(function () {
  const orig = window.updateAuthUI || (typeof updateAuthUI === "function" ? updateAuthUI : null);
  if (!orig) return;
  const wrapped = function () { orig.apply(this, arguments); try { renderRoleSwitch(); } catch (e) {} };
  window.updateAuthUI = wrapped;
  try { updateAuthUI = wrapped; } catch (e) {}
  if (currentUser && currentUser.loggedIn) renderRoleSwitch();
})();
