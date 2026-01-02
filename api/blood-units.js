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

  // 🔐 Authenticate
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

  // 🔁 Call Odoo read_group
  const callReadGroup = async () => {
    return fetch(`${ODOO_URL}/web/dataset/call_kw`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        params: {
          model: "x_blood_unit", // 🔴 CHANGE IF YOUR MODEL NAME DIFFERS
          method: "read_group",
          args: [
            [["state", "=", "available"]],
            ["blood_type", "quantity"],
            ["blood_type"],
          ],
          kwargs: {},
        },
      }),
      credentials: "include",
    });
  };

  try {
    // 1️⃣ Try without re-auth
    let response = await callReadGroup();

    // 2️⃣ Retry once if session expired
    if (response.status === 401 || response.status === 403) {
      const authed = await authenticate();
      if (!authed) {
        return res.status(401).json({
          error: "Authentication with Odoo failed",
        });
      }
      response = await callReadGroup();
    }

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({
        error: "Odoo read_group error",
        details: data.error,
      });
    }

    // 3️⃣ Normalize output (frontend-friendly)
    const result = data.result.map(row => ({
      blood_type: row.blood_type?.[1] || "Unknown",
      total_units: row.quantity || 0,
      count: row.__count || 0,
    }));

    return res.status(200).json({
      success: true,
      data: result,
    });

  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      message: err.message,
    });
  }
}
