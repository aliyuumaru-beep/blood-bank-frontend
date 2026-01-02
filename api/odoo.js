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

  const { model, method, args = [], kwargs = {} } = req.body;

  if (!model || !method) {
    return res.status(400).json({ error: "model and method required" });
  }

  const headers = { "Content-Type": "application/json" };

  try {
    // 1️⃣ Authenticate
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

    const authJson = await authRes.json();

    if (!authJson?.result?.uid) {
      return res.status(401).json({
        error: "Odoo authentication failed",
        details: authJson,
      });
    }

    // 2️⃣ Extract session cookie
    const cookie = authRes.headers.get("set-cookie");

    if (!cookie) {
      return res.status(500).json({
        error: "No session cookie received from Odoo",
      });
    }

    // 3️⃣ Call model WITH cookie
    const rpcRes = await fetch(`${ODOO_URL}/web/dataset/call_kw`, {
      method: "POST",
      headers: {
        ...headers,
        Cookie: cookie,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        params: {
          model,
          method,
          args,
          kwargs,
        },
      }),
    });

    const data = await rpcRes.json();

    if (data?.error) {
      return res.status(500).json({
        error: "Odoo RPC Error",
        details: data.error,
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      message: err.message,
    });
  }
}
