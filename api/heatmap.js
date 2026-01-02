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

  // 🔐 Authenticate helper
  const authenticate = async () => {
    const response = await fetch(`${ODOO_URL}/web/session/authenticate`, {
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
      credentials: "include",
    });

    return response.ok;
  };

  // 🔁 Heatmap aggregation — FIXED TO MATCH STUDIO SCHEMA
  const callHeatmapQuery = async () => {
    return fetch(`${ODOO_URL}/web/dataset/call_kw`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        params: {
          model: "x_blood_units",
          method: "read_group",
          args: [
            [["state", "=", "available"]],
            [
              "x_studio_volume_ml",
              "x_studio_many2one_field_7q0_1jdoqenki",
            ],
            ["x_studio_many2one_field_7q0_1jdoqenki"],
          ],
          kwargs: {},
        },
      }),
      credentials: "include",
    });
  };

  try {
    // 1️⃣ Attempt without re-auth
    let response = await callHeatmapQuery();

    // 2️⃣ Re-authenticate once if needed
    if (response.status === 401 || response.status === 403) {
      const authed = await authenticate();
      if (!authed) {
        return res.status(401).json({
          error: "Authentication with Odoo failed",
        });
      }
      response = await callHeatmapQuery();
    }

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({
        error: "Odoo heatmap aggregation error",
        details: data.error,
      });
    }

    // 3️⃣ Extract Blood Bank IDs from aggregation
    const bankIds = data.result
      .map(
        row =>
          row.x_studio_many2one_field_7q0_1jdoqenki &&
          row.x_studio_many2one_field_7q0_1jdoqenki[0]
      )
      .filter(Boolean);

    if (!bankIds.length) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    // 4️⃣ Fetch Blood Bank coordinates
    const bankResponse = await fetch(`${ODOO_URL}/web/dataset/call_kw`, {
      method: "POST",
      headers,
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
      credentials: "include",
    });

    const bankData = await bankResponse.json();

    if (bankData.error) {
      return res.status(500).json({
        error: "Odoo blood bank fetch error",
        details: bankData.error,
      });
    }

    const bankMap = {};
    bankData.result.forEach(b => {
      bankMap[b.id] = b;
    });

    // 5️⃣ Final heatmap payload
    const heatmap = data.result
      .map(row => {
        const bankId =
          row.x_studio_many2one_field_7q0_1jdoqenki &&
          row.x_studio_many2one_field_7q0_1jdoqenki[0];

        const bank = bankMap[bankId] || {};

        return {
          id: bankId,
          name: bank.name || "Unknown",
          lat: bank.x_studio_latitude,
          lng: bank.x_studio_longitude,
          intensity: row.x_studio_volume_ml || 0,
        };
      })
      .filter(p => p.lat && p.lng);

    return res.status(200).json({
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

