// Shared helpers for the cart / checkout functions.
// Files under api/_lib are not exposed as endpoints (Vercel skips "_" paths).
//
// Prices come ONLY from site/assets/catalog.json on the server — whatever the
// browser sends is treated as a list of product slugs, nothing more.
//
// Coupons are managed in the Stripe dashboard (Products → Coupons → add a
// promotion code). The same codes are honoured for PayPal orders: we look the
// code up in Stripe and apply the discount to the PayPal total ourselves.

const catalog = require('../../assets/catalog.json');

const STRIPE_API = 'https://api.stripe.com/v1';
// Pinned so the promotion-code response shape stays stable.
const STRIPE_VERSION = '2024-06-20';

function readBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  return body || {};
}

function siteOrigin(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.trim().replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

// Digital products: each slug at most once, quantity always 1.
function resolveItems(slugs) {
  if (!Array.isArray(slugs)) return { error: 'Your cart is empty.' };
  const seen = new Set();
  const items = [];
  for (const raw of slugs.slice(0, 50)) {
    const slug = String(raw);
    const p = catalog.products[slug];
    if (!p || seen.has(slug)) continue;
    seen.add(slug);
    items.push({ slug, name: p.name, type: p.type, unitAmount: p.price, image: p.image });
  }
  if (!items.length) return { error: 'Your cart is empty.' };
  const subtotal = items.reduce((n, i) => n + i.unitAmount, 0);
  return { items, subtotal };
}

// --- Stripe (plain fetch, no SDK dependency) ---------------------------------

function formEncode(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') formEncode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.join('&');
}

async function stripe(method, path, params) {
  // Pasted keys can carry stray tabs/newlines or be pasted twice: use the first token.
  const key = (process.env.STRIPE_SECRET_KEY || '').trim().split(/\s+/)[0];
  if (key.includes('...')) throw Object.assign(new Error('STRIPE_SECRET_KEY is the masked preview, not the full key'), { config: true });
  if (!key) throw Object.assign(new Error('STRIPE_SECRET_KEY not set'), { config: true });
  const url = `${STRIPE_API}${path}${method === 'GET' && params ? `?${formEncode(params)}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Stripe-Version': STRIPE_VERSION,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'GET' ? undefined : formEncode(params || {}),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error((data.error && data.error.message) || `Stripe ${res.status}`);
    err.stripe = data.error;
    throw err;
  }
  return data;
}

// Looks a code up in Stripe and works out the discount for this cart.
// Returns { ok:true, coupon } or { ok:false, error }.
async function checkCoupon(code, resolved) {
  const clean = String(code || '').trim();
  if (!clean) return { ok: false, error: 'Enter a code.' };
  if (clean.length > 64) return { ok: false, error: 'That code isn’t valid.' };

  const list = await stripe('GET', '/promotion_codes', {
    code: clean, active: 'true', limit: 1, expand: { 0: 'data.coupon' },
  });
  const promo = list.data && list.data[0];
  const coupon = promo && promo.coupon;
  const now = Math.floor(Date.now() / 1000);
  if (!promo || !coupon || !coupon.valid ||
      (promo.expires_at && promo.expires_at < now) ||
      (promo.max_redemptions && promo.times_redeemed >= promo.max_redemptions)) {
    return { ok: false, error: 'That code isn’t valid or has expired.' };
  }

  const r = promo.restrictions || {};
  if (r.minimum_amount && resolved.subtotal < r.minimum_amount) {
    return { ok: false, error: `This code needs an order of $${(r.minimum_amount / 100).toFixed(0)} or more.` };
  }

  // Product-limited coupons ("Applies to" in Stripe) are matched by slug: put
  // the product slugs, comma-separated, in the coupon's metadata as `products`.
  let eligible = resolved.subtotal;
  const only = coupon.metadata && coupon.metadata.products;
  if (only) {
    const allowed = new Set(only.split(',').map((s) => s.trim()).filter(Boolean));
    eligible = resolved.items.filter((i) => allowed.has(i.slug)).reduce((n, i) => n + i.unitAmount, 0);
    if (!eligible) return { ok: false, error: 'This code doesn’t apply to the items in your cart.' };
  }

  let discount = 0;
  let label;
  if (coupon.percent_off) {
    discount = Math.round(eligible * coupon.percent_off / 100);
    label = `${+coupon.percent_off}% off`;
  } else if (coupon.amount_off && (!coupon.currency || coupon.currency === catalog.currency)) {
    discount = Math.min(coupon.amount_off, eligible);
    label = `$${(coupon.amount_off / 100).toFixed(coupon.amount_off % 100 ? 2 : 0)} off`;
  } else {
    return { ok: false, error: 'That code isn’t valid.' };
  }
  discount = Math.min(discount, resolved.subtotal);

  return {
    ok: true,
    coupon: {
      code: promo.code, promoId: promo.id, couponId: coupon.id,
      label, discount, productLimited: !!only, eligibleSlugs: only || '',
    },
  };
}

function sendError(res, err, fallback) {
  console.error(fallback, err && (err.stripe || err.message || err));
  if (err && err.config) {
    res.status(503).json({ error: 'Checkout isn’t connected yet.' });
  } else {
    res.status(500).json({ error: fallback });
  }
}

module.exports = { catalog, readBody, siteOrigin, resolveItems, stripe, checkCoupon, sendError };
