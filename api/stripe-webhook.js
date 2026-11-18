// POST /api/stripe-webhook — Stripe calls this when a checkout is paid.
// Set up in Stripe → Developers → Webhooks → Add endpoint:
//   URL:   https://<your-site>/api/stripe-webhook
//   Event: checkout.session.completed
//
// Instead of trusting the request body, we re-fetch the event from Stripe by
// its ID with our secret key, so a forged request can't trigger a delivery.

const { readBody, stripe } = require('./_lib/shop');
const { deliver, splitName } = require('./_lib/deliver');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = readBody(req);
  if (!body.id || !/^evt_[A-Za-z0-9]+$/.test(body.id)) return res.status(400).json({ error: 'Bad event' });

  try {
    const event = await stripe('GET', `/events/${body.id}`);
    if (event.type !== 'checkout.session.completed') return res.status(200).json({ ignored: event.type });

    const session = event.data.object;
    if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
      return res.status(200).json({ ignored: `payment_status ${session.payment_status}` });
    }

    const fields = {};
    (session.custom_fields || []).forEach((f) => { fields[f.key] = f.text && f.text.value; });
    const details = session.customer_details || {};
    const fallback = splitName(details.name);

    const count = await deliver({
      method: 'stripe',
      orderId: session.id,
      email: details.email || session.customer_email,
      firstName: (fields.first_name || fallback.first).trim(),
      lastName: (fields.last_name || fallback.last).trim(),
      slugs: String((session.metadata && session.metadata.items) || '').split(',').filter(Boolean),
      code: session.metadata && session.metadata.promo_code,
    });
    res.status(200).json({ delivered: count });
  } catch (err) {
    // A 500 makes Stripe retry the webhook later (for up to 3 days).
    console.error('stripe-webhook', err && (err.stripe || err.message || err));
    res.status(500).json({ error: 'Delivery failed' });
  }
};
