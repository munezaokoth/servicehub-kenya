// routes/contact.js
// ServiceHub Kenya - Contact Form Route

const express = require("express");
const { body, validationResult } = require("express-validator");
const router = express.Router();
const { sendContactEmail } = require("../services/email");

// ── POST /api/contact ─────────────────────────────────────────────────────
router.post(
  "/",
  [
    body("name").trim().notEmpty().withMessage("Name is required"),
    body("email").isEmail().normalizeEmail().withMessage("Valid email required"),
    body("subject").trim().notEmpty().withMessage("Subject is required"),
    body("message").trim().isLength({ min: 10, max: 2000 }).withMessage("Message must be 10–2000 characters"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ success: false, errors: errors.array() });
    }

    const { name, email, subject, message } = req.body;

    // Keep a copy for the admin portal (best effort; the email still goes out if this fails)
    let saved = false;
    try {
      const firebase = require("../config/firebase");
      const { v4: uuidv4 } = require("uuid");
      const id = uuidv4();
      await firebase.db.collection("contact_messages").doc(id).set({ id, name, email, subject, message, handled: false, createdAt: new Date().toISOString() });
      saved = true;
    } catch (e) { console.error("Save contact message error:", e.message); }

    try {
      await sendContactEmail({ name, email, subject, message });
      return res.json({
        success: true,
        message: "Your message has been sent! We will respond within 24 hours.",
      });
    } catch (error) {
      console.error("Contact email error:", error);
      if (saved) return res.json({ success: true, message: "Your message has been received! We will respond within 24 hours." });
      return res.status(500).json({
        success: false,
        message: "Could not send your message. Please try again or use WhatsApp.",
      });
    }
  }
);

module.exports = router;
