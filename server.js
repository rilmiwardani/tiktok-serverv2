// server.js
import express from "express";
import http from "http";
import cors from "cors";
import { Server as SocketIOServer } from "socket.io";
import { WebcastPushConnection } from "tiktok-live-connector";

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
let tiktokConnection = null;
let currentUser = null;

// ==============================
// FUNGSI KONEKSI TIKTOK
// ==============================
async function connectTikTok(username, socket) {
  try {
    if (tiktokConnection) {
      await tiktokConnection.disconnect();
      tiktokConnection = null;
    }

    console.log(`🔗 Connecting to TikTok live @${username}...`);

    const connection = new WebcastPushConnection(username, {
      enableExtendedGiftInfo: true,
      requestPolling: true, // stabil di Railway
      requestOptions: { timeout: 15000 },
    });

    const state = await connection.connect();
    tiktokConnection = connection;
    currentUser = username;

    console.log(`✅ Connected to roomId ${state.roomId} (${username})`);
    socket.emit("tiktokConnected", state);

    // ==============================
    // EVENT HANDLER
    // ==============================

    // Chat → hanya komentar 5 huruf dari follower
    connection.on("chat", (data) => {
      const text = (data.comment || "").trim().toUpperCase();
      const isFollower = data.isFollower === true; // properti dari connector

      if (/^[A-Z]{5}$/.test(text) && isFollower) {
        io.emit("tiktokBatch", [
          {
            type: "guess",
            user: data.uniqueId,
            nickname: data.nickname,
            guess: text,
            pfp: data.profilePictureUrl,
            follower: isFollower,
          },
        ]);
        console.log(`💬 [Follower] ${data.nickname}: ${text}`);
      } else if (/^[A-Z]{5}$/.test(text)) {
        console.log(`💬 [Non-follower ignored] ${data.nickname}: ${text}`);
      }
    });

    connection.on("gift", (data) => io.emit("gift", data));
    connection.on("like", (data) => io.emit("like", data));
    connection.on("member", (data) => io.emit("member", data));

    connection.on("disconnected", () => {
      console.warn("⚠️ Disconnected. Reconnecting in 5s...");
      setTimeout(() => connectTikTok(username, socket), 5000);
    });

    connection.on("streamEnd", () => {
      console.warn("🔴 Stream ended.");
      socket.emit("streamEnd");
    });
  } catch (err) {
    console.error("❌ Failed to connect:", err.message);
    socket.emit("tiktokDisconnected", err.message);
    setTimeout(() => connectTikTok(username, socket), 10000);
  }
}

// ==============================
// SOCKET.IO HANDLER
// ==============================
io.on("connection", (socket) => {
  console.log("Frontend connected:", socket.id);

  socket.on("setUniqueId", (uniqueId) => {
    if (!uniqueId) return;
    const username = uniqueId.replace(/^@/, "");
    connectTikTok(username, socket);
  });

  socket.on("disconnect", () => {
    console.log("Frontend disconnected:", socket.id);
  });
});

// ==============================
app.get("/", (req, res) => {
  res.json({
    status: "TikTok backend aktif",
    username: currentUser || null,
  });
});

server.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
