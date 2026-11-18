// services/mpesa.js
// ServiceHub Kenya - Safaricom M-Pesa Daraja API Integration
// Handles STK Push (Lipa na M-Pesa), C2B, B2C, and transaction status

const axios = require("axios");

const MPESA_URLS = {
  sandbox: {
    auth: "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    stkPush: "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
    stkQuery: "https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query",
    b2c: "https://sandbox.safaricom.co.ke/mpesa/b2c/v1/paymentrequest",
    transactionStatus: "https://sandbox.safaricom.co.ke/mpesa/transactionstatus/v1/query",
    accountBalance: "https://sandbox.safaricom.co.ke/mpesa/accountbalance/v1/query",
  },
  live: {
    auth: "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    stkPush: "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
    stkQuery: "https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query",
    b2c: "https://api.safaricom.co.ke/mpesa/b2c/v1/paymentrequest",
    transactionStatus: "https://api.safaricom.co.ke/mpesa/transactionstatus/v1/query",
    accountBalance: "https://api.safaricom.co.ke/mpesa/accountbalance/v1/query",
  },
};

function getEnv() {
  return process.env.MPESA_ENVIRONMENT === "live" ? "live" : "sandbox";
}

function getUrls() {
  return MPESA_URLS[getEnv()];
}

// Generate OAuth access token
async function getAccessToken() {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    throw new Error("M-Pesa consumer key/secret not configured");
  }

  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");

  const response = await axios.get(getUrls().auth, {
    headers: { Authorization: `Basic ${credentials}` },
    timeout: 10000,
  });

  return response.data.access_token;
}

// Generate M-Pesa password (Base64 of shortcode + passkey + timestamp)
function generatePassword() {
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const timestamp = getTimestamp();
  const raw = `${shortcode}${passkey}${timestamp}`;
  return { password: Buffer.from(raw).toString("base64"), timestamp };
}

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}` +
    `${pad(now.getMonth() + 1)}` +
    `${pad(now.getDate())}` +
    `${pad(now.getHours())}` +
    `${pad(now.getMinutes())}` +
    `${pad(now.getSeconds())}`
  );
}

// Normalise phone number to 254XXXXXXXXX format
function normalisePhone(phone) {
  const cleaned = String(phone).replace(/\D/g, "");
  if (cleaned.startsWith("0")) return "254" + cleaned.slice(1);
  if (cleaned.startsWith("254")) return cleaned;
  if (cleaned.startsWith("+254")) return cleaned.slice(1);
  return "254" + cleaned;
}

// ─── STK Push (Lipa na M-Pesa Online) ─────────────────────────────────────
// Initiates a payment prompt on the customer's phone
async function initiateSTKPush({ phone, amount, accountRef, description }) {
  const accessToken = await getAccessToken();
  const { password, timestamp } = generatePassword();

  const payload = {
    BusinessShortCode: process.env.MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: Math.ceil(amount),          // M-Pesa requires integer
    PartyA: normalisePhone(phone),
    PartyB: process.env.MPESA_SHORTCODE,
    PhoneNumber: normalisePhone(phone),
    CallBackURL: process.env.MPESA_CALLBACK_URL,
    AccountReference: accountRef || "ServiceHubKenya",
    TransactionDesc: description || "ServiceHub Kenya Payment",
  };

  const response = await axios.post(getUrls().stkPush, payload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });

  return response.data;
}

// ─── STK Query ─────────────────────────────────────────────────────────────
// Check the status of an STK Push transaction
async function querySTKPush(checkoutRequestId) {
  const accessToken = await getAccessToken();
  const { password, timestamp } = generatePassword();

  const payload = {
    BusinessShortCode: process.env.MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  };

  const response = await axios.post(getUrls().stkQuery, payload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });

  return response.data;
}

// ─── Parse STK Push Callback ───────────────────────────────────────────────
function parseSTKCallback(callbackBody) {
  const { Body: { stkCallback } } = callbackBody;
  const result = {
    merchantRequestId: stkCallback.MerchantRequestID,
    checkoutRequestId: stkCallback.CheckoutRequestID,
    resultCode: stkCallback.ResultCode,
    resultDesc: stkCallback.ResultDesc,
    success: stkCallback.ResultCode === 0,
    amount: null,
    mpesaReceiptNumber: null,
    transactionDate: null,
    phoneNumber: null,
  };

  if (result.success && stkCallback.CallbackMetadata) {
    stkCallback.CallbackMetadata.Item.forEach((item) => {
      switch (item.Name) {
        case "Amount":           result.amount = item.Value; break;
        case "MpesaReceiptNumber": result.mpesaReceiptNumber = item.Value; break;
        case "TransactionDate":  result.transactionDate = item.Value; break;
        case "PhoneNumber":      result.phoneNumber = item.Value; break;
      }
    });
  }

  return result;
}

module.exports = {
  initiateSTKPush,
  querySTKPush,
  parseSTKCallback,
  normalisePhone,
};
