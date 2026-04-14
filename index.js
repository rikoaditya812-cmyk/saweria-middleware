require("dotenv").config();
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

// ==========================
// SUPABASE
// ==========================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ==========================
// WEBHOOK SAWERIA
// ==========================
app.post("/webhook/saweria", async (req, res) => {
  const body = req.body;
  console.log("[WEBHOOK] Masuk:", JSON.stringify(body));

  const data = body.data || body;

  const donationId = body.id || body._id || String(Date.now());
  const username   = (data.donatur || data.name || "Anonymous").trim();
  const amount     = parseInt(data.amount || 0, 10);
  const message    = (data.message || "").trim();

  if (!amount || amount <= 0) {
    return res.status(200).json({ status: "ignored" });
  }

  const { error } = await supabase.from("saweria_donations").insert({
    donation_id : donationId,
    username    : username,
    amount      : amount,
    message     : message || null,
    processed   : false,
    created_at  : new Date().toISOString(),
  });

  if (error) {
    if (error.code === "23505") {
      return res.status(200).json({ status: "duplicate" });
    }
    console.error("[DB ERROR]", error.message);
    return res.status(500).json({ error: "db error" });
  }

  console.log(`[SAVED] ${username} - Rp${amount}`);
  res.status(200).json({ status: "ok" });
});

// ==========================
// GET DONASI BELUM DIPROSES
// ==========================
app.get("/pending-donations", async (req, res) => {
  const { data, error } = await supabase
    .from("saweria_donations")
    .select("*")
    .eq("processed", false)
    .order("created_at", { ascending: true })
    .limit(10);

  if (error) {
    console.error("[POLL ERROR]", error.message);
    return res.status(500).json({ donations: [] });
  }

  const donations = (data || []).map((row) => ({
    id      : row.donation_id,
    username: row.username,
    amount  : row.amount,
    message : row.message || null,
  }));

  res.json({ donations });
});

// ==========================
// ACK DONASI
// ==========================
app.post("/ack-donation", async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "no id" });

  const { error } = await supabase
    .from("saweria_donations")
    .update({
      processed: true,
      processed_at: new Date().toISOString(),
    })
    .eq("donation_id", id);

  if (error) {
    console.error("[ACK ERROR]", error.message);
    return res.status(500).json({ error: "db error" });
  }

  res.json({ status: "ok" });
});

// ==========================
// HEALTH CHECK
// ==========================
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ==========================
// START SERVER
// ==========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("RUNNING ON PORT " + PORT);
});
