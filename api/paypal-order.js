// POST /api/paypal-order  { items: [slug...], code? }  → { id }
// Creates a PayPal order for the whole cart (discount from a Stripe promo code
// is applied here so the same codes work for both payment methods).

const { catalog, readBody, resolveItems, checkCoupon, sendError } = require('./_lib/shop');
const { paypal } = require('./_lib/paypal');

const money = (cents) => (cents / 100).toFixed(2);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = readBody(req);
  const resolved = resolveItems(body.items);
  if (resolved.error) return res.status(400).json({ error: resolved.error });

  try {
    let discount = 0;
    let code = '';
    if (body.code) {
      const result = await checkCoupon(body.code, resolved);
      if (!result.ok) return res.status(400).json({ error: result.error });
      discount = result.coupon.discount;
      code = result.coupon.code;
    }
    const total = resolved.subtotal - discount;
    if (total < 100) {
      return res.status(400).json({ error: 'For this code, please use the card checkout button.' });
    }

    const currency = catalog.currency.toUpperCase();
    const order = await paypal('POST', '/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{
        description: resolved.items.map((i) => i.name).join(', ').slice(0, 127),
        custom_id: (code ? `code:${code};` : '') + resolved.items.map((i) => i.slug).join(',').slice(0, 120),
        amount: {
          currency_code: currency,
          value: money(total),
          breakdown: {
            item_total: { currency_code: currency, value: money(resolved.subtotal) },
            discount: { currency_code: currency, value: money(discount) },
          },
        },
        items: resolved.items.map((i) => ({
          name: i.name.slice(0, 127),
          sku: i.slug,
          category: 'DIGITAL_GOODS',
          quantity: '1',
          unit_amount: { currency_code: currency, value: money(i.unitAmount) },
        })),
      }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'Rich, Hot & Unbothered',
            shipping_preference: 'NO_SHIPPING',
            user_action: 'PAY_NOW',
          },
        },
      },
    });
    res.status(200).json({ id: order.id });
  } catch (err) {
    if (err.paypal) console.error('paypal-order', JSON.stringify(err.paypal));
    sendError(res, err, 'Could not start PayPal checkout. Please try again.');
  }
};
