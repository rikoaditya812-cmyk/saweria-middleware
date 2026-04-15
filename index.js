require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

// =======================
// ENV
// =======================
const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const WEBHOOK_SECRET = process.env.SAWERIA_WEBHOOK_SECRET || "";

// =======================
// 🔥 VERIFY SIGNATURE (BYPASS MODE)
// =======================
function verifySignature(req) {
  // 🔥 IMPORTANT: Bypass dulu biar bisa test dari Hoppscotch
  return true;

  /*
  // ❌ Aktifin ini nanti kalau udah production
  if (!WEBHOOK_SECRET) return true;

  const signature = req.headers["x-saweria-token"] || "";
  const body = JSON.stringify(req.body);

  const expected = crypto
    .createHmac("sha1", WEBHOOK_SECRET)
    .update(body)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
  */
}

// =======================
// 🔥 WEBHOOK SAWERIA (FIX FORMAT + TEST MODE)
// =======================
app.post("/webhook/saweria", async (req, res) => {
  try {
    if (!verifySignature(req)) {
      console.warn("❌ INVALID SIGNATURE");
      return res.status(401).json({ error: "Invalid signature" });
    }

    const body = req.body;
    console.log("🔥 DONASI MASUK:", JSON.stringify(body, null, 2));

    // 🔥 SUPPORT 2 FORMAT (REAL + TEST)
    const data = body.data || body;

    const donationId = body.id || data.id || String(Date.now());
    const username = (data.donatur || data.username || data.name || "Anonymous").trim();
    const amount = parseInt(data.amount || 0, 10);
    const message = (data.message || "").trim();

    if (!amount || amount <= 0) {
      console.warn("⚠️ DONASI DIABAIKAN (amount 0)");
      return res.json({ status: "ignored" });
    }

    // =======================
    // SIMPAN KE SUPABASE
    // =======================
    const { error } = await supabase.from("saweria_donations").insert({
      donation_id: donationId,
      username: username,
      amount: amount,
      message: message || null,
      processed: false,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error("❌ SUPABASE ERROR:", error);
      return res.status(500).json({ error: "Database error", detail: error });
    }

    console.log(`✅ SAVED: ${username} - Rp${amount}`);

    res.json({ status: "ok" });
  } catch (err) {
    console.error("❌ WEBHOOK ERROR:", err);
    res.status(500).json({ error: "Webhook error" });
  }
});

// =======================
// 📥 GET DONASI (ROBLOX)
// =======================
app.get("/pending-donations", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("saweria_donations")
      .select("*")
      .eq("processed", false)
      .order("created_at", { ascending: true })
      .limit(10);

    if (error) {
      console.error("❌ FETCH ERROR:", error);
      return res.status(500).json({ donations: [] });
    }

    const donations = (data || []).map((row) => ({
      id: row.donation_id,
      username: row.username,
      amount: row.amount,
      message: row.message || null,
    }));

    console.log("📦 KIRIM KE ROBLOX:", donations.length);

    res.json({ donations });
  } catch (err) {
    console.error("❌ ERROR:", err);
    res.status(500).json({ donations: [] });
  }
});

// =======================
// ✅ ACK DARI ROBLOX
// =======================
app.post("/ack-donation", async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({ error: "Missing id" });
    }

    const { error } = await supabase
      .from("saweria_donations")
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
      })
      .eq("donation_id", id);

    if (error) {
      console.error("❌ UPDATE ERROR:", error);
      return res.status(500).json({ error });
    }

    console.log("✅ MARKED PROCESSED:", id);

    res.json({ status: "ok" });
  } catch (err) {
    console.error("❌ ACK ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =======================
// ❤️ TEST ENDPOINT (BIAR GA RIBET)
// =======================
app.get("/test", async (req, res) => {
  const fake = {
    donation_id: "test-" + Date.now(),
    username: "TestPlayer",
    amount: 50000,
    message: "INI TEST AUTO",
    processed: false,
    created_at: new Date().toISOString(),
  };

  await supabase.from("saweria_donations").insert(fake);

  console.log("🧪 TEST DONASI MASUK");

  res.json({ status: "inserted", fake });
});

// =======================
// HEALTH CHECK
// =======================
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// =======================
// START SERVER
// =======================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
