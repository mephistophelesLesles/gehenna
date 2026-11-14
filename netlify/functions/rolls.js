// Dice log: every soul's rolls are saved as they happen and everyone can read them (newest first). The headmaster's rolls for NPCs and
// monsters are saved too but only she sees them. The headmaster can delete one roll, one soul's rolls, old rolls, or everything.
// Speed notes: the store reads fresh data (no stale cache), the player's name is saved with each roll so the list
// needs no extra lookups, and a tiny "rev" marker lets the page ask "anything new?" with a single cheap read.
const { getStore, connectLambda } = require('@netlify/blobs');
const { reply, S, N, ID, needUser, parseBody } = require('./lib/auth');

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
    const bump = () => rw.set('_rev', Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    if (b.action === 'add') {
      // Souls log their own rolls. The headmaster logs hers under the NPC or monster she rolled for (b.as); they are kept under 'hm'.
      const [list, c] = await Promise.all([rs.get(u.id, { type: 'json' }), u.admin ? null : cs.get(u.id, { type: 'json' })]);
      const rows = Array.isArray(list) ? list : [];
      const name = u.admin ? (S(b.as, 100).trim() || 'Headmaster') : (c && c.name ? S(c.name, 100) : '');
      rows.unshift({ at: new Date().toISOString(), name, label: S(b.label, 100), txt: S(b.txt, 200), cls: b.cls === 'nat20' || b.cls === 'nat1' ? b.cls : '' });
      await rw.setJSON(u.id, rows.slice(0, u.admin ? 200 : 60));
      await bump();
      return reply(200, { ok: true });
    }

    if (b.action === 'del' || b.action === 'clear') {
      if (!u.admin) return reply(403, { error: 'Headmaster only.' });
      const keys = (await rs.list()).blobs.map((x) => x.key).filter((k) => k !== '_rev');
      const mode = b.action === 'del' ? 'one' : String(b.mode || '');
      if (!['one', 'all', 'older', 'name'].includes(mode)) return reply(400, { error: 'Unknown clear option.' });
      const cut = mode === 'older' ? new Date(Date.now() - N(b.days, 0, 3650) * 86400000).toISOString() : '';
      let gone = 0;
      for (const k of keys) {
        if (mode === 'one' && k !== String(b.o || '')) continue;
        const list = (await rs.get(k, { type: 'json' })) || [];
        const keep = list.filter((x) => (mode === 'all' ? false : mode === 'one' ? x.at !== String(b.at || '') : mode === 'older' ? x.at >= cut : (x.name || '') !== String(b.name || '')));
        if (keep.length !== list.length) { gone += list.length - keep.length; await rw.setJSON(k, keep); }
      }
      await bump();
      return reply(200, { ok: true, gone });
    }

    // "Anything new?" check: one tiny read.
    const rev = (await rs.get('_rev')) || '';
    if (b.rev && b.rev === rev) return reply(200, { same: true, rev });

    // Everyone sees every soul's rolls. Only the headmaster also gets the NPC/monster rolls (kept under 'hm') and the ids needed to delete.
    const ids = (await rs.list()).blobs.map((x) => x.key).filter((k) => k !== '_rev' && (u.admin || k !== 'hm'));
    const parts = await Promise.all(ids.map(async (id) => {
      const list = (await rs.get(id, { type: 'json' })) || [];
      // Rolls saved before names were stored: look the name up once for this soul.
      let name = ''; if (list.some((x) => !x.name)) { const c = await cs.get(id, { type: 'json' }); name = c ? c.name : ''; }
      return list.map((x) => Object.assign({}, x, { name: x.name || name }, u.admin ? { o: id } : {}));
    }));
    const rolls = [].concat(...parts).sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, 300);
    return reply(200, { rolls, rev });
  } catch (e) { return reply(502, { error: 'Server error: ' + e.message }); }
};
