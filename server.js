// server-railway-compatible.js
// Versi server.js yang disempurnakan agar kompatibel penuh dengan frontend
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

    console.log(`🔗 Menghubungkan ke TikTok live @${username}...`);

    const connection = new WebcastPushConnection(username, {
      enableExtendedGiftInfo: true,
      requestPolling: true, // stabil di Railway
      requestOptions: { timeout: 15000 },
    });

    const state = await connection.connect();
    tiktokConnection = connection;
    currentUser = username;

    // [DIUBAH] Sertakan uniqueId dalam state yang dikirim ke klien
    const clientState = { ...state, uniqueId: username };
    console.log(`✅ Terhubung ke roomId ${state.roomId} (${username})`);
    socket.emit("tiktokConnected", clientState);

    // ==============================
    // EVENT HANDLER (DIUBAH UNTU BATCHING)
    // ==============================

    // Fungsi helper untuk menyatukan data user
    const formatUserData = (data) => ({
      userId: data.userId || data.uniqueId,
      nickname: data.nickname,
      profilePictureUrl: data.profilePictureUrl,
      ...data, // Sertakan sisa data
    });

    // Chat → memproses tebakan, !win, dan obrolan biasa
    connection.on("chat", (data) => {
      const text = (data.comment || "").trim();
      const textUpper = text.toUpperCase();
      // [DIHAPUS] Filter follower tidak lagi diperlukan
      // const isFollower = data.isFollower === true;
      const userData = formatUserData(data);

      if (/^!WIN$/i.test(text)) {
        // [BARU] Menangani !win
        io.emit("tiktokBatch", [
          {
            type: "winCheck",
            ...userData,
          },
          // [FIX] Kurung kurawal ekstra dihapus dari sini
        ]);
        console.log(`🏆 [!win] Dijalankan oleh ${data.nickname}`);
      } else if (/^[A-Z]{5}$/.test(textUpper)) { // [DIUBAH] Kondisi '&& isFollower' dihapus
        // [DIUBAH] Menangani tebakan 5 huruf DARI SIAPA SAJA
        io.emit("tiktokBatch", [
          {
            type: "guess",
            guess: textUpper,
            // follower: isFollower, // [DIHAPUS]
            ...userData,
          },
        ]);
        console.log(`💬 [Tebakan] ${data.nickname}: ${textUpper}`);
      } else { // [DIUBAH] Blok 'else if' kedua dihapus karena sudah dicakup oleh 'else if' di atas
        // [BARU] Kirim obrolan biasa agar muncul di chatbox
        io.emit("tiktokBatch", [
          {
            type: "chat",
            comment: text,
            ...userData,
          },
        ]);
      }
      // [FIX] Blok 'else' duplikat dihapus dari sini
    });

    // [DIUBAH] Kirim 'like' sebagai batch
    connection.on("like", (data) =>
      io.emit("tiktokBatch", [
        {
          type: "like",
          ...formatUserData(data),
        },
      ])
    );

    // [DIUBAH] Kirim 'member' (join) sebagai batch
    connection.on("member", (data) =>
      io.emit("tiktokBatch", [
        {
          type: "member",
          ...formatUserData(data),
        },
      ])
    );

    // [BARU] Kirim 'social' (follow/share) sebagai batch
    connection.on("social", (data) =>
      io.emit("tiktokBatch", [
        {
          type: "social",
          ...formatUserData(data),
        },
      ])
    );

    // [BARU] Kirim 'roomUser' (viewer count) sebagai batch
    connection.on("roomUser", (data) =>
      io.emit("tiktokBatch", [
        {
          type: "roomUser",
          ...formatUserData(data),
        },
      ])
    );
    
    // [TIDAK BERUBAH] Gift masih bisa dikirim mentah jika frontend menanganinya
    // Jika frontend HANYA menangani tiktokBatch, ubah ini juga
    connection.on("gift", (data) => io.emit("gift", data)); // Frontend ini tidak menangani gift, jadi biarkan

    connection.on("disconnected", () => {
      console.warn("⚠️ Terputus. Menghubungkan ulang dalam 5 detik...");
      socket.emit("tiktokDisconnected", "Koneksi terputus, mencoba lagi...");
      setTimeout(() => connectTikTok(username, socket), 5000);
    });

    connection.on("streamEnd", () => {
      console.warn("🔴 LIVE berakhir.");
      socket.emit("streamEnd");
    });
  } catch (err) {
    console.error("❌ Gagal terhubung:", err.message);
    socket.emit("tiktokDisconnected", err.message);
    // Tidak perlu rekoneksi otomatis di sini jika gagal, biarkan user mencoba lagi
  }
}

// ==============================
// SOCKET.IO HANDLER
// ==============================
io.on("connection", (socket) => {
  console.log("Frontend terhubung:", socket.id);

  socket.on("setUniqueId", (uniqueId) => {
    if (!uniqueId) {
        socket.emit("tiktokDisconnected", "UniqueId tidak valid");
        return;
    }
    const username = uniqueId.replace(/^@/, "");
    connectTikTok(username, socket);
  });

  socket.on("disconnect", () => {
    console.log("Frontend terputus:", socket.id);
  });
});

// ==============================
app.get("/", (req, res) => {
  res.json({
    status: "TikTok backend aktif",
    username: currentUser || "Belum terhubung",
  });
});

server.listen(PORT, () =>
  console.log(`🚀 Server berjalan di port ${PORT}`)
);
