// Dice log: players' rolls are saved as they happen; the headmaster reads everyone's in one go, a player reads their own.
const { getStore, connectLambda } = require('@netlify/blobs');
const { reply, S, needUser, parseBody } = require('./lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  let b; try { b = parseBody(event); } catch (e) { return reply(400, { error: 'Bad request' }); }
  try {
    connectLambda(event);
    const u = await needUser(b); if (!u) return reply(401, { error: 'Sign in first.' });
    const rs = getStore('gehenna-rolls'), cs = getStore('gehenna-characters');
    if (b.action === 'add') {
      if (u.admin) return reply(400, { error: 'Souls only.' });
      const list = (await rs.get(u.id, { type: 'json' })) || [];
      list.unshift({ at: new Date().toISOString(), label: S(b.label, 100), txt: S(b.txt, 200), cls: b.cls === 'nat20' || b.cls === 'nat1' ? b.cls : '' });
      await rs.setJSON(u.id, list.slice(0, 60));
      return reply(200, { ok: true });
    }
    const ids = u.admin ? (await rs.list()).blobs.map((x) => x.key) : [u.id];
    const parts = await Promise.all(ids.map(async (id) => {
      const list = (await rs.get(id, { type: 'json' })) || [], c = u.admin ? await cs.get(id, { type: 'json' }) : null;
      return list.map((x) => Object.assign({ name: c ? c.name : '' }, x));
    }));
    const rolls = [].concat(...parts).sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, 300);
    return reply(200, { rolls });
  } catch (e) { return reply(502, { error: 'Server error: ' + e.message }); }
};
