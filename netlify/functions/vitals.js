// Live sheet sync + vitals (HP now, EXP, speed, initiative).
// - A player polls with the version (etag) they last saw; the server answers "same" or sends the fresh sheet, so changes the headmaster makes show up within a second or two.
// - The headmaster polls "snap" (one version per soul) to notice any change, then fetches only the souls that changed.
// - "set": headmaster only (HP now and max, EXP, speed, initiative). Players see their sheet but cannot edit it.
const { getStore, connectLambda } = require('@netlify/blobs');
const { reply, N, ID, needUser, parseBody, settle } = require('./lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  let b; try { b = parseBody(event); } catch (e) { return reply(400, { error: 'Bad request' }); }
  try {
    connectLambda(event);
    const u = await needUser(b);
    if (!u) return reply(401, { error: 'Sign in first.' });
    const cs = getStore('gehenna-characters');
    const act = String(b.action || 'get');
    const revOf = async (id) => { try { const m = await cs.getMetadata(id); return (m && m.etag) || ''; } catch (e) { return ''; } };
    const out = (c) => { const x = Object.assign({}, c); delete x.key; return x; };
    const fresh = async (id) => { const c = await cs.get(id, { type: 'json' }); if (c && settle(c)) await cs.setJSON(id, c); return c; };

    if (act === 'snap') {
      if (!u.admin) return reply(403, { error: 'Headmaster only.' });
      const { blobs } = await cs.list(), revs = {};
      blobs.forEach((x) => { revs[x.key] = x.etag || ''; });
      return reply(200, { revs });
    }

    const id = u.admin ? String(b.id || '') : u.id;
    if (!ID.test(id)) return reply(400, { error: 'Bad id' });

    if (act === 'get' || act === 'poll') {
      const rev = await revOf(id);
      if (act === 'poll' && rev && String(b.rev || '') === rev) return reply(200, { same: true, rev });
      const c = await fresh(id);
      if (!c) return reply(404, { error: 'Character not found' });
      return reply(200, { rev: rev || await revOf(id), char: out(c) });
    }

    if (act === 'set') {
      if (!u.admin) return reply(403, { error: 'Only the headmaster can edit a sheet.' });
      const c = await cs.get(id, { type: 'json' });
      if (!c) return reply(404, { error: 'Character not found' });
      if (u.admin) {
        if ('hp' in b) c.hp = N(b.hp, 0, 9999);
        if ('expMax' in b) c.expMax = N(b.expMax, 1, 99999);
        if ('exp' in b) c.exp = N(b.exp, 0, 99999);
        if ('speed' in b) c.speed = N(b.speed, 0, 999);
        if ('initiative' in b) c.initiative = N(b.initiative, -99, 99);
      }
      // Max HP as the sheet shows it: saved HP plus live HP buffs and debuffs.
      const maxHp = Math.max(0, (Number(c.hp) || 0) + (Array.isArray(c.buffs) ? c.buffs : []).reduce((a, x) => a + (x.stat === 'HP' ? Number(x.amt) || 0 : 0), 0));
      if ('hpNow' in b) c.hpNow = N(b.hpNow, 0, 99999);
      if (c.hpNow != null) c.hpNow = Math.min(c.hpNow, maxHp);
      if (c.exp != null) c.exp = Math.min(c.exp, c.expMax || 100);
      await cs.setJSON(id, c);
      return reply(200, { rev: await revOf(id), char: out(c) });
    }
    return reply(400, { error: 'Unknown action' });
  } catch (e) { return reply(502, { error: 'Server error: ' + e.message }); }
};
