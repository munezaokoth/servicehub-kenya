// utils/socket.js
// ServiceHub Kenya - Socket.IO Real-Time Chat + WebRTC Signaling

const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const calls = require("./calls");

let ioRef = null;
function getIO() { return ioRef; }

function initSocket(httpServer) {
  const io = ioRef = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 60000,
  });
  calls.init(io);

  // Auth middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error("Authentication required"));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
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

    // ── Chat rooms ──────────────────────────────────────────────────────
    socket.on("join_conversation", (conversationId) => {
      if (!conversationId) return;
      socket.join(`conversation:${conversationId}`);
    });

    socket.on("leave_conversation", (conversationId) => {
      socket.leave(`conversation:${conversationId}`);
    });

    // ── Typing indicators ───────────────────────────────────────────────
    socket.on("typing_start", ({ conversationId }) => {
      socket.to(`conversation:${conversationId}`).emit("user_typing", {
        userId: uid, userName: name, conversationId,
      });
    });

    socket.on("typing_stop", ({ conversationId }) => {
      socket.to(`conversation:${conversationId}`).emit("user_stopped_typing", {
        userId: uid, conversationId,
      });
    });

    // ── Send message via socket ─────────────────────────────────────────
    socket.on("send_message", async ({ conversationId, text }) => {
      if (!text || !text.trim() || !conversationId) return;
      const { v4: uuidv4 } = require("uuid");
      const firebase = require("../config/firebase");
      const admin = require("firebase-admin");

      const msgId = uuidv4();
      const now = new Date().toISOString();
      const msgData = {
        id: msgId, conversationId,
        senderId: uid, senderName: name,
        text: text.trim(), read: false, createdAt: now,
      };

      try {
        await firebase.db.collection(firebase.COLLECTIONS.MESSAGES).doc(msgId).set(msgData);
        const convRef = firebase.db.collection(firebase.COLLECTIONS.CONVERSATIONS).doc(conversationId);
        const convDoc = await convRef.get();
        if (convDoc.exists) {
          const otherUserId = convDoc.data().participants.find((p) => p !== uid);
          await convRef.update({
            lastMessage: text.trim().slice(0, 100),
            lastMessageAt: now,
            lastMessageSenderId: uid,
            [`unreadCount.${otherUserId}`]: admin.firestore.FieldValue.increment(1),
          });
          io.to(`user:${otherUserId}`).emit("new_conversation_message", { conversationId, message: msgData });
        }
        io.to(`conversation:${conversationId}`).emit("new_message", msgData);
        socket.emit("message_sent", { id: msgId, status: "delivered" });
      } catch (err) {
        console.error("Socket send_message error:", err.message);
        socket.emit("message_error", { error: "Could not deliver message" });
      }
    });

    // ── Mark messages read ──────────────────────────────────────────────
    socket.on("mark_read", async ({ conversationId }) => {
      try {
        const firebase = require("../config/firebase");
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
