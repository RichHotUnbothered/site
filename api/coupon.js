// POST /api/coupon  { code, items: [slug...] }
// → { ok, code, label, discount, subtotal, total } or { ok:false, error }

const { readBody, resolveItems, checkCoupon, sendError } = require('./_lib/shop');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = readBody(req);
  const resolved = resolveItems(body.items);
  if (resolved.error) return res.status(400).json({ ok: false, error: resolved.error });

  try {
    const result = await checkCoupon(body.code, resolved);
    if (!result.ok) return res.status(200).json(result);
    const c = result.coupon;
    res.status(200).json({
      ok: true,
      code: c.code,
      label: c.label,
      discount: c.discount,
      subtotal: resolved.subtotal,
      total: resolved.subtotal - c.discount,
    });
  } catch (err) {
    sendError(res, err, 'Could not check that code. Please try again.');
  }
};
