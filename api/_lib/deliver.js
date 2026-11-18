// Sends paid orders to Make (Custom webhook) for delivery.
// One webhook call PER PRODUCT, so each Make run delivers exactly one course.
// Env: MAKE_WEBHOOK_URL  (Make → Webhooks → Custom webhook → copy address)
//
// Payload sent to Make:
//   email, first_name, last_name, product_name, product_slug,
//   order_id, payment_method ("stripe" | "paypal"), price, promo_code
// Stripe can retry a webhook, so in Make dedupe on order_id + product_slug.

const { catalog } = require('./shop');

async function deliver(order) {
  const url = process.env.MAKE_WEBHOOK_URL;
  if (!url) throw new Error('MAKE_WEBHOOK_URL not set');

  const slugs = [...new Set(order.slugs)].filter((s) => catalog.products[s]);
  if (!slugs.length) throw new Error(`No known products in order ${order.orderId}`);

  for (const slug of slugs) {
    const p = catalog.products[slug];
    const payload = {
      email: order.email || '',
      first_name: order.firstName || '',
      last_name: order.lastName || '',
      product_name: p.name,
      product_slug: slug,
      order_id: order.orderId,
      payment_method: order.method,
      price: (p.price / 100).toFixed(2),
      promo_code: order.code || '',
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Make webhook ${res.status} for ${slug} (${order.orderId})`);
  }
  return slugs.length;
}

// "Jane Q Doe" → { first: "Jane", last: "Q Doe" } (fallback only)
function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  return { first: parts.shift() || '', last: parts.join(' ') };
}

module.exports = { deliver, splitName };
