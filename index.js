require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

// ================== SUPABASE ==================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const WEBHOOK_SECRET = process.env.SAWERIA_WEBHOOK_SECRET || "";

// ================== VERIFY ==================
function verifySignature(req) {
  if (!WEBHOOK_SECRET) return true;

  const signature = req.headers["x-saweria-token"];
  if (!signature) return false;

  const body = JSON.stringify(req.body);
  const expected = crypto
    .createHmac("sha1", WEBHOOK_SECRET)
    .update(body)
    .digest("hex");

  if (signature.length !== expected.length) return false;

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// ================== WEBHOOK ==================
app.post("/webhook/saweria", async (req, res) => {
  try {
    if (!verifySignature(req)) {
      console.log("❌ Invalid signature");
      return res.status(401).json({ error: "Invalid signature" });
    }
  } catch (e) {
    console.log("❌ Signature error:", e.message);
    return res.status(400).json({ error: "Bad request" });
  }

  const body = req.body;
  console.log("🔥 DONASI MASUK:", JSON.stringify(body));

  const data = body.data || body;

  const donationId = body.id || body._id || String(Date.now());
  const username = (data.donatur || data.name || "Anonymous").trim();
  const amount = parseInt(data.amount || 0, 10);
  const message = (data.message || "").trim();

  if (!amount || amount <= 0) {
    return res.status(200).json({ status: "ignored" });
  }

  const { error } = await supabase.from("saweria_donations").insert({
    donation_id: donationId,
    username: username,
    amount: amount,
    message: message || null,
    processed: false,
    created_at: new Date().toISOString(),
  });

  if (error) {
    if (error.code === "23505") {
      console.log("⚠️ Duplicate:", donationId);
      return res.status(200).json({ status: "duplicate" });
    }
    console.log("❌ DB error:", error.message);
    return res.status(500).json({ error: "db error" });
  }

  console.log(`✅ SAVED: ${username} Rp${amount}`);
  res.json({ status: "ok" });
});

// ================== POLL ==================
app.get("/pending-donations", async (req, res) => {
  const { data, error } = await supabase
    .from("saweria_donations")
    .select("*")
    .eq("processed", false)
    .order("created_at", { ascending: true })
    .limit(10);

  if (error) return res.json({ donations: [] });

  const donations = (data || []).map((row) => ({
    id: row.donation_id,
    username: row.username,
    amount: row.amount,
    message: row.message,
  }));

  res.json({ donations });
});

// ================== ACK ==================
app.post("/ack-donation", async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "no id" });

  await supabase
    .from("saweria_donations")
    .update({ processed: true })
    .eq("donation_id", id);

  res.json({ status: "ok" });
});

// ================== HEALTH ==================
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// ================== START ==================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 RUNNING PORT " + PORT);
});
