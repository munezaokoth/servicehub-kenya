// utils/socket.js
// ServiceHub Kenya - Socket.IO Real-Time Chat + WebRTC Signaling

const { Server } = require("socket.io");
const calls = require("./calls");
const { checkToken } = require("../middleware/auth");
const { allowedOrigin } = require("../middleware/security");
const firebase = require("../config/firebase");

// Is this person part of the conversation? (cached briefly so typing indicators stay cheap)
const memberCache = new Map();
async function isMember(uid, conversationId) {
  if (!conversationId || typeof conversationId !== "string" || conversationId.length > 128) return false;
  const key = `${uid}|${conversationId}`;
  const hit = memberCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.ok;
  let ok = false;
  try {
    const doc = await firebase.db.collection(firebase.COLLECTIONS.CONVERSATIONS).doc(conversationId).get();
    ok = doc.exists && (doc.data().participants || []).includes(uid);
  } catch (e) { ok = false; }
  memberCache.set(key, { at: Date.now(), ok });
  if (memberCache.size > 50000) memberCache.clear();
  return ok;
}

let ioRef = null;
function getIO() { return ioRef; }

function initSocket(httpServer) {
  const io = ioRef = new Server(httpServer, {
    cors: {
      origin: allowedOrigin,
      methods: ["GET", "POST"],
      credentials: true,
    },
    maxHttpBufferSize: 1e6, // 1 MB per socket message (call setup data is far smaller)
    pingInterval: 25000,
    pingTimeout: 60000,
  });
  calls.init(io);

  // Auth middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error("Authentication required"));
    try {
      socket.user = await checkToken(token); // same checks as the API: signature, expiry, suspension, signed-out devices
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    const uid = socket.user.uid;
    const name = socket.user.name;
    console.log(`🔌 Connected: ${name} (${uid})`);

    // Personal room for notifications
    socket.join(`user:${uid}`);
    // Their app is open: messages waiting for them are now delivered (two grey ticks for the sender)
    require("./receipts").markDelivered(uid);

    // ── Chat rooms ──────────────────────────────────────────────────────
    // Only people in the conversation can listen to it
    socket.on("join_conversation", async (conversationId) => {
      if (await isMember(uid, conversationId)) socket.join(`conversation:${conversationId}`);
    });

    socket.on("leave_conversation", (conversationId) => {
      socket.leave(`conversation:${conversationId}`);
    });

    // ── Typing indicators ───────────────────────────────────────────────
    socket.on("typing_start", async ({ conversationId } = {}) => {
      if (!socket.rooms.has(`conversation:${conversationId}`)) return;
      socket.to(`conversation:${conversationId}`).emit("user_typing", {
        userId: uid, userName: name, conversationId,
      });
    });

    socket.on("typing_stop", ({ conversationId } = {}) => {
      if (!socket.rooms.has(`conversation:${conversationId}`)) return;
      socket.to(`conversation:${conversationId}`).emit("user_stopped_typing", {
        userId: uid, conversationId,
      });
    });

    // Messages are sent through the API (POST /api/chat/conversations/:id/messages), which checks
    // membership, cleans the text and records ticks. There is no socket shortcut for sending.

    // ── Mark messages read ──────────────────────────────────────────────
    socket.on("mark_read", async ({ conversationId } = {}) => {
      try {
        if (!(await isMember(uid, conversationId))) return;
        await firebase.db.collection(firebase.COLLECTIONS.CONVERSATIONS).doc(conversationId).update({
          [`unreadCount.${uid}`]: 0,
        });
        socket.to(`conversation:${conversationId}`).emit("messages_read", { userId: uid, conversationId });
      } catch {}
    });

    // ── Voice & video calls (WebRTC signalling) ─────────────────────────
    calls.register(socket);

    // ── Presence ────────────────────────────────────────────────────────
    socket.on("disconnect", () => {
      console.log(`🔌 Disconnected: ${name}`);
      io.emit("user_offline", { userId: uid });
    });

    io.emit("user_online", { userId: uid });
  });

  global.io = io;
  console.log("✅ Socket.IO initialised");
  return io;
}

module.exports = { initSocket, getIO };
