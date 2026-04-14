require("dotenv").config();

const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

// 🔥 ENV
const PORT = process.env.PORT || 3000;
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// =======================
// WEBHOOK SAWERIA
// =======================
app.post("/webhook/saweria", async (req, res) => {
  try {
    const data = req.body;

    console.log("🔥 DONASI MASUK:", JSON.stringify(data, null, 2));

    const donationId = data.id;
    const username   = data.donator_name || "Anonim";
    const amount     = data.amount_raw || 0;
    const message    = data.message || "";

    // 🔥 SIMPAN KE DB (INI YANG TADI LO TANYA)
    const { error } = await supabase.from("saweria_donations").insert({
      donation_id : donationId,
      username    : username,
      amount      : amount,
      message     : message || null,
      processed   : false,
      created_at  : new Date().toISOString(),
    });

    if (error) {
      console.error("❌ SUPABASE FULL ERROR:", error);
      console.error("❌ DETAIL:", JSON.stringify(error, null, 2));
      return res.status(500).json({ error: "Database error", detail: error });
    }

    console.log(`✅ SAVED KE DB: ${username} - Rp${amount}`);

    res.json({ ok: true });

  } catch (err) {
    console.error("❌ WEBHOOK ERROR:", err);
    res.status(500).json({ error: "Webhook error" });
  }
});

// =======================
// AMBIL DONASI (UNTUK CEK)
// =======================
app.get("/pending-donations", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("saweria_donations")
      .select("*")
      .eq("processed", false)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("❌ FETCH ERROR:", error);
      return res.status(500).json({ error });
    }

    res.json({ donations: data });

  } catch (err) {
    console.error("❌ ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =======================
// MARK SELESAI
// =======================
app.post("/mark-done/:id", async (req, res) => {
  const id = req.params.id;

  const { error } = await supabase
    .from("saweria_donations")
    .update({ processed: true })
    .eq("id", id);

  if (error) {
    console.error("❌ UPDATE ERROR:", error);
    return res.status(500).json({ error });
  }

  res.json({ success: true });
});

// =======================
app.listen(PORT, () => {
  console.log("🚀 Server jalan di port " + PORT);
});
