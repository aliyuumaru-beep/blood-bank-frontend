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

  // 🔐 ALWAYS authenticate first (serverless-safe)
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

    if (!response.ok) {
      throw new Error("Odoo authentication failed");
    }
  };

  try {
    // 1️⃣ Authenticate (MANDATORY)
    await authenticate();

    // 2️⃣ Aggregate blood volumes by blood bank
    const heatmapResponse = await fetch(
      `${ODOO_URL}/web/dataset/call_kw`,
      {
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
      }
    );

    const data = await heatmapResponse.json();

    if (data.error) {
      return res.status(500).json({
        error: "Odoo heatmap aggregation error",
        details: data.error,
      });
    }

    // 3️⃣ Extract Blood Bank IDs
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
    const bankResponse = await fetch(
      `${ODOO_URL}/web/dataset/call_kw`,
      {
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
      }
    );

    const bankData = await bankResponse.json();

    if (bankData.error) {
      return res.status(500).json({
        error: "Odoo blood bank fetch err
