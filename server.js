// server.js
import express from "express";
import http from "http";
import cors from "cors";
import { Server as SocketIOServer } from "socket.io";
import { WebcastPushConnection } from "tiktok-live-connector";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: "*" } });

// =======================================================
// CONFIG
// =======================================================
let activeConnection = null;
let currentUsername = null;

// Buffer untuk batching komentar
let chatBuffer = [];
let lastEmit = 0;
const EMIT_INTERVAL = 100; // ms

// =======================================================
// HELPER FUNCTIONS
// =======================================================

function emitBufferedChats() {
  const now = Date.now();
  if (now - lastEmit >= EMIT_INTERVAL && chatBuffer.length > 0) {
    io.emit("tiktokBatch", chatBuffer.splice(0));
    lastEmit = now;
  }
}

function reconnectTikTok(uniqueId, options, socket) {
  if (activeConnection) {
    activeConnection.disconnect();
    activeConnection = null;
  }

  const tiktok = new WebcastPushConnection(uniqueId, options);
  activeConnection = tiktok;

  tiktok
    .connect()
    .then((state) => {
      console.log(`✅ Connected to @${uniqueId} | RoomID: ${state.roomId}`);
      socket.emit("tiktokConnected", state);
    })
    .catch((err) => {
      console.error("❌ Failed to connect:", err.message);
      socket.emit("tiktokDisconnected", err.message);
    });

  // ===================== TikTok Event Listeners =====================
  tiktok.on("chat", (data) => {
    const text = (data.comment || "").trim().toUpperCase();

    // Hanya ambil komentar 5 huruf untuk game Wordle
    if (/^[A-Z]{5}$/.test(text)) {
      chatBuffer.push({
        type: "guess",
        user: data.uniqueId,
        nickname: data.nickname,
        pfp: data.profilePictureUrl,
        guess: text,
      });
      emitBufferedChats();
    }
  });

  tiktok.on("like", (data) => {
    io.emit("like", data);
  });

  tiktok.on("member", (data) => {
    io.emit("member", data);
  });

  tiktok.on("social", (data) => {
    io.emit("social", data);
  });

  tiktok.on("gift", (data) => {
    io.emit("gift", data);
  });

  tiktok.on("roomUser", (data) => {
    io.emit("roomUser", data);
  });

  tiktok.on("streamEnd", () => {
    console.warn("⚠️ Stream ended");
    socket.emit("streamEnd");
  });

  tiktok.on("disconnected", () => {
    console.warn("⚠️ Disconnected, attempting reconnect...");
    socket.emit("tiktokDisconnected", "Connection lost, retrying...");
    setTimeout(() => reconnectTikTok(uniqueId, options, socket), 5000);
  });
}

// =======================================================
// SOCKET.IO HANDLER
// =======================================================
io.on("connection", (socket) => {
  console.log("Frontend connected:", socket.id);

  socket.on("setUniqueId", (uniqueId, options = {}) => {
    if (!uniqueId) return;
    currentUsername = uniqueId.replace(/^@/, "");
    reconnectTikTok(currentUsername, options, socket);
  });

  socket.on("disconnect", () => {
    console.log("Frontend disconnected:", socket.id);
  });
});

// =======================================================
// EXPRESS ENDPOINTS
// =======================================================
app.get("/", (req, res) => {
  res.json({
    status: "TikTok backend aktif",
    listening: !!activeConnection,
    username: currentUsername || null,
  });
});

// =======================================================
// START SERVER
// =======================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`🚀 Server berjalan di port ${PORT}`)
);
