// Public registry reader: lists Players / NPCs / Monsters and opens one entry's details.
// Hidden entries never leave the server. Undisclosed NPCs only show their name, unless the player's
// key (optional) belongs to someone the headmaster allowed. Fields outside an entry's template are never sent.
const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const { loadAll, view, canOpen } = require('./lib/registry');
const hash = (k) => crypto.createHash('sha256').update(String(k).trim().toUpperCase()).digest('hex');
const reply = (status, obj) => ({ statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });
const ID = /^[a-f0-9-]{8,40}$/i;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') return reply(405, { error: 'POST or GET only' });
  let b = {};
  try { b = event.httpMethod === 'POST' ? JSON.parse(event.body || '{}') : (event.queryStringParameters || {}); } catch (e) { return reply(400, { error: 'Bad request' }); }
  try {
    connectLambda(event);
    const store = getStore('gehenna-registry');

    // Picture of a public entry (cached by the browser; the v= value changes whenever the entry is saved).
    if (event.httpMethod === 'GET' && b.img) {
      const id = String(b.img);
      const e = ID.test(id) && await store.get(id, { type: 'json' });
      const m = e && e.listed && e.image && (canOpen(e, null).open || !e.hideImage) && /^data:(image\/[a-z]+);base64,(.+)$/.exec(e.image);
      if (!m) return reply(404, { error: 'No image' });
      return { statusCode: 200, isBase64Encoded: true, headers: { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=86400' }, body: m[2] };
    }

    // Optional player key, only used to unlock sealed NPCs.
    let viewerId = null, viewerName = '';
    const key = String(b.key || '').trim();
    if (key) {
      viewerId = key.length >= 10 && key.length <= 40 ? await getStore('gehenna-keys').get(hash(key)) : null;
      if (!viewerId) { await new Promise((r) => setTimeout(r, 900)); return reply(401, { error: 'That key does not open anything.' }); }
      const c = await getStore('gehenna-characters').get(viewerId, { type: 'json' });
      viewerName = (c && c.name) || '';
    }

    const id = String(b.id || '');
    if (!id) {
      const all = (await loadAll(store)).filter((e) => e.listed);
      all.sort((x, y) => x.name.localeCompare(y.name));
      return reply(200, { entries: all.map((e) => view(e, viewerId, false)), viewer: viewerName });
    }
    const e = ID.test(id) && await store.get(id, { type: 'json' });
    if (!e || !e.listed) return reply(404, { error: 'That entry does not exist.' });
    return reply(200, { entry: view(e, viewerId, true) });
  } catch (e) { return reply(502, { error: 'Server error: ' + e.message }); }
};
