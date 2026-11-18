const express = require("express");
const { body, validationResult } = require("express-validator");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();
const firebase = require("../config/firebase");
const { verifyJWT } = require("../middleware/auth");
const mpesa = require("../services/mpesa");
const { sendPaymentConfirmationEmail } = require("../services/email");

function validationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, errors: errors.array() });
  return null;
}

router.post("/mpesa/stk-push", verifyJWT, [body("phone").notEmpty(), body("amount").isNumeric()], async (req, res) => {
  const err = validationErrors(req, res);
  if (err) return;
  const { phone, amount, jobId, description } = req.body;
  try {
    const accountRef = jobId ? `SH-${jobId.slice(0, 8).toUpperCase()}` : "ServiceHubKenya";
    const desc = description || "ServiceHub Kenya Service Payment";
    const stkResponse = await mpesa.initiateSTKPush({ phone, amount, accountRef, description: desc });
    if (stkResponse.ResponseCode !== "0") return res.status(400).json({ success: false, message: stkResponse.ResponseDescription || "STK Push failed" });
    const paymentId = uuidv4();
    const now = new Date().toISOString();
    await firebase.db.collection(firebase.COLLECTIONS.PAYMENTS).doc(paymentId).set({ id: paymentId, userId: req.user.uid, userEmail: req.user.email, userName: req.user.name, phone: mpesa.normalisePhone(phone), amount: parseFloat(amount), jobId: jobId || null, description: desc, merchantRequestId: stkResponse.MerchantRequestID, checkoutRequestId: stkResponse.CheckoutRequestID, status: "pending", createdAt: now, updatedAt: now });
    return res.json({ success: true, message: "STK Push sent. Enter your M-Pesa PIN to complete payment.", checkoutRequestId: stkResponse.CheckoutRequestID, paymentId });
  } catch (error) {
    console.error("STK Push error:", error.message);
    return res.status(500).json({ success: false, message: "Could not initiate M-Pesa payment. Please try again." });
  }
});

router.post("/mpesa/callback", async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  try {
    const parsed = mpesa.parseSTKCallback(req.body);
    const snap = await firebase.db.collection(firebase.COLLECTIONS.PAYMENTS).where("checkoutRequestId", "==", parsed.checkoutRequestId).limit(1).get();
    if (snap.empty) return;
    const paymentDoc = snap.docs[0];
    const payment = paymentDoc.data();
    await paymentDoc.ref.update({ status: parsed.success ? "completed" : "failed", resultCode: parsed.resultCode, resultDesc: parsed.resultDesc, mpesaReceiptNumber: parsed.mpesaReceiptNumber || null, updatedAt: new Date().toISOString() });
    if (parsed.success) {
      if (payment.jobId) await firebase.db.collection(firebase.COLLECTIONS.JOBS).doc(payment.jobId).update({ paymentStatus: "paid", mpesaReceiptNumber: parsed.mpesaReceiptNumber, updatedAt: new Date().toISOString() }).catch(() => {});
      sendPaymentConfirmationEmail({ email: payment.userEmail, name: payment.userName, amount: parsed.amount, mpesaCode: parsed.mpesaReceiptNumber, jobTitle: payment.description }).catch(console.error);
    }
  } catch (error) {
    console.error("M-Pesa callback error:", error);
  }
});

router.get("/mpesa/status/:checkoutRequestId", verifyJWT, async (req, res) => {
  try {
    const snap = await firebase.db.collection(firebase.COLLECTIONS.PAYMENTS).where("checkoutRequestId", "==", req.params.checkoutRequestId).limit(1).get();
    if (!snap.empty) {
      const payment = snap.docs[0].data();
      if (payment.status === "completed" || payment.status === "failed") return res.json({ success: true, payment });
    }
    const stkResult = await mpesa.querySTKPush(req.params.checkoutRequestId);
    return res.json({ success: true, status: stkResult.ResultCode === "0" ? "completed" : "pending", resultDesc: stkResult.ResultDesc });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not check payment status" });
  }
});

router.get("/history", verifyJWT, async (req, res) => {
  try {
    const snap = await firebase.db.collection(firebase.COLLECTIONS.PAYMENTS).where("userId", "==", req.user.uid).get();
    const payments = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 50);
    return res.json({ success: true, payments });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not fetch payment history" });
  }
});

module.exports = router;
