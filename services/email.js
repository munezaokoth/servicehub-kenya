// services/email.js
// ServiceHub Kenya - Email Service using Resend API
// Resend works reliably on Railway (no SMTP port blocking)

const https = require("https");

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM_NAME
  ? `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM}>`
  : "ServiceHub Kenya <support@servicehub.co.ke>";

// ── Core send function via Resend API ─────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      from: FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    });

    const options = {
      hostname: "api.resend.com",
      path: "/emails",
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`✅ Email sent to ${to}: ${subject}`);
          resolve(JSON.parse(data));
        } else {
          console.error(`❌ Resend error ${res.statusCode}:`, data);
          reject(new Error(`Resend API error: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── HTML template wrapper ──────────────────────────────────────────────────
function wrapTemplate(title, bodyHtml) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { margin:0; padding:0; font-family:'Segoe UI',Arial,sans-serif; background:#f7f9fc; color:#222f3e; }
    .wrapper { max-width:600px; margin:40px auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08); }
    .header { background:linear-gradient(135deg,#2e86de 0%,#48dbfb 100%); padding:32px 40px; text-align:center; }
    .header h1 { color:#fff; margin:0; font-size:26px; font-weight:800; }
    .header p { color:rgba(255,255,255,0.85); margin:6px 0 0; font-size:13px; }
    .body { padding:36px 40px; }
    .body h2 { color:#2e86de; margin-top:0; }
    .body p { line-height:1.7; color:#576574; }
    .btn { display:inline-block; padding:14px 32px; background:linear-gradient(135deg,#2e86de,#48dbfb); color:#fff; border-radius:8px; text-decoration:none; font-weight:700; font-size:15px; margin:18px 0; }
    .footer { background:#f7f9fc; padding:24px 40px; text-align:center; font-size:12px; color:#8395a7; border-top:1px solid #c8d6e5; }
    .footer a { color:#2e86de; text-decoration:none; }
    .highlight { background:#f0f8ff; border-left:4px solid #2e86de; padding:16px 20px; border-radius:0 8px 8px 0; margin:20px 0; }
    .divider { border:none; border-top:1px solid #c8d6e5; margin:24px 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>ServiceHub Kenya</h1>
      <p>On-Demand Professional Services Across All 47 Counties</p>
    </div>
    <div class="body">${bodyHtml}</div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} ServiceHub Kenya Limited — Kisumu, Kenya</p>
      <p>
        <a href="https://servicehub.co.ke">Website</a> &nbsp;|&nbsp;
        <a href="mailto:support@servicehub.co.ke">support@servicehub.co.ke</a> &nbsp;|&nbsp;
        <a href="tel:+254727679997">+254 727 679 997</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ── Welcome Email ──────────────────────────────────────────────────────────
async function sendWelcomeEmail({ name, email, role }) {
  const roleLabel = role === "service-provider" ? "Service Provider" : "Client";
  const html = wrapTemplate("Welcome to ServiceHub Kenya", `
    <h2>Welcome aboard, ${name}! 🎉</h2>
    <p>Your <strong>${roleLabel}</strong> account is ready. You're now part of Kenya's fastest-growing on-demand professional services marketplace.</p>
    <div class="highlight">
      <strong>Get started:</strong><br>
      ${role === "service-provider"
        ? "• Browse and bid on jobs across all 47 counties<br>• Set up your profile and skills<br>• Start receiving job alerts"
        : "• Post service requests and get competitive quotes<br>• Browse vetted providers near you<br>• Pay securely via M-Pesa"}
    </div>
    <a href="https://servicehub.co.ke" class="btn">Go to ServiceHub →</a>
  `);
  return sendEmail({ to: email, subject: `Welcome to ServiceHub Kenya, ${name}! 🎉`, html });
}

// ── Password Reset Email ───────────────────────────────────────────────────
async function sendPasswordResetEmail({ email, resetLink }) {
  const html = wrapTemplate("Reset Your Password", `
    <h2>Password Reset Request</h2>
    <p>Click the button below to reset your ServiceHub Kenya password. This link expires in 1 hour.</p>
    <a href="${resetLink}" class="btn">Reset Password →</a>
    <div class="highlight">
      If you did not request a password reset, ignore this email — your password will not change.
    </div>
  `);
  return sendEmail({ to: email, subject: "Reset Your ServiceHub Kenya Password", html });
}

// ── Contact Form Email ─────────────────────────────────────────────────────
async function sendContactEmail({ name, email, subject, message }) {
  const html = wrapTemplate(`New Message: ${subject}`, `
    <h2>New Contact Form Submission</h2>
    <p><strong>From:</strong> ${name} &lt;${email}&gt;</p>
    <p><strong>Subject:</strong> ${subject}</p>
    <div class="highlight">
      <strong>Message:</strong><br><br>${message.replace(/\n/g, "<br>")}
    </div>
  `);
  await sendEmail({ to: process.env.EMAIL_FROM, subject: `[ServiceHub Contact] ${subject}`, html });

  // Auto-reply
  const autoHtml = wrapTemplate("We received your message", `
    <h2>Hi ${name}, we got your message!</h2>
    <p>Thank you for reaching out. Our team will respond within <strong>24 hours</strong>.</p>
    <div class="highlight">
      <strong>Your subject:</strong> ${subject}
    </div>
    <p>📞 <strong>+254 727 679 997</strong> | WhatsApp: <a href="https://wa.me/254727679997">wa.me/254727679997</a></p>
  `);
  return sendEmail({ to: email, subject: "We received your message — ServiceHub Kenya", html: autoHtml });
}

// ── Quote Received Notification (CLIENT) ──────────────────────────────────
async function sendQuoteReceivedEmail({ clientEmail, clientName, quote, job }) {
  const html = wrapTemplate("New Quote Received! 💼", `
    <h2>You have a new quote, ${clientName}!</h2>
    <p>A service provider has submitted a quote for your job request.</p>
    <div class="highlight">
      <strong>Job:</strong> ${job.title}<br>
      <strong>Provider:</strong> ${quote.providerName}<br>
      <strong>Quote Amount:</strong> <span style="color:#2e86de;font-size:1.2em;font-weight:700;">KES ${Number(quote.amount).toLocaleString()}</span><br>
      ${quote.estimatedDays ? `<strong>Estimated Days:</strong> ${quote.estimatedDays} day(s)<br>` : ""}
      ${quote.message ? `<strong>Message:</strong> ${quote.message}` : ""}
    </div>
    <p>Log in to review this quote and either accept or decline it.</p>
    <a href="https://servicehub.co.ke" class="btn">View Quote →</a>
    <hr class="divider">
    <p style="font-size:13px;color:#8395a7;">You received this because you posted a job on ServiceHub Kenya.</p>
  `);
  return sendEmail({
    to: clientEmail,
    subject: `New Quote: KES ${Number(quote.amount).toLocaleString()} for "${job.title}"`,
    html,
  });
}

// ── Job Alert Email (PROVIDER) ─────────────────────────────────────────────
async function sendJobAlertEmail({ providerEmail, providerName, job }) {
  const html = wrapTemplate("New Job Alert 🔔", `
    <h2>New job matching your skills, ${providerName}!</h2>
    <div class="highlight">
      <strong>Title:</strong> ${job.title}<br>
      <strong>Category:</strong> ${job.category}<br>
      <strong>Location:</strong> ${job.county}${job.subcounty ? ", " + job.subcounty : ""}<br>
      <strong>Budget:</strong> KES ${Number(job.budgetMin).toLocaleString()} – KES ${Number(job.budgetMax).toLocaleString()}<br>
      <strong>Description:</strong> ${job.description?.slice(0, 150)}...
    </div>
    <a href="https://servicehub.co.ke" class="btn">View & Submit Quote →</a>
  `);
  return sendEmail({
    to: providerEmail,
    subject: `[ServiceHub] New Job: ${job.title} in ${job.county}`,
    html,
  });
}

// ── Payment Confirmation Email ─────────────────────────────────────────────
async function sendPaymentConfirmationEmail({ email, name, amount, mpesaCode, jobTitle }) {
  const html = wrapTemplate("Payment Confirmed ✅", `
    <h2>Payment Received, ${name}!</h2>
    <div class="highlight">
      <strong>Amount:</strong> KES ${Number(amount).toLocaleString()}<br>
      <strong>M-Pesa Code:</strong> ${mpesaCode}<br>
      <strong>Service:</strong> ${jobTitle || "ServiceHub Kenya"}<br>
      <strong>Date:</strong> ${new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}
    </div>
    <p>Keep this for your records. Contact us with your M-Pesa code if you have any issues.</p>
  `);
  return sendEmail({
    to: email,
    subject: `Payment Confirmed — KES ${Number(amount).toLocaleString()} | ${mpesaCode}`,
    html,
  });
}

// ── Quote Accepted Notification (PROVIDER) ────────────────────────────────
async function sendQuoteAcceptedEmail({ providerEmail, providerName, job, amount }) {
  const html = wrapTemplate("Your Quote was Accepted! 🎉", `
    <h2>Congratulations, ${providerName}!</h2>
    <p>The client has accepted your quote. You can now proceed with the job.</p>
    <div class="highlight">
      <strong>Job:</strong> ${job.title}<br>
      <strong>Your Quote:</strong> KES ${Number(amount).toLocaleString()}<br>
      <strong>Location:</strong> ${job.county}${job.subcounty ? ", " + job.subcounty : ""}
    </div>
    <p>Contact the client via the ServiceHub chat to arrange the details.</p>
    <a href="https://servicehub.co.ke" class="btn">Go to ServiceHub →</a>
  `);
  return sendEmail({
    to: providerEmail,
    subject: `Your quote was accepted! — ${job.title}`,
    html,
  });
}

module.exports = {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendContactEmail,
  sendQuoteReceivedEmail,
  sendJobAlertEmail,
  sendPaymentConfirmationEmail,
  sendQuoteAcceptedEmail,
};
