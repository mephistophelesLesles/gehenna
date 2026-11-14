// Dice log: players' rolls are saved as they happen; the headmaster reads everyone's in one go, a player reads their own.
// Speed notes: the store reads fresh data (no stale cache), the player's name is saved with each roll so the headmaster's list
// needs no extra lookups, and a tiny "rev" marker lets the page ask "anything new?" with a single cheap read.
const { getStore, connectLambda } = require('@netlify/blobs');
const { reply, S, needUser, parseBody } = require('./lib/auth');

// Fresh reads: first through the Netlify API (always up to date, uses the token the admin tool already has), and if that is not
// available here, the normal read. Strong consistency is not supported in this function mode, so it is never requested.
const API = process.env.NETLIFY_TOKEN && (process.env.SITE_ID || process.env.NETLIFY_SITE_ID) ? { siteID: process.env.SITE_ID || process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN } : null;
function reader(name, plain) {
  const fresh = API ? getStore(Object.assign({ name }, API)) : null;
  const run = async (fn) => { if (fresh) { try { return await fn(fresh); } catch (e) { /* fall back */ } } return fn(plain); };
  return { get: (k, o) => run((st) => st.get(k, o)), list: (o) => run((st) => st.list(o)) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  let b; try { b = parseBody(event); } catch (e) { return reply(400, { error: 'Bad request' }); }
  try {
    connectLambda(event);
    const u = await needUser(b); if (!u) return reply(401, { error: 'Sign in first.' });
    const rw = getStore('gehenna-rolls'), rs = reader('gehenna-rolls', rw), cs = reader('gehenna-characters', getStore('gehenna-characters'));
    if (b.action === 'add') {
      // Souls log their own rolls. The headmaster logs hers under the NPC or monster she rolled for (b.as); they are kept under 'hm'.
      const [list, c] = await Promise.all([rs.get(u.id, { type: 'json' }), u.admin ? null : cs.get(u.id, { type: 'json' })]);
      const rows = Array.isArray(list) ? list : [];
      const name = u.admin ? (S(b.as, 100).trim() || 'Headmaster') : (c && c.name ? S(c.name, 100) : '');
      rows.unshift({ at: new Date().toISOString(), name, label: S(b.label, 100), txt: S(b.txt, 200), cls: b.cls === 'nat20' || b.cls === 'nat1' ? b.cls : '' });
      await rw.setJSON(u.id, rows.slice(0, u.admin ? 200 : 60));
      await rw.set('_rev', Date.now() + '-' + Math.random().toString(36).slice(2, 6));
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
