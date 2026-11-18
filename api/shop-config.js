// GET /api/shop-config → public settings the cart needs in the browser.
// The PayPal client ID is public by design; secrets never leave the server.

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json({
    stripe: !!process.env.STRIPE_SECRET_KEY,
    paypalClientId: (process.env.PAYPAL_CLIENT_SECRET && process.env.PAYPAL_CLIENT_ID) || null,
  });
};
