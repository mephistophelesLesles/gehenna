// Player login: a key opens that player's saved character (read-only).
const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const hash = k => crypto.createHash('sha256').update(String(k).trim().toUpperCase()).digest('hex');
const reply = (status, obj) => ({ statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch (e) { return reply(400, { error: 'Bad request' }); }
  const key = String(b.key || '').trim();
  try {
    connectLambda(event);
    const id = key.length >= 10 && key.length <= 40 ? await getStore('gehenna-keys').get(hash(key)) : null;
    const c = id && await getStore('gehenna-characters').get(id, { type: 'json' });
    if (!c) { await new Promise(r => setTimeout(r, 900)); return reply(401, { error: 'That key does not open anything.' }); }
    delete c.key;
    return reply(200, { char: c });
  } catch (e) { return reply(502, { error: 'Server error: ' + e.message }); }
};
