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
    const response = await fetch(
      `${ODOO_URL}/web/session/authenticate`,
      {
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
      }
    );

    return response.ok;
  };

  // 🔁 Heatmap aggregation
  const callHeatmapQuery = async () => {
    return fetch(`${ODOO_URL}/web/dataset/call_kw`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        params: {
          model: "x_blood_unit", // 🔴 adjust if model name differs
          method: "read_group",
          args: [
            [["state", "=", "available"]],
            ["quantity", "blood_bank_id"],
            ["blood_bank_id"],
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

    // 3️⃣ Fetch lat/lng from blood bank model
    const bankIds = data.result
      .map(row => row.blood_bank_id?.[0])
      .filter(Boolean);

    if (!bankIds.length) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    const bankResponse = await fetch(`${ODOO_URL}/web/dataset/call_kw`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        params: {
          model: "x_blood_bank", // 🔴 adjust if model name differs
          method: "search_read",
          args: [[["id", "in", bankIds]]],
          kwargs: {
            fields: ["id", "name", "latitude", "longitude"],
          },
        },
      }),
      credentials: "include",
    });

    const bankData = await bankResponse.json();

    const bankMap = {};
    bankData.result.forEach(b => {
      bankMap[b.id] = b;
    });

    // 4️⃣ Final heatmap payload
    const heatmap = data.result.map(row => {
      const bankId = row.blood_bank_id?.[0];
      const bank = bankMap[bankId] || {};

      return {
        id: bankId,
        name: bank.name || "Unknown",
        lat: bank.latitude,
        lng: bank.longitude,
        intensity: row.quantity || 0,
      };
    }).filter(p => p.lat && p.lng);

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
