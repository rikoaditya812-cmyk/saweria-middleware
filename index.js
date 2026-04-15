const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const app = express();
app.use(express.json());

// ================================================================
// KONFIGURASI — ganti dengan milikmu
// ================================================================
const SUPABASE_URL = process.env.SUPABASE_URL || "https://XXXXXXXX.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "YOUR_SUPABASE_SERVICE_ROLE_KEY";
const PORT        = process.env.PORT || 3000;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ================================================================
// HELPER LOG
// ================================================================
function log(tag, ...args) {
  console.log(`[${new Date().toISOString()}] [${tag}]`, ...args);
}

// ================================================================
// WEBHOOK SAWERIA — POST /saweria-webhook
// Saweria kirim data ke sini saat ada donasi masuk
// ================================================================
app.post("/saweria-webhook", async (req, res) => {
  const body = req.body;
  log("WEBHOOK", "Payload masuk:", JSON.stringify(body));

  // Saweria mengirim: donator_name, amount, message
  const username  = body.donator_name || body.from || body.name || "Anonymous";
  const amount    = parseInt(body.amount || body.nominal || 0);
  const message   = body.message || body.pesan || "";
  const user_id   = body.user_id ? parseInt(body.user_id) : null;

  if (!amount || amount <= 0) {
    log("WEBHOOK", "Amount tidak valid, skip:", amount);
    return res.status(200).json({ status: "skip", reason: "amount invalid" });
  }

  const id = `saw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const { error } = await supabase.from("saweria_donations").insert({
    id,
    username,
    amount,
    message,
    user_id,
    processed: false,
  });

  if (error) {
    log("WEBHOOK", "❌ ERROR insert Supabase:", error.message);
    return res.status(500).json({ status: "error", message: error.message });
  }

  log("WEBHOOK", `✅ Donasi masuk | ${username} | Rp ${amount.toLocaleString()} | id: ${id}`);
  res.status(200).json({ status: "ok", id });
});

// ================================================================
// GET /pending-donations
// Roblox polling ke sini setiap beberapa detik
// ================================================================
app.get("/pending-donations", async (req, res) => {
  log("PENDING", "Roblox polling...");

  const { data, error } = await supabase
    .from("saweria_donations")
    .select("id, username, amount, message, user_id")
    .eq("processed", false)
    .order("created_at", { ascending: true })
    .limit(5);

  if (error) {
    log("PENDING", "❌ ERROR fetch:", error.message);
    return res.status(500).json({ donations: [] });
  }

  // Normalisasi field agar cocok dengan Roblox script
  const donations = (data || []).map((d) => ({
    id:       d.id,
    username: d.username || "Anonymous",
    amount:   d.amount   || 0,
    message:  d.message  || "",
    userId:   d.user_id  || 0,
  }));

  log("PENDING", `${donations.length} donasi pending ditemukan`);
  if (donations.length > 0) {
    donations.forEach(d =>
      log("PENDING", ` → ${d.username} | Rp ${d.amount.toLocaleString()} | id: ${d.id}`)
    );
  }

  res.status(200).json({ donations });
});

// ================================================================
// POST /ack-donation
// Roblox kirim ACK setelah efek dijalankan → tandai processed = true
// ================================================================
app.post("/ack-donation", async (req, res) => {
  const { id } = req.body;
  if (!id) {
    log("ACK", "❌ id tidak diberikan");
    return res.status(400).json({ status: "error", reason: "missing id" });
  }

  const { error } = await supabase
    .from("saweria_donations")
    .update({ processed: true })
    .eq("id", id);

  if (error) {
    log("ACK", `❌ ERROR update id ${id}:`, error.message);
    return res.status(500).json({ status: "error", message: error.message });
  }

  log("ACK", `✅ Donasi ${id} ditandai processed`);
  res.status(200).json({ status: "ok", id });
});

// ================================================================
// POST /fake-donation — endpoint TEST manual
// Kirim dari browser / Postman / curl untuk test tanpa Saweria
// ================================================================
app.post("/fake-donation", async (req, res) => {
  const username = req.body.username || "TestDonor";
  const amount   = parseInt(req.body.amount || 50000);
  const message  = req.body.message || "Test donasi";
  const user_id  = req.body.user_id ? parseInt(req.body.user_id) : null;

  const id = `fake_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const { error } = await supabase.from("saweria_donations").insert({
    id,
    username,
    amount,
    message,
    user_id,
    processed: false,
  });

  if (error) {
    log("FAKE", "❌ ERROR:", error.message);
    return res.status(500).json({ status: "error", message: error.message });
  }

  log("FAKE", `✅ Fake donasi dibuat | ${username} | Rp ${amount.toLocaleString()} | id: ${id}`);
  res.status(200).json({ status: "ok", id, username, amount, message });
});

// ================================================================
// GET /top-spenders — untuk leaderboard Top Spender Saweria
// Roblox fetch data top donor dari sini
// ================================================================
app.get("/top-spenders", async (req, res) => {
  const { data, error } = await supabase
    .from("saweria_donations")
    .select("username, amount");

  if (error) {
    log("TOP", "❌ ERROR:", error.message);
    return res.status(500).json({ top: [] });
  }

  // Akumulasi per username
  const totals = {};
  for (const d of (data || [])) {
    const name = d.username || "Anonymous";
    totals[name] = (totals[name] || 0) + (d.amount || 0);
  }

  const sorted = Object.entries(totals)
    .map(([username, total]) => ({ username, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  log("TOP", `Top ${sorted.length} spender dikembalikan`);
  res.status(200).json({ top: sorted });
});

// ================================================================
// POST /admin-set-donation — Admin panel manual entry
// Khusus admin: tambah/edit total donasi seseorang
// ================================================================
app.post("/admin-set-donation", async (req, res) => {
  const { admin_key, username, amount, message, user_id } = req.body;

  // Ganti ADMIN_SECRET_KEY dengan key rahasia kamu
  const ADMIN_KEY = process.env.ADMIN_KEY || "RAHASIA_ADMIN_123";
  if (admin_key !== ADMIN_KEY) {
    log("ADMIN", "❌ Akses ditolak, key salah");
    return res.status(403).json({ status: "forbidden" });
  }

  if (!username || !amount) {
    return res.status(400).json({ status: "error", reason: "username dan amount wajib diisi" });
  }

  const id = `admin_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const { error } = await supabase.from("saweria_donations").insert({
    id,
    username,
    amount: parseInt(amount),
    message: message || "[Admin Entry]",
    user_id: user_id ? parseInt(user_id) : null,
    processed: false, // false agar muncul di game
  });

  if (error) {
    log("ADMIN", "❌ ERROR:", error.message);
    return res.status(500).json({ status: "error", message: error.message });
  }

  log("ADMIN", `✅ Admin entry | ${username} | Rp ${parseInt(amount).toLocaleString()}`);
  res.status(200).json({ status: "ok", id });
});

// ================================================================
// GET /health — cek server hidup
// ================================================================
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ================================================================
// START
// ================================================================
app.listen(PORT, () => {
  log("SERVER", `✅ Berjalan di port ${PORT}`);
  log("SERVER", "Endpoints:");
  log("SERVER", "  POST /saweria-webhook    ← dari Saweria");
  log("SERVER", "  GET  /pending-donations  ← polling Roblox");
  log("SERVER", "  POST /ack-donation       ← ACK dari Roblox");
  log("SERVER", "  GET  /top-spenders       ← leaderboard Roblox");
  log("SERVER", "  POST /fake-donation      ← test manual");
  log("SERVER", "  POST /admin-set-donation ← admin panel");
  log("SERVER", "  GET  /health             ← cek server");
});
