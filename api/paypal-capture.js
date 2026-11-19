// POST /api/paypal-capture  { orderID }  → { ok, status }
// Captures (charges) an approved PayPal order, then tags the buyer in ActiveCampaign for delivery.

const { readBody, sendError } = require('./_lib/shop');
const { paypal } = require('./_lib/paypal');
const { deliver } = require('./_lib/deliver');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { orderID } = readBody(req);
  if (!/^[A-Z0-9]{5,40}$/.test(String(orderID || ''))) {
    return res.status(400).json({ error: 'Invalid order.' });
  }

  let data;
  try {
    data = await paypal('POST', `/v2/checkout/orders/${orderID}/capture`, {});
  } catch (err) {
    const issue = err.paypal && err.paypal.details && err.paypal.details[0] && err.paypal.details[0].issue;
    if (issue === 'INSTRUMENT_DECLINED') {
      // Lets the PayPal popup ask the buyer for a different funding source.
      return res.status(402).json({ ok: false, status: 'INSTRUMENT_DECLINED' });
    }
    if (err.paypal) console.error('paypal-capture', JSON.stringify(err.paypal));
    return sendError(res, err, 'Payment could not be completed. Please try again.');
  }

  if (data.status !== 'COMPLETED') return res.status(402).json({ ok: false, status: data.status });

  // Paid. Tag the buyer in ActiveCampaign. The customer is charged either way, so a delivery
  // failure is logged loudly (Vercel → Logs) rather than shown as a payment error.
  try {
    const order = await paypal('GET', `/v2/checkout/orders/${orderID}`);
    const unit = (order.purchase_units || [])[0] || {};
    const payer = order.payer || data.payer || {};
    const custom = String(unit.custom_id || '');
    const code = (custom.match(/^code:([^;]*);/) || [])[1] || '';
    await deliver({
      method: 'paypal',
      orderId: orderID,
      email: payer.email_address,
      firstName: payer.name && payer.name.given_name,
      lastName: payer.name && payer.name.surname,
      slugs: (unit.items || []).map((i) => i.sku),
      code,
    });
  } catch (err) {
    console.error('DELIVERY FAILED for PayPal order', orderID, '— deliver manually.', err && (err.paypal || err.message || err));
  }

  res.status(200).json({ ok: true, status: data.status });
};
