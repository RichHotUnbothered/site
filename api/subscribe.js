// Serverless function: proxies opt-in popup submissions to ActiveCampaign.
//
// Runs server-side only (Vercel Node.js function) so the AC API key never
// reaches the browser. Configure these in Vercel → Project Settings →
// Environment Variables (and in a local, gitignored .env for `vercel dev`):
//   AC_API_URL   e.g. https://youraccountname.api-us1.com
//   AC_API_KEY   Settings → Developer in ActiveCampaign
//   AC_LIST_ID   numeric ID of the list new signups should join
//   AC_TAG_ID    optional — numeric ID of a tag to apply (leave unset to skip)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { AC_API_URL, AC_API_KEY, AC_LIST_ID, AC_TAG_ID } = process.env;
  if (!AC_API_URL || !AC_API_KEY || !AC_LIST_ID) {
    console.error('subscribe: missing AC_API_URL / AC_API_KEY / AC_LIST_ID env vars');
    res.status(500).json({ error: 'Server not configured' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const email = (body && body.email || '').trim();
  const firstName = (body && body.firstName || '').trim();

  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }

  const acHeaders = {
    'Api-Token': AC_API_KEY,
    'Content-Type': 'application/json',
  };

  try {
    // 1. Create (or update, if it already exists) the contact.
    const contactRes = await fetch(`${AC_API_URL}/api/3/contact/sync`, {
      method: 'POST',
      headers: acHeaders,
      body: JSON.stringify({
        contact: {
          email,
          firstName: firstName || undefined,
        },
      }),
    });
    const contactData = await contactRes.json();
    if (!contactRes.ok) {
      console.error('AC contact/sync failed:', contactRes.status, contactData);
      res.status(502).json({ error: 'Could not save your info. Please try again.' });
      return;
    }
    const contactId = contactData.contact && contactData.contact.id;

    // 2. Add the contact to the configured list (status 1 = subscribed).
    const listRes = await fetch(`${AC_API_URL}/api/3/contactLists`, {
      method: 'POST',
      headers: acHeaders,
      body: JSON.stringify({
        contactList: {
          list: AC_LIST_ID,
          contact: contactId,
          status: 1,
        },
      }),
    });
    if (!listRes.ok) {
      const listErr = await listRes.json().catch(() => ({}));
      console.error('AC contactLists failed:', listRes.status, listErr);
      res.status(502).json({ error: 'Could not add you to the list. Please try again.' });
      return;
    }

    // 3. Optional: apply a tag so these signups are segmentable.
    if (AC_TAG_ID) {
      const tagRes = await fetch(`${AC_API_URL}/api/3/contactTags`, {
        method: 'POST',
        headers: acHeaders,
        body: JSON.stringify({
          contactTag: { contact: contactId, tag: AC_TAG_ID },
        }),
      });
      if (!tagRes.ok) {
        // Non-fatal — the contact is already on the list; just log it.
        const tagErr = await tagRes.json().catch(() => ({}));
        console.error('AC contactTags failed (non-fatal):', tagRes.status, tagErr);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('subscribe: unexpected error', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
