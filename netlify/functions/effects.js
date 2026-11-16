// Effects tab (headmaster only): put a skill's buff or debuff on souls, see who has what, and end it when the fight is over.
// Permanent effects stay until removed; temporary ones stay until the headmaster ends them here.
const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const { reply, S, ID, needUser, parseBody } = require('./lib/auth');
const { cleanFx, addBuffs } = require('./lib/fx');
const { loadStatuses, cleanStatuses } = require('./lib/status');
const { loadAll } = require('./lib/world');
const { checkUse, applyUse, logRolls, doneMsg, qStore, getQ } = require('./lib/use');

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
    const view = (chars) => ({ chars: chars.sort((x, y) => x.name.localeCompare(y.name)).map((c) => ({ id: c.id, name: c.name, inBattle: !!c.inBattle, buffs: Array.isArray(c.buffs) ? c.buffs : [], skills: (Array.isArray(c.skills) ? c.skills : []).map((s) => ({ label: s.label, name: s.name, buffs: Array.isArray(s.buffs) ? s.buffs : [] })) })) });
    const act = String(b.action || 'list');
    const ss = getStore('gehenna-statuses');
    const withStatuses = async (v, extra) => Object.assign(v, { statuses: await loadStatuses(ss), requests: (await getQ(qStore())).filter((r) => r.status === 'pending') }, extra || {});

    if (act === 'list') return reply(200, await withStatuses(view(await all())));
    // The fixed-effects library: poison, stun, corruption and whatever else the headmaster adds.
    if (act === 'ssave') {
      const lib = await loadStatuses(ss), inc = cleanStatuses([b.status])[0];
      if (!inc) return reply(400, { error: 'Give the fixed effect a name.' });
      const i = lib.findIndex((x) => x.id === inc.id);
      if (i >= 0) lib[i] = inc; else lib.push(inc);
      await ss.setJSON('list', lib.slice(0, 60));
      return reply(200, await withStatuses(view(await all()), { message: inc.name + ' saved.' }));
    }
    if (act === 'sdelete') {
      const lib = (await loadStatuses(ss)).filter((x) => x.id !== String(b.id || ''));
      await ss.setJSON('list', lib);
      return reply(200, await withStatuses(view(await all()), { message: 'Fixed effect deleted. Souls already carrying it keep it until you end it.' }));
    }
    // Battle: while a soul is in battle, every item they use waits for the headmaster to allow it.
    if (act === 'battle') {
      const ids = (Array.isArray(b.targets) ? b.targets : []).map(String).filter((i) => ID.test(i)).slice(0, 60), on = !!b.on;
      for (const id of ids) { const c = await cs.get(id, { type: 'json' }); if (!c) continue; if (on) c.inBattle = true; else delete c.inBattle; await cs.setJSON(id, c); }
      return reply(200, await withStatuses(view(await all()), { message: on ? 'In battle: their items now need your approval.' : 'Battle over for them: they can use items freely again.' }));
    }
    if (act === 'allow' || act === 'deny') {
      const qs = qStore(), q = await getQ(qs), r = q.find((x) => x.id === String(b.rid || '') && x.status === 'pending');
      if (!r) return reply(404, { error: 'That request is gone.' });
      if (act === 'deny') { r.status = 'denied'; r.message = 'The headmaster did not allow it. ' + r.item + ' was not used.'; await qs.setJSON('q', q); return reply(200, await withStatuses(view(await all()), { message: 'Denied. Nothing was used up.' })); }
      // Allow: run the same checks and effect as a normal use, on the soul's current sheet.
      const c = await cs.get(r.charId, { type: 'json' }), world = await loadAll(getStore('gehenna-world'));
      const e = world.find((x) => x.kind === 'item' && String(x.name).toLowerCase() === String(r.item).toLowerCase());
      const have = c && (c.items || []).find((x) => String(x.name).toLowerCase() === String(r.item).toLowerCase() && !x.locked);
      const chk = c && e ? checkUse(c, e, have, r.stat) : { error: 'The soul or the item no longer exists.' };
      if (chk.error) { r.status = 'denied'; r.message = chk.error; await qs.setJSON('q', q); return reply(200, await withStatuses(view(await all()), { message: 'Could not allow it: ' + chk.error, error: true })); }
      const out = applyUse(c, e, have, r.stat);
      await cs.setJSON(c.id, c); await logRolls(c, out.rolled);
      r.status = 'allowed'; r.changes = out.changes; r.message = doneMsg(e, out.changes); await qs.setJSON('q', q);
      return reply(200, await withStatuses(view(await all()), { message: 'Allowed: ' + c.name + ' used ' + e.name + '. ' + out.changes.map((x) => x.text).join('. ') + '.' }));
    }
    if (act === 'apply') {
      let fx = cleanFx(b.fx), source = S(b.source, 100).trim() || 'Effect', statusId = '';
      const ids = (Array.isArray(b.targets) ? b.targets : []).map(String).filter((i) => ID.test(i)).slice(0, 60);
      if (b.statusId) {
        // A fixed effect: the library decides the name and the changes. Souls carry it tagged, so items can cure it by name.
        const st = (await loadStatuses(ss)).find((x) => x.id === String(b.statusId));
        if (!st) return reply(404, { error: 'That fixed effect no longer exists.' });
        statusId = st.id; source = st.name;
        fx = st.fx.length ? st.fx.map((e) => Object.assign({}, e, { kind: e.kind || st.kind })) : [{ kind: st.kind, stat: 'Other', amt: 0, perm: false, note: st.name + (st.desc ? ': ' + st.desc : '') }];
      }
      if (!fx.length) return reply(400, { error: 'There is nothing to apply. Add an effect with an amount first.' });
      if (!ids.length) return reply(400, { error: 'Choose at least one soul.' });
      const group = crypto.randomUUID();
      let hit = 0;
      for (const id of ids) {
        const c = await cs.get(id, { type: 'json' }); if (!c) continue;
        if (addBuffs(c, source, fx, group, { status: statusId })) { await cs.setJSON(id, c); hit++; }
      }
      if (!hit) return reply(404, { error: 'Those souls could not be found, or are carrying too many effects.' });
      return reply(200, await withStatuses(view(await all()), { message: source + ' applied to ' + hit + ' soul' + (hit === 1 ? '' : 's') + '.' }));
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
      return reply(200, await withStatuses(view(await all()), { message: n ? 'Ended.' : 'Nothing to end.' }));
    }
    return reply(400, { error: 'Unknown action' });
  } catch (e) { return reply(502, { error: 'Server error: ' + e.message }); }
};
