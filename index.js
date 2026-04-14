// ================================================================
// Saweria Webhook Middleware
// Deploy ke: Railway / Render / Vercel (serverless)
//
// Setup:
//   npm install express @supabase/supabase-js dotenv crypto
//   node index.js
// ================================================================

require("dotenv").config();
const express    = require("express");
const crypto     = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app  = express();
app.use(express.json());

// ================================================================
// SUPABASE CLIENT
// Isi di file .env kamu:
//   SUPABASE_URL=https://xxxxx.supabase.co
//   SUPABASE_KEY=your-service-role-key
//   SAWERIA_WEBHOOK_SECRET=secret-kamu-dari-dashboard-saweria
//   PORT=3000
// ================================================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const WEBHOOK_SECRET = process.env.SAWERIA_WEBHOOK_SECRET || "";

// ================================================================
// VERIFY SIGNATURE SAWERIA
// Saweria mengirim header "x-saweria-token" berisi HMAC-SHA1
// ================================================================
function verifySignature(req) {
  if (!WEBHOOK_SECRET) return true; // skip kalau secret belum diset
  const signature = req.headers["x-saweria-token"] || "";
  const body      = JSON.stringify(req.body);
  const expected  = crypto
    .createHmac("sha1", WEBHOOK_SECRET)
    .update(body)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// ================================================================
// POST /webhook/saweria
// Saweria akan POST ke URL ini setiap ada donasi masuk
// Set di dashboard Saweria: https://YOUR-APP.railway.app/webhook/saweria
// ================================================================
app.post("/webhook/saweria", async (req, res) => {
  // Verifikasi signature
  try {
    if (!verifySignature(req)) {
      console.warn("[WEBHOOK] Invalid signature!");
      return res.status(401).json({ error: "Invalid signature" });
    }
  } catch (e) {
    console.error("[WEBHOOK] Signature check error:", e.message);
    return res.status(400).json({ error: "Bad request" });
  }

  const body = req.body;
  console.log("[WEBHOOK] Donasi masuk:", JSON.stringify(body));

  // Struktur payload Saweria:
  // {
  //   "id": "uuid-donasi",
  //   "type": "donation",
  //   "data": {
  //     "donatur": "username-roblox",  ← dari kolom 'nama' di Saweria
  //     "amount": 50000,
  //     "message": "pesan opsional",
  //     "media_url": "..."
  //   }
  // }
  const data = body.data || body;

  const donationId = body.id || body._id || String(Date.now());
  const username   = (data.donatur || data.name || "Anonymous").trim();
  const amount     = parseInt(data.amount || 0, 10);
  const message    = (data.message || "").trim();

  if (!amount || amount <= 0) {
    return res.status(200).json({ status: "ignored", reason: "amount 0" });
  }

  // Simpan ke Supabase
  const { error } = await supabase.from("saweria_donations").insert({
    donation_id : donationId,
    username    : username,
    amount      : amount,
    message     : message || null,
    processed   : false,
    created_at  : new Date().toISOString(),
  });

  if (error) {
    // Cek apakah error karena duplicate (sudah ada)
    if (error.code === "23505") {
      console.log("[WEBHOOK] Donasi duplikat, skip:", donationId);
      return res.status(200).json({ status: "duplicate" });
    }
    console.error("[WEBHOOK] Supabase error:", error.message);
    return res.status(500).json({ error: "Database error" });
  }

  console.log(`[WEBHOOK] ✅ Saved: ${username} - Rp${amount.toLocaleString()}`);
  res.status(200).json({ status: "ok" });
});

// ================================================================
// GET /pending-donations
// Dipanggil oleh Roblox setiap POLL_INTERVAL detik
// Mengembalikan donasi yang belum diproses
// ================================================================
app.get("/pending-donations", async (req, res) => {
  const { data, error } = await supabase
    .from("saweria_donations")
    .select("*")
    .eq("processed", false)
    .order("created_at", { ascending: true })
    .limit(10); // max 10 per poll

  if (error) {
    console.error("[POLL] Supabase error:", error.message);
    return res.status(500).json({ donations: [] });
  }

  const donations = (data || []).map((row) => ({
    id      : row.donation_id,
    username: row.username,
    amount  : row.amount,
    message : row.message || null,
  }));

  res.status(200).json({ donations });
});

// ================================================================
// POST /ack-donation
// Dipanggil Roblox setelah berhasil memproses donasi
// Menandai donasi sebagai "processed" di database
// ================================================================
app.post("/ack-donation", async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "Missing id" });

  const { error } = await supabase
    .from("saweria_donations")
    .update({ processed: true, processed_at: new Date().toISOString() })
    .eq("donation_id", id);

  if (error) {
    console.error("[ACK] Supabase error:", error.message);
    return res.status(500).json({ error: "Database error" });
  }

  console.log("[ACK] ✅ Marked processed:", id);
  res.status(200).json({ status: "ok" });
});

// ================================================================
// GET /health
// Buat cek apakah server hidup
// ================================================================
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ================================================================
// START SERVER
// ================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[SERVER] ✅ Running on port ${PORT}`);
  console.log(`[SERVER] Webhook URL: POST /webhook/saweria`);
  console.log(`[SERVER] Poll URL:    GET  /pending-donations`);
});
