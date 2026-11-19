// Hands paid orders to ActiveCampaign for delivery.
// Env (same ones the opt-in popup uses): AC_API_URL, AC_API_KEY
//
// For every order:
//   1. create/update the contact (email, first name, last name)
//   2. add each purchased product's tag   (catalog.json → products[slug].acTag)
//   3. add the store tag LAST, once        (catalog.json → acStoreTag, 1339)
// The confirmation automation triggers on the store tag, so it runs once per
// order and the product tags are already on the contact when it starts.
// The automation removes the store tag at the end so a later purchase re-fires it.

const { catalog } = require('./shop');

async function ac(path, body) {
  const { AC_API_URL, AC_API_KEY } = process.env;
  if (!AC_API_URL || !AC_API_KEY) throw new Error('AC_API_URL / AC_API_KEY not set');
  const res = await fetch(`${AC_API_URL.replace(/\/$/, '')}/api/3/${path}`, {
    method: 'POST',
    headers: { 'Api-Token': AC_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function addTag(contactId, tagId) {
  const r = await ac('contactTags', { contactTag: { contact: String(contactId), tag: String(tagId) } });
  if (!r.ok) throw new Error(`AC tag ${tagId} failed: ${r.status} ${JSON.stringify(r.data)}`);
}

async function deliver(order) {
  const slugs = [...new Set(order.slugs)].filter((s) => catalog.products[s]);
  if (!slugs.length) throw new Error(`No known products in order ${order.orderId}`);
  if (!order.email) throw new Error(`No email on order ${order.orderId}`);

  const contact = await ac('contact/sync', {
    contact: {
      email: order.email,
      firstName: order.firstName || undefined,
      lastName: order.lastName || undefined,
    },
  });
  const contactId = contact.ok && contact.data.contact && contact.data.contact.id;
  if (!contactId) throw new Error(`AC contact/sync failed: ${contact.status} ${JSON.stringify(contact.data)}`);

  for (const slug of slugs) await addTag(contactId, catalog.products[slug].acTag);
  await addTag(contactId, catalog.acStoreTag);

  console.log(`delivered ${order.method} ${order.orderId} → AC contact ${contactId}: ${slugs.join(', ')}`);
  return slugs.length;
}

// "Jane Q Doe" → { first: "Jane", last: "Q Doe" } (fallback only)
function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  return { first: parts.shift() || '', last: parts.join(' ') };
}

module.exports = { deliver, splitName };
