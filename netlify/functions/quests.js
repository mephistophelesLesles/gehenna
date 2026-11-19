// Quest Board. The headmaster writes quests and pins them on a weekly board (Monday to Sunday, plus Side Quests).
// A soul takes an open quest and picks which souls do it with them. When the headmaster marks it complete, the karma
// reward is split evenly between everyone on the quest (any remainder goes to the soul who took it).
// The headmaster can close the whole board (e.g. during a battle). Souls who are in battle cannot take or drop quests.
const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const { reply, S, N, ID, needUser, parseBody, karmaOf, settle } = require('./lib/auth');

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'side'];
const MAX_QUESTS = 80;
const DEFAULT_LABELS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday', side: 'Side Quests' };
// The headmaster can rename the board's headers. An empty name goes back to the default.
const labelsOf = (l) => { const o = {}; DAYS.forEach((d) => { o[d] = S(l && l[d], 24).trim() || DEFAULT_LABELS[d]; }); return o; };

async function getBoard(store) {
  const b = (await store.get('board', { type: 'json' })) || {};
  return { open: b.open !== false, labels: labelsOf(b.labels), quests: Array.isArray(b.quests) ? b.quests : [] };
}
const saveBoard = (store, b) => store.setJSON('board', { open: b.open !== false, labels: labelsOf(b.labels), quests: b.quests, updatedAt: new Date().toISOString() });

// Only known fields, with limits. Party and status are never taken from the form, only from the actions below.
function cleanQuest(q, old) {
  q = q || {};
  return {
    id: old ? old.id : crypto.randomUUID(),
    title: S(q.title, 80).trim() || 'Untitled quest',
    kind: S(q.kind, 30).trim(),
    desc: S(q.desc, 1500).trim(),
    day: DAYS.includes(q.day) ? q.day : 'side',
    reward: N(q.reward, 0, 100000000),
    maxParty: N(q.maxParty == null ? 4 : q.maxParty, 1, 30) || 1,
    hidden: q.hidden === true,
    status: old ? old.status : 'open',
    party: old ? old.party : [],
    leader: old ? old.leader : '',
    doneAt: old ? old.doneAt : '',
    paid: old ? old.paid : 0,
    order: old ? old.order : Date.now(),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  let b; try { b = parseBody(event); } catch (e) { return reply(400, { error: 'Bad request' }); }
  try {
    connectLambda(event);
    const u = await needUser(b);
    if (!u) return reply(401, { error: 'Sign in first.' });
    const store = getStore('gehenna-quests'), cstore = getStore('gehenna-characters');
    const board = await getBoard(store);
    const act = String(b.action || 'state');
    const money = (n) => Number(n).toLocaleString('en-US');

    const { blobs } = await cstore.list();
    const chars = (await Promise.all(blobs.map((x) => cstore.get(x.key, { type: 'json' }).catch(() => null)))).filter((c) => c && c.id && c.name);
    const byId = {}; chars.forEach((c) => { byId[c.id] = c; });
    const hiddenDoc = await getStore('gehenna-chat').get('hidden', { type: 'json' }).catch(() => null);
    const hidden = new Set((hiddenDoc && hiddenDoc.ids) || []);

    const view = () => {
      const me = u.admin ? null : byId[u.id];
      const quests = board.quests.filter((q) => u.admin || !q.hidden).map((q) => Object.assign({}, q, { party: q.party.filter((id) => byId[id]).map((id) => ({ id, name: byId[id].name })), leaderName: byId[q.leader] ? byId[q.leader].name : '' }));
      return {
        open: board.open, labels: board.labels, battle: !!(me && me.inBattle), me: u.admin ? '' : u.id, admin: !!u.admin,
        // The souls a player may bring along. Souls the headmaster hid from contacts are left out.
        people: chars.filter((c) => u.admin || c.id === u.id || !hidden.has(c.id)).map((c) => ({ id: c.id, name: c.name })).sort((x, y) => x.name.localeCompare(y.name)),
        quests: quests.sort((x, y) => (x.order || 0) - (y.order || 0)),
      };
    };
    const ok = async (message) => reply(200, Object.assign(view(), message ? { message } : {}));

    if (act === 'state') return ok();

    /* ---------------- headmaster ---------------- */
    if (u.admin) {
      if (act === 'setopen') { board.open = !!b.open; await saveBoard(store, board); return ok(board.open ? 'The Quest Board is open. Souls can take quests.' : 'The Quest Board is closed. Souls can still read it, but cannot take or drop quests.'); }
      if (act === 'setlabels') { board.labels = labelsOf(b.labels); await saveBoard(store, board); return ok('Headers renamed.'); }
      if (act === 'save') {
        const inc = b.quest || {}, i = board.quests.findIndex((x) => x.id === String(inc.id || ''));
        if (i < 0 && board.quests.length >= MAX_QUESTS) return reply(400, { error: 'The board is full (' + MAX_QUESTS + ' quests). Delete some first.' });
        const q = cleanQuest(inc, i >= 0 ? board.quests[i] : null);
        // Lowering the party limit below the current party would break it, so keep it at least as large.
        q.maxParty = Math.max(q.maxParty, q.party.length || 1);
        if (i >= 0) board.quests[i] = q; else board.quests.push(q);
        await saveBoard(store, board);
        return reply(200, Object.assign(view(), { message: 'Saved.', saved: q.id }));
      }
      const q = board.quests.find((x) => x.id === String(b.id || ''));
      if (!q) return reply(404, { error: 'That quest no longer exists.' });
      if (act === 'delete') { board.quests = board.quests.filter((x) => x !== q); await saveBoard(store, board); return ok('Deleted.'); }
      if (act === 'reset') { q.status = 'open'; q.party = []; q.leader = ''; q.doneAt = ''; q.paid = 0; await saveBoard(store, board); return ok('“' + q.title + '” is back on the board, open for anyone.'); }
      if (act === 'complete') {
        if (q.status !== 'active') return reply(400, { error: q.status === 'done' ? 'That quest is already complete.' : 'Nobody has taken that quest yet.' });
        const members = q.party.map((id) => byId[id]).filter(Boolean);
        if (!members.length) return reply(400, { error: 'Everyone on that quest is gone. Reset it instead.' });
        const share = Math.floor(q.reward / members.length), rest = q.reward - share * members.length;
        const lead = members.find((m) => m.id === q.leader) || members[0];
        for (const m of members) {
          const gain = share + (m.id === lead.id ? rest : 0);
          if (gain > 0) { m.karma = String(karmaOf(m) + gain); settle(m); await cstore.setJSON(m.id, m); }
        }
        q.status = 'done'; q.doneAt = new Date().toISOString(); q.paid = share;
        await saveBoard(store, board);
        return ok('“' + q.title + '” complete. ' + money(q.reward) + ' karma split between ' + members.map((m) => m.name).join(', ') + ': ' + money(share) + ' each' + (rest ? ' (' + lead.name + ' also gets the leftover ' + rest + ')' : '') + '.');
      }
      return reply(400, { error: 'Unknown action' });
    }

    /* ---------------- souls ---------------- */
    const me = byId[u.id];
    if (!me) return reply(404, { error: 'Character not found.' });
    if (act === 'accept' || act === 'abandon') {
      if (!board.open) return reply(400, { error: 'The Quest Board is closed right now.', closed: true });
      if (me.inBattle) return reply(400, { error: 'You are in battle. You cannot take or drop quests until the headmaster ends the battle.', battle: true });
    }
    const q = board.quests.find((x) => x.id === String(b.id || '') && !x.hidden);
    if (!q) return reply(404, { error: 'That quest is not on the board.' });
    if (act === 'accept') {
      if (q.status !== 'open') return reply(400, { error: q.status === 'done' ? 'That quest has already been completed.' : 'Someone already took that quest.' });
      // You are always on your own quest. Everyone you add must be a real soul you are allowed to see.
      const want = [u.id].concat((Array.isArray(b.party) ? b.party : []).map(String).filter((id) => ID.test(id) && id !== u.id && byId[id] && !hidden.has(id)));
      const party = Array.from(new Set(want));
      if (party.length > q.maxParty) return reply(400, { error: 'This quest takes at most ' + q.maxParty + ' soul' + (q.maxParty === 1 ? '' : 's') + ' (you included).' });
      q.status = 'active'; q.party = party; q.leader = u.id;
      await saveBoard(store, board);
      const per = Math.floor(q.reward / party.length);
      return ok('You took “' + q.title + '” with ' + (party.length - 1 ? party.length - 1 + ' other soul' + (party.length > 2 ? 's' : '') : 'nobody else') + '. The reward is split ' + party.length + ' way' + (party.length > 1 ? 's' : '') + ': about ' + money(per) + ' karma each.');
    }
    if (act === 'abandon') {
      if (q.status !== 'active' || !q.party.includes(u.id)) return reply(400, { error: 'You are not on that quest.' });
      if (q.leader !== u.id) return reply(400, { error: 'Only the soul who took the quest can drop it.' });
      q.status = 'open'; q.party = []; q.leader = '';
      await saveBoard(store, board);
      return ok('You dropped “' + q.title + '”. It is back on the board.');
    }
    return reply(400, { error: 'Unknown action' });
  } catch (e) { return reply(502, { error: 'Server error: ' + e.message }); }
};
