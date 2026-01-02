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

  const headers = { "Content-Type": "application/json" };

  try {
    // 1️⃣ Authenticate and capture cookie
    const authRes = await fetch(`${ODOO_URL}/web/session/authenticate`, {
      method: "POST",
      headers,
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
      return res.status(401).json({ error: "Odoo authentication failed" });
    }

    const authHeaders = {
      "Content-Type": "application/json",
      Cookie: cookie,
    };

    // 2️⃣ Aggregate AVAILABLE blood volumes by blood bank
    const heatmapRes = await fetch(`${ODOO_URL}/web/dataset/call_kw`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        params: {
          model: "x_blood_units",
          method: "read_group",
          args: [
            //[["x_studio_lifecycle_status", "=", "available"]],
            [[]]
            [
              "x_studio_volume_ml",
              "x_studio_many2one_field_7q0_1jdoqenki",
            ],
            ["x_studio_many2one_field_7q0_1jdoqenki"],
          ],
          kwargs: {},
        },
      }),
    });

    const heatmapText = await heatmapRes.text();
    const heatmapData = JSON.parse(heatmapText);

    if (heatmapData.error) {
      return res.status(500).json({
        error: "Odoo heatmap aggregation error",
        details: heatmapData.error,
      });
    }

    // 3️⃣ Extract Blood Bank IDs
    const bankIds = heatmapData.result
      .map(r => r.x_studio_many2one_field_7q0_1jdoqenki?.[0])
      .filter(Boolean);

    if (!bankIds.length) {
      return res.json({ success: true, data: [] });
    }

    // 4️⃣ Fetch Blood Bank coordinates
    const bankRes = await fetch(`${ODOO_URL}/web/dataset/call_kw`, {
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

    const bankText = await bankRes.text();
    const bankData = JSON.parse(bankText);

    if (bankData.error) {
      return res.status(500).json({
        error: "Odoo blood bank fetch error",
        details: bankData.error,
      });
    }

    const bankMap = {};
    bankData.result.forEach(b => (bankMap[b.id] = b));

    // 5️⃣ Final heatmap payload
    const heatmap = heatmapData.result
      .map(row => {
        const bankId =
          row.x_studio_many2one_field_7q0_1jdoqenki?.[0];
        const bank = bankMap[bankId];
        if (!bank) return null;

        return {
          id: bankId,
          name: bank.name,
          lat: bank.x_studio_latitude,
          lng: bank.x_studio_longitude,
          intensity: row.x_studio_volume_ml || 0,
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
