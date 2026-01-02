export default async function handler(req, res) {
  try {
    const response = await fetch(
      `${process.env.ODOO_URL}/web/session/authenticate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          params: {
            db: process.env.ODOO_DB,
            login: process.env.ODOO_USERNAME,
            password: process.env.ODOO_PASSWORD,
          },
        }),
      }
    );

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
