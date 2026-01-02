export default async function handler(req, res) {
  try {
    const { ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD } = process.env;

    if (!ODOO_URL || !ODOO_DB || !ODOO_USERNAME || !ODOO_PASSWORD) {
      return res.status(500).json({
        error: "Missing Odoo environment variables",
        debug: {
          ODOO_URL: !!ODOO_URL,
          ODOO_DB: !!ODOO_DB,
          ODOO_USERNAME: !!ODOO_USERNAME,
          ODOO_PASSWORD: !!ODOO_PASSWORD,
        },
      });
    }

    const response = await fetch(`${ODOO_URL}/web/session/authenticate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        params: {
          db: ODOO_DB,
          login: ODOO_USERNAME,
          password: ODOO_PASSWORD,
        },
      }),
    });

    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
