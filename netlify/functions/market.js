// Marketplace with Mammon. Players buy items (karma is worked out automatically and the item lands in their inventory),
// pay down karma debt in amounts they choose, and take loans. The headmaster sets the categories, prices and Mammon's lines.
// Only items that exist in the World registry can be sold.
const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const { settle, reply, S, N, IMG, ID, isAdmin, who, needUser, karmaOf, parseBody, imageReply } = require('./lib/auth');
const { loadAll } = require('./lib/world');
const { addBuffs, label: fxLabel, rollDice, diceName, ST, maxHp, curHp, modFromScore, cures } = require('./lib/fx');
const { loadStatuses } = require('./lib/status');
const { checkUse, applyUse, logRolls, doneMsg } = require('./lib/use');

const LOAN_CAP = 5000;

// ---- Gacha ----
// Rarities from lowest to highest. Rates are in parts per million (1,000,000 = 100%).
const RARITIES = ['common', 'uncommon', 'r', 'sr', 'ssr'];
const RATE = { ssr: 1000, sr: 40000, r: 100000, common: 400000 }; // 0.1%, 4%, 10%, 40%. Uncommon takes whatever is left (45.9%).
const COST = { 1: 300, 10: 2900 };
const PITY_START = 60, PITY_STEP = 20000; // after 60 pulls without an SSR, +2% SSR chance on every pull
const PPM = 1000000;
const rint = (n) => crypto.randomInt(0, n);

// The chance table for one pull. `since` = pulls since the last SSR (kept secret from players).
function rates(since) {
  const bonus = since >= PITY_START ? (since - PITY_START + 1) * PITY_STEP : 0;
  const ssr = Math.min(PPM, RATE.ssr + bonus);
  const k = (PPM - ssr) / (PPM - RATE.ssr); // squeeze everything else to make room for the pity bonus
  const out = { ssr, sr: RATE.sr * k, r: RATE.r * k, common: RATE.common * k };
  out.uncommon = PPM - out.ssr - out.sr - out.r - out.common;
  return out;
}
function rollRarity(t, only) {
  const keys = (only || RARITIES).slice().reverse(); // highest first
  const total = keys.reduce((a, k) => a + t[k], 0);
  let x = rint(Math.max(1, Math.floor(total))), acc = 0;
  for (const k of keys) { acc += t[k]; if (x < acc) return k; }
  return keys[keys.length - 1];
}
// If nothing is stocked at a rarity, hand out the nearest one below it, then the nearest above.
function pickItem(pools, rarity) {
  const i = RARITIES.indexOf(rarity);
  const order = RARITIES.slice(0, i + 1).reverse().concat(RARITIES.slice(i + 1));
  for (const r of order) if (pools[r].length) return { rarity: r, item: pools[r][rint(pools[r].length)] };
  return null;
}
const LINES = [
  'Hello, young soul~ busy?',
  'Ooh, a customer! Come closer, darling. I only bite a little.',
  'Karma talks, sweetie, and yours sounds lovely today.',
  'Window shopping? That is exactly how souls end up in debt~',
  'Take your time. Time is the one thing down here I cannot sell you.',
  'Careful, honey. Everything has a price, and I always remember yours.',
];
const DEFAULT = () => ({
  mammon: { name: 'Mammon', image: '', lines: LINES.slice() },
  cats: ['Soul Marketplace', 'Weapon Marketplace', 'Others'].map((n) => ({ id: crypto.randomUUID(), name: n, items: [] })),
  gacha: { pool: [] },
  updatedAt: new Date().toISOString(),
});
async function getCfg(store) { const c = (await store.get('config', { type: 'json' })) || DEFAULT(); if (!c.gacha || !Array.isArray(c.gacha.pool)) c.gacha = { pool: [] }; return c; }

function cleanCfg(inc, old, worldIds) {
  let image = old.mammon.image || '';
  const m = inc.mammon || {};
  if (m.image === '') image = ''; else if (typeof m.image === 'string' && IMG.test(m.image) && m.image.length < 250000) image = m.image;
  const lines = (Array.isArray(m.lines) ? m.lines : []).map((x) => S(x, 200).trim()).filter(Boolean).slice(0, 30);
  return {
    mammon: { name: S(m.name, 40).trim() || 'Mammon', image, lines: lines.length ? lines : LINES.slice() },
    cats: (Array.isArray(inc.cats) ? inc.cats : []).slice(0, 12).map((c) => ({
      id: ID.test(String(c.id || '')) ? String(c.id) : crypto.randomUUID(),
      name: S(c.name, 40).trim() || 'Category',
      items: (Array.isArray(c.items) ? c.items : []).slice(0, 200).filter((i) => i && worldIds.has(String(i.itemId))).map((i) => { const p = N(i.price, 0, 1000000), s = N(i.sale, 0, 1000000); return { itemId: String(i.itemId), price: p, sale: s > 0 && s < p ? s : 0 }; }),
    })),
    // The gacha pool: only registry items, each with a rarity. Anything else is dropped.
    gacha: { pool: (inc.gacha && Array.isArray(inc.gacha.pool) ? inc.gacha.pool : (old.gacha && old.gacha.pool) || []).slice(0, 300).filter((g) => g && worldIds.has(String(g.itemId)) && RARITIES.includes(g.rarity)).map((g) => ({ itemId: String(g.itemId), rarity: g.rarity })) },
    updatedAt: new Date().toISOString(),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') return reply(405, { error: 'POST or GET only' });
  let b; try { b = parseBody(event); } catch (e) { return reply(400, { error: 'Bad request' }); }
  try {
    connectLambda(event);
    const store = getStore('gehenna-market'), wstore = getStore('gehenna-world'), cstore = getStore('gehenna-characters');
    if (event.httpMethod === 'GET' && b.img) { const cfg = await getCfg(store); return cfg.mammon.image ? imageReply(cfg.mammon.image, 3600) : reply(404, { error: 'No image' }); }
    const u = await needUser(b);
    if (!u) return reply(401, { error: 'Sign in first.' });
    const cfg = await getCfg(store);

    if (b.action === 'saveconfig') {
      if (!u.admin) return reply(403, { error: 'Headmaster only.' });
      const world = await loadAll(wstore);
      const next = cleanCfg(b.config || {}, cfg, new Set(world.map((e) => e.id)));
      await store.setJSON('config', next);
      return reply(200, { ok: true });
    }
    if (b.action === 'getconfig') {
      if (!u.admin) return reply(403, { error: 'Headmaster only.' });
      return reply(200, { config: Object.assign({}, cfg, { mammon: Object.assign({}, cfg.mammon, { image: cfg.mammon.image ? '/.netlify/functions/market?img=1&v=' + Date.parse(cfg.updatedAt) : '' }) }) });
    }

    // Everyone signed in: the shop window.
    const world = await loadAll(wstore), byId = {}; world.forEach((e) => { byId[e.id] = e; });
    let c = null;
    if (!u.admin) { c = await cstore.get(u.id, { type: 'json' }); if (!c) return reply(404, { error: 'Character not found.' }); if (settle(c)) await cstore.setJSON(u.id, c); }
    const view = (c) => ({ battle: !!(c && c.inBattle), karma: c ? karmaOf(c) : 0, debt: c ? c.debt || 0 : 0, tickets: gTickets(c), discount: c && c.discount ? { pct: c.discount.pct, name: c.discount.name } : null });
    // Gacha tickets are World items marked "Gacha ticket". Locked ones do not count.
    const tkOf = (x) => { const e = byName[String(x.name).toLowerCase()]; return e && e.ticket === 'gacha' && !x.locked ? Number(x.qty) || 0 : 0; };
    const gTickets = (c) => (c && Array.isArray(c.items) ? c.items.reduce((a, x) => a + tkOf(x), 0) : 0);
    const spendTickets = (ch, n) => { let need = n; ch.items.forEach((x) => { const t = Math.min(need, tkOf(x)); if (t > 0) { x.qty -= t; need -= t; } }); ch.items = ch.items.filter((x) => x.qty > 0); };
    const byName = {}; world.forEach((e) => { if (e.kind === 'item') byName[e.name.toLowerCase()] = e; });
    const listed = {}; cfg.cats.forEach((k) => k.items.forEach((i) => { if (!listed[i.itemId]) listed[i.itemId] = i; }));
    // Sells back at 90% of the shop price (the sale price while a sale is on, so a sale cannot be farmed), else the registry price.
    const worth = (e) => { const l = listed[e.id]; return Math.floor((l ? l.sale || l.price : e.price) * 0.9); };

    if (!b.action || b.action === 'state') {
      const stocked = (cfg.gacha.pool || []).some((g) => byId[g.itemId]);
      return reply(200, Object.assign(view(c), {
        gacha: { ready: stocked, cost1: COST[1], cost10: COST[10] },
        mammon: { name: cfg.mammon.name, image: cfg.mammon.image ? '/.netlify/functions/market?img=1&v=' + Date.parse(cfg.updatedAt) : '', lines: cfg.mammon.lines },
        cats: cfg.cats.map((k) => ({ id: k.id, name: k.name, items: k.items.filter((i) => byId[i.itemId]).map((i) => { const e = byId[i.itemId]; return { itemId: e.id, name: e.name, desc: e.desc, image: e.image ? '/.netlify/functions/world?img=' + e.id + '&v=' + Date.parse(e.updatedAt || 0) : '', price: i.price, sale: i.sale || 0 }; }) })),
      }));
    }
    if (u.admin) {
      // Headmaster quick tools: no need to open the character.
      if (['hm_karma', 'hm_additem', 'hm_takeitem', 'hm_giveitem', 'hm_lockitem', 'hm_useitem'].includes(b.action)) {
        const getC = async (id) => (ID.test(String(id || '')) ? cstore.get(String(id), { type: 'json' }) : null);
        const a = await getC(b.id); if (!a) return reply(404, { error: 'Character not found.' });
        const sameName = (x, n) => String(x.name).toLowerCase() === n.toLowerCase();
        const name = S(b.name, 100).trim(), qty = N(b.qty, 1, 9999), money = (n) => Number(n).toLocaleString('en-US');
        a.items = Array.isArray(a.items) ? a.items : [];
        if (b.action === 'hm_karma') {
          const amt = Math.round(Number(b.amount) || 0); if (!amt) return reply(400, { error: 'Enter an amount (negative takes karma away).' });
          a.karma = String(karmaOf(a) + amt); settle(a); await cstore.setJSON(a.id, a);
          return reply(200, { message: a.name + ' now has ' + money(karmaOf(a)) + ' karma and ' + money(a.debt || 0) + ' debt.' });
        }
        if (!name) return reply(400, { error: 'Type an item name.' });
        const give = (ch, desc) => { ch.items = Array.isArray(ch.items) ? ch.items : []; const h = ch.items.find((x) => sameName(x, name)); if (h) h.qty = Math.min(9999, (Number(h.qty) || 0) + qty); else ch.items.push({ name, qty, desc: S(desc, 500) }); };
        const room = (ch) => (ch.items || []).some((x) => sameName(x, name)) || (ch.items || []).length < 100;
        const have = a.items.find((x) => sameName(x, name));
        if (b.action === 'hm_additem') {
          if (!room(a)) return reply(400, { error: 'Their inventory is full.' });
          const reg = byName[name.toLowerCase()]; give(a, reg ? reg.desc : b.desc); await cstore.setJSON(a.id, a);
          return reply(200, { message: 'Gave ' + qty + ' x ' + name + ' to ' + a.name + '.' });
        }
        if (!have || have.qty < qty) return reply(400, { error: a.name + ' does not have ' + qty + ' x ' + name + '.' });
        if (b.action === 'hm_useitem') {
          // The headmaster uses the item for them: the same effect and dice as when a soul uses it, but it works during battle and ignores the lock.
          const e = byName[name.toLowerCase()];
          if (!e) return reply(400, { error: name + ' is not in the World registry, so it has no effect to apply.' });
          if (!e.usable) return reply(400, { error: e.name + ' is not marked usable in the World registry.' });
          if (e.ticket === 'discount') return reply(400, { error: 'Discount tickets are used by the soul in the shop.' });
          const chk = checkUse(a, e, have, b.stat);
          if (chk.error) return reply(400, Object.assign({ error: chk.error, needStat: !!chk.needStat }, chk.needStat ? { amt: e.statUp.amt, stats: (e.statUp.stats && e.statUp.stats.length ? e.statUp.stats : ST).map((k) => ({ k, score: Number(((a.stats || {})[k] || {}).score) || 0 })) } : {}));
          const out = applyUse(a, e, have, b.stat); await cstore.setJSON(a.id, a); await logRolls(a, out.rolled);
          return reply(200, { item: e.name, changes: out.changes, message: a.name + ' used ' + e.name + '. ' + out.changes.map((x) => x.text).join('. ') + '.' });
        }
        if (b.action === 'hm_lockitem') { have.locked = !!b.locked; await cstore.setJSON(a.id, a); return reply(200, { message: name + (have.locked ? ' is locked' : ' is unlocked') + ' for ' + a.name + '.' }); }
        if (b.action === 'hm_giveitem') {
          const t = await getC(b.to); if (!t || t.id === a.id) return reply(404, { error: 'Pick a different character to give it to.' });
          if (!room(t)) return reply(400, { error: 'Their inventory is full.' });
          have.qty -= qty; a.items = a.items.filter((x) => x.qty > 0); give(t, have.desc);
          await cstore.setJSON(a.id, a); await cstore.setJSON(t.id, t);
          return reply(200, { message: a.name + ' gave ' + qty + ' x ' + name + ' to ' + t.name + '.' });
        }
        have.qty -= qty; a.items = a.items.filter((x) => x.qty > 0); await cstore.setJSON(a.id, a);
        return reply(200, { message: 'Took ' + qty + ' x ' + name + ' from ' + a.name + '.' });
      }
      return reply(400, { error: 'Only souls can trade.' });
    }

    const save = async () => { await cstore.setJSON(u.id, c); };
    // In battle the Marketplace is closed (the headmaster ends the battle in the Effects tab).
    if (c.inBattle && ['gachapull', 'sell', 'buy', 'paydebt', 'loan'].includes(b.action)) return reply(400, { error: 'You are in battle. The Marketplace is closed until the headmaster ends the battle.', battle: true });
    if (b.action === 'gachapull') {
      const count = Number(b.count) === 10 ? 10 : 1, cost = COST[count], byTicket = b.ticket === true || b.ticket === 'true';
      const pools = {}; RARITIES.forEach((r) => { pools[r] = []; });
      (cfg.gacha.pool || []).forEach((g) => { const e = byId[g.itemId]; if (e) pools[g.rarity].push(e); });
      if (!RARITIES.some((r) => pools[r].length)) return reply(400, { error: 'The machine is empty right now.' });
      const bal = karmaOf(c);
      if (byTicket) { if (gTickets(c) < count) return reply(400, { error: 'You need ' + count + ' gacha ticket' + (count > 1 ? 's' : '') + ' for that. You have ' + gTickets(c) + '.' }); }
      else if (bal < cost) return reply(400, { error: 'Not enough karma. You have ' + bal + ' and it costs ' + cost + '.' });
      const gs = getStore('gehenna-gacha'), st = (await gs.get(u.id, { type: 'json' })) || { since: 0, total: 0 };
      // Roll everything first (nothing is charged yet), so a full inventory cannot eat karma.
      const got = []; let since = st.since || 0, hasSR = false;
      for (let i = 0; i < count; i++) {
        const t = rates(since);
        const forced = count === 10 && i === 9 && !hasSR; // a ten-pull always contains an SR or better
        const hit = pickItem(pools, rollRarity(t, forced ? ['sr', 'ssr'] : null));
        if (!hit) break;
        since = hit.rarity === 'ssr' ? 0 : since + 1;
        if (hit.rarity === 'sr' || hit.rarity === 'ssr') hasSR = true;
        got.push(hit);
      }
      c.items = Array.isArray(c.items) ? c.items : [];
      const fresh = new Set(); got.forEach((g) => { const n = g.item.name.toLowerCase(); if (!c.items.some((x) => String(x.name).toLowerCase() === n)) fresh.add(n); });
      if (c.items.length + fresh.size > 100) return reply(400, { error: 'Your inventory is too full for these. Nothing was charged.' });
      if (byTicket) spendTickets(c, count); else c.karma = String(bal - cost);
      got.forEach((g) => {
        const e = g.item, have = c.items.find((x) => String(x.name).toLowerCase() === e.name.toLowerCase());
        if (have) have.qty = Math.min(9999, (Number(have.qty) || 0) + 1); else c.items.push({ name: e.name, qty: 1, desc: S(e.desc, 500) });
      });
      await save();
      await gs.setJSON(u.id, { since, total: (st.total || 0) + got.length });
      return reply(200, Object.assign(view(c), {
        results: got.map((g) => ({ itemId: g.item.id, name: g.item.name, desc: g.item.desc, rarity: g.rarity, image: g.item.image ? '/.netlify/functions/world?img=' + g.item.id + '&v=' + Date.parse(g.item.updatedAt || 0) : '' })),
        message: byTicket ? 'Used ' + count + ' gacha ticket' + (count > 1 ? 's' : '') + '.' : 'Spent ' + cost + ' karma.',
      }));
    }
    if (b.action === 'myitems') {
      const stl = await loadStatuses(getStore('gehenna-statuses'));
      return reply(200, Object.assign(view(c), { battle: !!c.inBattle, items: (c.items || []).map((x) => { const e = byName[String(x.name).toLowerCase()]; return { name: x.name, qty: x.qty, desc: x.desc || (e && e.desc) || '', usable: !!(e && (e.usable || e.ticket === 'discount')), use: e && e.usable && Array.isArray(e.use) ? e.use.map(fxLabel) : [], dice: e && e.usable && Array.isArray(e.effects) ? e.effects.map(diceName) : [],
        statUp: e && e.usable && e.statUp && e.statUp.mode !== 'none' ? { mode: e.statUp.mode, amt: e.statUp.amt, stats: (e.statUp.stats && e.statUp.stats.length ? e.statUp.stats : ST).map((k) => ({ k, score: Number(((c.stats || {})[k] || {}).score) || 0 })) } : null,
        cures: e && e.usable && e.cleanse ? (e.cleanse.all ? ['every debuff'] : []).concat((e.cleanse.ids || []).map((id) => (stl.find((s2) => s2.id === id) || {}).name).filter(Boolean)) : [], locked: !!x.locked, sellable: !!(e && e.sellable && worth(e) > 0), worth: e ? worth(e) : 0 }; }) }));
    }
    if (b.action === 'use') {
      if (c.inBattle) return reply(400, { error: 'You are in battle, so you cannot use items until the headmaster ends the battle.', battle: true });
      // Using an item applies what the headmaster wrote on it (see the World registry) and removes one from the inventory.
      const n = S(b.name, 100).trim().toLowerCase(), e = byName[n], have = (c.items || []).find((x) => String(x.name).toLowerCase() === n);
      if (!have || !e) return reply(404, { error: 'You do not have that item.' });
      if (e.ticket === 'gacha' && !e.usable) return reply(400, { error: 'Use this ticket at the gacha machine in the Marketplace.' });
      if (!e.usable && e.ticket !== 'discount') return reply(400, { error: 'That item cannot be used.' });
      if (have.locked) return reply(400, { error: e.name + ' is locked. Unlock it first.' });
      if (e.ticket === 'discount') {
        if (c.discount) return reply(400, { error: 'You already have ' + c.discount.pct + '% off waiting. Buy something in the shop first.' });
        have.qty -= 1; c.items = c.items.filter((x) => x.qty > 0);
        c.discount = { pct: e.pct ? N(e.pct, 1, 90) : 30, name: e.name };
        await save();
        return reply(200, Object.assign(view(c), { message: e.name + ' is active: ' + c.discount.pct + '% off your next shop purchase. It does not work on the gacha, and it is used up after one purchase.' }));
      }
      const chk = checkUse(c, e, have, b.stat);
      if (chk.error) return reply(400, { error: chk.error, needStat: !!chk.needStat });
      const out = applyUse(c, e, have, b.stat);
      await save(); await logRolls(c, out.rolled);
      return reply(200, Object.assign(view(c), { item: e.name, changes: out.changes, message: doneMsg(e, out.changes) }));
    }
    if (b.action === 'lock') {
      const n = S(b.name, 100).trim().toLowerCase(), have = (c.items || []).find((x) => String(x.name).toLowerCase() === n);
      if (!have) return reply(404, { error: 'You do not have that item.' });
      have.locked = !!b.locked; await save();
      return reply(200, Object.assign(view(c), { message: have.name + (have.locked ? ' is locked. It cannot be used, sold or traded until you unlock it.' : ' is unlocked.') }));
    }
    if (b.action === 'sell') {
      const n = S(b.name, 100).trim().toLowerCase(), e = byName[n], have = (c.items || []).find((x) => String(x.name).toLowerCase() === n), qty = N(b.qty, 1, 9999);
      if (!have || !e) return reply(404, { error: 'You do not have that item.' });
      if (have.locked) return reply(400, { error: e.name + ' is locked. Unlock it first.' });
      if (!e.sellable || worth(e) < 1) return reply(400, { error: 'That item cannot be sold.' });
      if (have.qty < qty) return reply(400, { error: 'You only have ' + have.qty + '.' });
      const gain = worth(e) * qty; have.qty -= qty; c.items = c.items.filter((x) => x.qty > 0); c.karma = String(karmaOf(c) + gain); await save();
      return reply(200, Object.assign(view(c), { message: 'Sold ' + qty + ' x ' + e.name + ' for ' + gain + ' karma.' }));
    }
    if (b.action === 'buy') {
      const cat = cfg.cats.find((k) => k.id === String(b.catId)), li = cat && cat.items.find((i) => i.itemId === String(b.itemId)), e = li && byId[li.itemId];
      if (!e) return reply(404, { error: 'That item is not for sale.' });
      const bal = karmaOf(c), base = li.sale || li.price, off = c.discount ? N(c.discount.pct, 0, 90) : 0, price = off && base ? Math.max(1, Math.round(base * (100 - off) / 100)) : base;
      if (bal < price) return reply(400, { error: 'Not enough karma. You have ' + bal + ' and it costs ' + price + '.' });
      c.karma = String(bal - price);
      const used = c.discount || null; delete c.discount; // the discount is used up by this purchase
      c.items = Array.isArray(c.items) ? c.items : [];
      const have = c.items.find((x) => String(x.name).toLowerCase() === e.name.toLowerCase());
      if (have) have.qty = Math.min(9999, (Number(have.qty) || 0) + 1); else if (c.items.length < 100) c.items.push({ name: e.name, qty: 1, desc: S(e.desc, 500) });
      await save();
      return reply(200, Object.assign(view(c), { message: 'Bought ' + e.name + ' for ' + price + ' karma.' + (used ? ' (' + used.pct + '% off with ' + used.name + '. The ticket is used up.)' : '') }));
    }
    if (b.action === 'paydebt') {
      const amt = N(b.amount, 0, 1e9), debt = c.debt || 0, bal = karmaOf(c);
      if (amt < 1) return reply(400, { error: 'Enter how much to pay.' });
      if (debt < 1) return reply(400, { error: 'You have no debt.' });
      if (amt > debt) return reply(400, { error: 'You only owe ' + debt + '.' });
      if (amt > bal) return reply(400, { error: 'Cancelled: you only have ' + bal + ' karma.' });
      c.karma = String(bal - amt); c.debt = debt - amt; await save();
      return reply(200, Object.assign(view(c), { message: 'Paid ' + amt + ' karma toward your debt.' }));
    }
    if (b.action === 'loan') {
      const amt = N(b.amount, 0, 1e9), debt = c.debt || 0, bal = karmaOf(c);
      if (amt < 1) return reply(400, { error: 'Enter how much to borrow.' });
      if (debt > 0 || bal < 0) return reply(400, { error: 'No loans while you are in debt.' });
      if (debt + amt > LOAN_CAP) return reply(400, { error: 'Loans are capped at ' + LOAN_CAP.toLocaleString('en-US') + ' karma.' });
      c.karma = String(bal + amt); c.debt = debt + amt; await save();
      return reply(200, Object.assign(view(c), { message: 'Borrowed ' + amt + ' karma. It is added to your debt.' }));
    }
    return reply(400, { error: 'Unknown action' });
  } catch (e) { return reply(502, { error: 'Server error: ' + e.message }); }
};
