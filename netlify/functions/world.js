// World registry: public list of Locations and Items, their pictures, and the headmaster's edit actions.
const { getStore, connectLambda } = require('@netlify/blobs');
const { reply, ID, isAdmin, sleep, parseBody, imageReply } = require('./lib/auth');
const { loadAll, pub, worldAdmin } = require('./lib/world');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') return reply(405, { error: 'POST or GET only' });
  let b; try { b = parseBody(event); } catch (e) { return reply(400, { error: 'Bad request' }); }
  try {
    connectLambda(event);
    const store = getStore('gehenna-world');
    if (event.httpMethod === 'GET' && b.img) {
      const e = ID.test(String(b.img)) && await store.get(String(b.img), { type: 'json' });
      return e && e.image ? imageReply(e.image, 86400) : reply(404, { error: 'No image' });
    }
    if (b.action && String(b.action).startsWith('w')) {
      if (!isAdmin(b)) { await sleep(900); return reply(401, { error: 'Wrong Secret ID or Secret Key.' }); }
      const r = await worldAdmin(b, store);
      return r ? reply(r[0], r[1]) : reply(400, { error: 'Unknown action' });
    }
    const all = await loadAll(store);
    all.sort((x, y) => x.name.localeCompare(y.name));
    return reply(200, { entries: all.map(pub) });
  } catch (e) { return reply(502, { error: 'Server error: ' + e.message }); }
};
