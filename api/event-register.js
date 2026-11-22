// POST /api/event-register  { event, email, firstName, source }  → { ok }
// Registers someone for a free live event: creates/updates the ActiveCampaign
// contact and applies the event's tags (see api/_lib/events.js).
// source: "optin" (sign-up page) | "live-page" (email gate on the live page) | "email-link"

const events = require('./_lib/events');
const { readBody } = require('./_lib/shop');
const { ac, addTag } = require('./_lib/deliver');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = readBody(req);
  const event = events[String(body.event || '')];
  const email = String(body.email || '').trim().toLowerCase();
  const firstName = String(body.firstName || '').trim().slice(0, 60);
  const source = String(body.source || 'optin');

  if (!event) return res.status(400).json({ error: 'Unknown event.' });
  if (!EMAIL_RE.test(email) || email.length > 200) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  try {
    const contact = await ac('contact/sync', { contact: { email, firstName: firstName || undefined } });
    const contactId = contact.ok && contact.data.contact && contact.data.contact.id;
    if (!contactId) throw new Error(`AC contact/sync ${contact.status} ${JSON.stringify(contact.data)}`);

    const tags = event.tags.concat(source === 'live-page' ? event.livePageTags || [] : []);
    for (const t of tags) await addTag(contactId, t);

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('event-register', body.event, source, err && (err.message || err));
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
