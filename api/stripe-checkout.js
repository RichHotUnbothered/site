// POST /api/stripe-checkout  { items: [slug...], code? }  → { url }
// Creates a Stripe Checkout Session for the whole cart and returns its URL.
// Env: STRIPE_SECRET_KEY (sk_test_… while testing, sk_live_… to go live)

const { catalog, readBody, siteOrigin, resolveItems, stripe, checkCoupon, sendError } = require('./_lib/shop');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = readBody(req);
  const resolved = resolveItems(body.items);
  if (resolved.error) return res.status(400).json({ error: resolved.error });
  const origin = siteOrigin(req);

  try {
    const params = {
      mode: 'payment',
      success_url: `${origin}/order-complete.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/shop.html?checkout=cancelled`,
      customer_creation: 'always',
      billing_address_collection: 'auto',
      line_items: {},
      // ActiveCampaign gets first + last name separately.
      custom_fields: {
        0: { key: 'first_name', label: { type: 'custom', custom: 'First name' }, type: 'text', text: { maximum_length: 60 } },
        1: { key: 'last_name', label: { type: 'custom', custom: 'Last name' }, type: 'text', text: { maximum_length: 60 } },
      },
      metadata: { items: resolved.items.map((i) => i.slug).join(',').slice(0, 500) },
      payment_intent_data: {
        description: resolved.items.map((i) => i.name).join(', ').slice(0, 500),
        metadata: { items: resolved.items.map((i) => i.slug).join(',').slice(0, 500) },
      },
    };

    resolved.items.forEach((item, n) => {
      params.line_items[n] = {
        quantity: 1,
        price_data: {
          currency: catalog.currency,
          unit_amount: item.unitAmount,
          product_data: {
            name: item.name,
            description: item.type,
            images: { 0: origin + item.image },
            metadata: { slug: item.slug },
          },
        },
      };
    });

    if (body.code) {
      const result = await checkCoupon(body.code, resolved);
      if (!result.ok) return res.status(400).json({ error: result.error });
      const c = result.coupon;
      params.metadata.promo_code = c.code;
      if (c.productLimited) {
        // Stripe would spread a promo code over every line, so for codes limited
        // by slug we apply the exact dollar discount as a one-off coupon.
        const once = await stripe('POST', '/coupons', {
          amount_off: c.discount, currency: catalog.currency, duration: 'once',
          max_redemptions: 1, name: `${c.code} (${c.label})`,
          metadata: { promo_code: c.code },
        });
        params.discounts = { 0: { coupon: once.id } };
      } else {
        params.discounts = { 0: { promotion_code: c.promoId } };
      }
    }
    // Codes are entered only in the site's cart, so Stripe's own
    // "Add promotion code" box stays off.

    const session = await stripe('POST', '/checkout/sessions', params);
    res.status(200).json({ url: session.url });
  } catch (err) {
    sendError(res, err, 'Could not start checkout. Please try again.');
  }
};
