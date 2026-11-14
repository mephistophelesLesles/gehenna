// Giving and trading between souls: send items and/or karma straight to another soul, or make a swap offer they can accept.
// Every move is checked here (what you really have, room in the other inventory) and nothing can go below zero.
const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const { settle, reply, S, N, ID, needUser, karmaOf, parseBody } = require('./lib/auth');

const MAX_OFFERS = 10, OFFER_DAYS = 7;
const norm = (s) => String(s || '').trim().toLowerCase();
const money = (n) => Number(n).toLocaleString('en-US');

// A side of a deal: { name, qty, karma }, with both parts optional.
function side(x) { x = x || {}; const name = S(x.name, 100).trim(); return { name, qty: name ? N(x.qty, 1, 9999) : 0, karma: N(x.karma, 0, 1000000000) }; }
const empty = (s) => !s.name && !s.karma;
const have = (c, name) => { const i = (c.items || []).find((x) => norm(x.name) === norm(name)); return i ? Number(i.qty) || 0 : 0; };
function take(c, name, qty) { const i = c.items.find((x) => norm(x.name) === norm(name)); const d = i.desc; i.qty -= qty; c.items = c.items.filter((x) => x.qty > 0); return d || ''; }
function put(c, name, qty, desc) {
  c.items = Array.isArray(c.items) ? c.items : [];
  const h = c.items.find((x) => norm(x.name) === norm(name));
  if (h) { h.qty = Math.min(9999, (Number(h.qty) || 0) + qty); return true; }
  if (c.items.length >= 100) return false;
  c.items.push({ name, qty, desc: S(desc, 500) }); return true;
}
// Is it possible for this soul to hand over this side right now? Returns an error text, or ''.
function lacks(c, s, who) {
  if (s.name && have(c, s.name) < s.qty) return who + ' do' + (who === 'You' ? '' : 'es') + ' not have ' + s.qty + ' × ' + s.name + '.';
  if (s.karma && karmaOf(c) < s.karma) return who + ' do' + (who === 'You' ? '' : 'es') + ' not have ' + money(s.karma) + ' karma to spare.';
  return '';
}
const text = (s) => [s.name ? s.qty + ' × ' + s.name : '', s.karma ? money(s.karma) + ' karma' : ''].filter(Boolean).join(' and ') || 'nothing';
// Moves side s from a to b. Returns false if b has no room.
function move(a, bb, s) {
  if (s.name) { const real = a.items.find((x) => norm(x.name) === norm(s.name)).name; const d = take(a, s.name, s.qty); if (!put(bb, real, s.qty, d)) return false; }
  if (s.karma) { a.karma = String(karmaOf(a) - s.karma); bb.karma = String(karmaOf(bb) + s.karma); }
  return true;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  let b; try { b = parseBody(event); } catch (e) { return reply(400, { error: 'Bad request' }); }
  try {
    connectLambda(event);
    const u = await needUser(b);
    if (!u) return reply(401, { error: 'Sign in first.' });
    if (u.admin) return reply(400, { error: 'Souls trade with each other. Use Quick tools to move things as the headmaster.' });
    const cs = getStore('gehenna-characters'), ts = getStore('gehenna-trades');
    const me = await cs.get(u.id, { type: 'json' }); if (!me) return reply(404, { error: 'Character not found.' });
    if (settle(me)) await cs.setJSON(me.id, me);
    const act = String(b.action || 'list');

    const { blobs } = await cs.list();
    const chars = (await Promise.all(blobs.map((x) => cs.get(x.key, { type: 'json' }).catch(() => null)))).filter((c) => c && c.id && c.name);
    const nameOf = {}; chars.forEach((c) => { nameOf[c.id] = c.name; });
    const tl = (await ts.list()).blobs, old = Date.now() - OFFER_DAYS * 86400000;
    let offers = (await Promise.all(tl.map((x) => ts.get(x.key, { type: 'json' }).catch(() => null)))).filter(Boolean);
    await Promise.all(offers.filter((t) => t.ts < old || !nameOf[t.from] || !nameOf[t.to]).map((t) => ts.delete(t.id).catch(() => {})));
    offers = offers.filter((t) => t.ts >= old && nameOf[t.from] && nameOf[t.to]).sort((x, y) => y.ts - x.ts);

    const listing = (message) => {
      const row = (t) => ({ id: t.id, from: nameOf[t.from], to: nameOf[t.to], give: t.give, want: t.want, ts: t.ts });
      return reply(200, { message: message || '', karma: karmaOf(me), members: chars.filter((c) => c.id !== u.id).map((c) => ({ id: c.id, name: c.name })).sort((x, y) => x.name.localeCompare(y.name)),
        incoming: offers.filter((t) => t.to === u.id).map(row), outgoing: offers.filter((t) => t.from === u.id).map(row) });
    };
    if (act === 'list') return listing();

    if (act === 'send' || act === 'offer') {
      const to = String(b.to || ''), they = chars.find((c) => c.id === to);
      if (!ID.test(to) || to === u.id || !they) return reply(400, { error: 'Choose who to send it to.' });
      const give = side(b.give), want = act === 'offer' ? side(b.want) : side({});
      if (empty(give)) return reply(400, { error: 'Choose an item or an amount of karma to give.' });
      if (act === 'offer' && empty(want)) return reply(400, { error: 'A trade needs something in return. To give a gift, use Send.' });
      const bad = lacks(me, give, 'You'); if (bad) return reply(400, { error: bad });
      if (act === 'send') {
        const you = await cs.get(to, { type: 'json' });
        if (!move(me, you, give)) return reply(400, { error: they.name + ' has no room for more kinds of item.' });
        await Promise.all([cs.setJSON(me.id, me), cs.setJSON(you.id, you)]);
        return listing('Sent ' + text(give) + ' to ' + they.name + '.');
      }
      if (offers.filter((t) => t.from === u.id).length >= MAX_OFFERS) return reply(400, { error: 'You already have ' + MAX_OFFERS + ' open offers. Cancel one first.' });
      const real = give.name ? me.items.find((x) => norm(x.name) === norm(give.name)).name : '';
      const t = { id: crypto.randomUUID(), from: u.id, to, give: Object.assign(give, give.name ? { name: real } : {}), want, ts: Date.now() };
      await ts.setJSON(t.id, t); offers.unshift(t);
      return listing('Offer sent to ' + they.name + '. Nothing moves until they accept.');
    }

    if (act === 'cancel' || act === 'decline' || act === 'accept') {
      const t = offers.find((x) => x.id === String(b.id || ''));
      if (!t) return reply(404, { error: 'That offer is gone.' });
      if (act === 'cancel') { if (t.from !== u.id) return reply(403, { error: 'That is not your offer.' }); await ts.delete(t.id); offers = offers.filter((x) => x !== t); return listing('Offer cancelled.'); }
      if (t.to !== u.id) return reply(403, { error: 'That offer is not for you.' });
      if (act === 'decline') { await ts.delete(t.id); offers = offers.filter((x) => x !== t); return listing('Offer declined.'); }
      // Accept: both sides are checked again right now, because things may have changed since the offer was made.
      const from = await cs.get(t.from, { type: 'json' }); settle(from);
      let bad = lacks(from, t.give, nameOf[t.from]); if (bad) return reply(400, { error: bad + ' Decline this offer.' });
      bad = lacks(me, t.want, 'You'); if (bad) return reply(400, { error: bad });
      if (!move(from, me, t.give) || !move(me, from, t.want)) return reply(400, { error: 'Not enough room in an inventory (100 kinds of item), so nothing was traded.' });
      await Promise.all([cs.setJSON(me.id, me), cs.setJSON(from.id, from), ts.delete(t.id)]);
      offers = offers.filter((x) => x !== t);
      return listing('Trade done: you got ' + text(t.give) + ' and gave ' + text(t.want) + '.');
    }
    return reply(400, { error: 'Unknown action' });
  } catch (e) { return reply(502, { error: 'Server error: ' + e.message }); }
};
