export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    ODOO_URL,
    ODOO_DB,
    ODOO_USERNAME,
    ODOO_PASSWORD,
  } = process.env;

  if (!ODOO_URL || !ODOO_DB || !ODOO_USERNAME || !ODOO_PASSWORD) {
    return res.status(500).json({
      error: "Missing Odoo environment variables",
    });
  }

  const baseHeaders = { "Content-Type": "application/json" };

  try {
    /* =====================================================
       1️⃣ Authenticate & get session cookie
       ===================================================== */
    const authRes = await fetch(`${ODOO_URL}/web/session/authenticate`, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        params: {
          db: ODOO_DB,
          login: ODOO_USERNAME,
          password: ODOO_PASSWORD,
        },
      }),
    });

    const cookie = authRes.headers.get("set-cookie");

    if (!authRes.ok || !cookie) {
      return res.status(401).json({
        error: "Odoo authentication failed",
      });
    }

    const authHeaders = {
      "Content-Type": "application/json",
      Cookie: cookie,
    };

    /* =====================================================
       2️⃣ Fetch ALL blood units (NO read_group)
       ===================================================== */
    const unitsRes = await fetch(`${ODOO_URL}/web/dataset/call_kw`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        params: {
          model: "x_blood_units",
          method: "search_read",
          args: [[]], // no filter for now (safe)
          kwargs: {
            fields: [
              "x_studio_volume_ml",
              "x_studio_many2one_field_7q0_1jdoqenki",
            ],
          },
        },
      }),
    });

    const unitsData = await unitsRes.json();

    if (unitsData.error) {
      return res.status(500).json({
        error: "Failed to fetch blood units",
        details: unitsData.error,
      });
    }

    /* =====================================================
       3️⃣ Aggregate volume per Blood Bank (JS-side)
       ===================================================== */
    const volumeByBank = {};

    unitsData.result.forEach(unit => {
      const bank = unit.x_studio_many2one_field_7q0_1jdoqenki;
      const volume = unit.x_studio_volume_ml || 0;

      if (!bank || !bank[0]) return;

      const bankId = bank[0];

      volumeByBank[bankId] =
        (volumeByBank[bankId] || 0) + volume;
    });

    const bankIds = Object.keys(volumeByBank).map(Number);

    if (!bankIds.length) {
      return res.json({ success: true, data: [] });
    }

    /* =====================================================
       4️⃣ Fetch Blood Bank coordinates
       ===================================================== */
    const banksRes = await fetch(`${ODOO_URL}/web/dataset/call_kw`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        params: {
          model: "x_bloodbanks",
          method: "search_read",
          args: [[["id", "in", bankIds]]],
          kwargs: {
            fields: [
              "id",
              "name",
              "x_studio_latitude",
              "x_studio_longitude",
            ],
          },
        },
      }),
    });

    const banksData = await banksRes.json();

    if (banksData.error) {
      return res.status(500).json({
        error: "Failed to fetch blood banks",
        details: banksData.error,
      });
    }

    /* =====================================================
       5️⃣ Build heatmap payload
       ===================================================== */
    const heatmap = banksData.result
      .map(bank => {
        const intensity = volumeByBank[bank.id] || 0;

        if (!bank.x_studio_latitude || !bank.x_studio_longitude) {
          return null;
        }

        return {
          id: bank.id,
          name: bank.name,
          lat: bank.x_studio_latitude,
          lng: bank.x_studio_longitude,
          intensity,
        };
      })
      .filter(Boolean);

    return res.json({
      success: true,
      data: heatmap,
    });

  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      message: err.message,
    });
  }
}
