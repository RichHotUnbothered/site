// Minimal PayPal Orders v2 client (plain fetch).
// Env: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV = "sandbox" | "live"

function base() {
  return (process.env.PAYPAL_ENV || '').trim().toLowerCase() === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function token() {
  const PAYPAL_CLIENT_ID = (process.env.PAYPAL_CLIENT_ID || '').trim();
  const PAYPAL_CLIENT_SECRET = (process.env.PAYPAL_CLIENT_SECRET || '').trim();
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw Object.assign(new Error('PayPal env vars not set'), { config: true });
  }
  const res = await fetch(`${base()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status} ${JSON.stringify(data)}`);
  return data.access_token;
}

async function paypal(method, path, body) {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`PayPal ${res.status}`);
    err.paypal = data;
    throw err;
  }
  return data;
}

module.exports = { paypal };
