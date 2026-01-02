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

  const { model, method, args = [], kwargs = {} } = req.body;

  if (!model || !method) {
    return res.status(400).json({
      error: "model and method are required",
    });
  }

  const headers = { "Content-Type": "application/json" };

  // 🔐 Authenticate helper
  const authenticate = async () => {
    const r = await fetch(`${ODOO_URL}/web/session/authenticate`, {
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

    const j = await r.json();
    return !!j?.result?.uid;
  };

  // 🔁 Generic RPC call
  const callOdoo = async () => {
    const r = await fetch(`${ODOO_URL}/web/dataset/call_kw`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        params: {
          model,
          method,
          args,
          kwargs,
        },
      }),
      credentials: "include",
    });

    return r.json();
  };

  try {
    // 1️⃣ First attempt (reuse session)
    let data = await callOdoo();

    // 2️⃣ Detect SESSION EXPIRED at RPC level
    const isSessionExpired =
      data?.error?.code === 100 &&
      data?.error?.data?.name === "odoo.http.SessionExpiredException";

    if (isSessionExpired) {
      const authed = await authenticate();

      if (!authed) {
        return res.status(401).json({
          error: "Odoo authentication failed",
        });
      }

      // 3️⃣ Retry ONCE after re-auth
      data = await callOdoo();
    }

    // 4️⃣ Handle any remaining Odoo errors
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

