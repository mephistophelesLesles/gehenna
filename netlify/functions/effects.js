// Effects tab (headmaster only): put a skill's buff or debuff on souls, see who has what, and end it when the fight is over.
// Permanent effects stay until removed; temporary ones stay until the headmaster ends them here.
const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const { reply, S, ID, needUser, parseBody } = require('./lib/auth');
const { cleanFx, addBuffs } = require('./lib/fx');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  let b; try { b = parseBody(event); } catch (e) { return reply(400, { error: 'Bad request' }); }
  try {
    connectLambda(event);
    const u = await needUser(b);
    if (!u) return reply(401, { error: 'Sign in first.' });
    if (!u.admin) return reply(403, { error: 'Headmaster only.' });
    const cs = getStore('gehenna-characters');
    const all = async () => {
      const { blobs } = await cs.list();
      return (await Promise.all(blobs.map((x) => cs.get(x.key, { type: 'json' }).catch(() => null)))).filter((c) => c && c.id && c.name);
    };
    const view = (chars) => ({ chars: chars.sort((x, y) => x.name.localeCompare(y.name)).map((c) => ({ id: c.id, name: c.name, buffs: Array.isArray(c.buffs) ? c.buffs : [], skills: (Array.isArray(c.skills) ? c.skills : []).map((s) => ({ label: s.label, name: s.name, buffs: Array.isArray(s.buffs) ? s.buffs : [] })) })) });
    const act = String(b.action || 'list');

    if (act === 'list') return reply(200, view(await all()));
    if (act === 'apply') {
      const fx = cleanFx(b.fx), ids = (Array.isArray(b.targets) ? b.targets : []).map(String).filter((i) => ID.test(i)).slice(0, 60);
      if (!fx.length) return reply(400, { error: 'There is nothing to apply. Add an effect with an amount first.' });
      if (!ids.length) return reply(400, { error: 'Choose at least one soul.' });
      const group = crypto.randomUUID(), source = S(b.source, 100).trim() || 'Effect';
      let hit = 0;
      for (const id of ids) {
        const c = await cs.get(id, { type: 'json' }); if (!c) continue;
        if (addBuffs(c, source, fx, group)) { await cs.setJSON(id, c); hit++; }
      }
      if (!hit) return reply(404, { error: 'Those souls could not be found, or are carrying too many effects.' });
      return Object.assign(reply(200, Object.assign(view(await all()), { message: source + ' applied to ' + hit + ' soul' + (hit === 1 ? '' : 's') + '.' })));
    }
    if (act === 'end') {
      // End one whole effect (every soul it was put on) by its group, or one single entry on one soul.
      const group = S(b.group, 80), bid = S(b.bid, 80), only = String(b.id || '');
      if (!group && !(bid && ID.test(only))) return reply(400, { error: 'Nothing chosen to end.' });
      let n = 0;
      for (const c of (group ? await all() : [await cs.get(only, { type: 'json' })].filter(Boolean))) {
        const before = (c.buffs || []).length;
        c.buffs = (c.buffs || []).filter((x) => (group ? x.group !== group : x.id !== bid));
        if (c.buffs.length !== before) { n += before - c.buffs.length; await cs.setJSON(c.id, c); }
      }
      return reply(200, Object.assign(view(await all()), { message: n ? 'Ended.' : 'Nothing to end.' }));
    }
    return reply(400, { error: 'Unknown action' });
  } catch (e) { return reply(502, { error: 'Server error: ' + e.message }); }
};
