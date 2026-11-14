// Dice log: players' rolls are saved as they happen; the headmaster reads everyone's in one go, a player reads their own.
// Speed notes: the store reads fresh data (no stale cache), the player's name is saved with each roll so the headmaster's list
// needs no extra lookups, and a tiny "rev" marker lets the page ask "anything new?" with a single cheap read.
const { getStore, connectLambda } = require('@netlify/blobs');
const { reply, S, needUser, parseBody } = require('./lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  let b; try { b = parseBody(event); } catch (e) { return reply(400, { error: 'Bad request' }); }
  try {
    connectLambda(event);
    const u = await needUser(b); if (!u) return reply(401, { error: 'Sign in first.' });
    const rs = getStore({ name: 'gehenna-rolls', consistency: 'strong' }), cs = getStore({ name: 'gehenna-characters', consistency: 'strong' });
    if (b.action === 'add') {
      if (u.admin) return reply(400, { error: 'Souls only.' });
      const [list, c] = await Promise.all([rs.get(u.id, { type: 'json' }), cs.get(u.id, { type: 'json' })]);
      const rows = Array.isArray(list) ? list : [];
      rows.unshift({ at: new Date().toISOString(), name: c && c.name ? S(c.name, 100) : '', label: S(b.label, 100), txt: S(b.txt, 200), cls: b.cls === 'nat20' || b.cls === 'nat1' ? b.cls : '' });
      await rs.setJSON(u.id, rows.slice(0, 60));
      await rs.set('_rev', Date.now() + '-' + Math.random().toString(36).slice(2, 6));
      return reply(200, { ok: true });
    }
    // "Anything new?" check: one tiny read.
    const rev = (await rs.get('_rev')) || '';
    if (b.rev && b.rev === rev) return reply(200, { same: true, rev });

    const ids = u.admin ? (await rs.list()).blobs.map((x) => x.key).filter((k) => k !== '_rev') : [u.id];
    const parts = await Promise.all(ids.map(async (id) => {
      const list = (await rs.get(id, { type: 'json' })) || [];
      // Rolls saved before names were stored: look the name up once for this soul.
      let name = ''; if (u.admin && list.some((x) => !x.name)) { const c = await cs.get(id, { type: 'json' }); name = c ? c.name : ''; }
      return list.map((x) => Object.assign({}, x, { name: x.name || name }));
    }));
    const rolls = [].concat(...parts).sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, 300);
    return reply(200, { rolls, rev });
  } catch (e) { return reply(502, { error: 'Server error: ' + e.message }); }
};
