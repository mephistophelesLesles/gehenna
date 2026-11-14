// Marketplace with Mammon. Players buy items (karma is worked out automatically and the item lands in their inventory),
// pay down karma debt in amounts they choose, and take loans. The headmaster sets the categories, prices and Mammon's lines.
// Only items that exist in the World registry can be sold.
const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const { settle, reply, S, N, IMG, ID, isAdmin, who, needUser, karmaOf, parseBody, imageReply } = require('./lib/auth');
const { loadAll } = require('./lib/world');
const { addBuffs, label: fxLabel } = require('./lib/fx');

const LOAN_CAP = 5000;
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
  updatedAt: new Date().toISOString(),
});
async function getCfg(store) { return (await store.get('config', { type: 'json' })) || DEFAULT(); }

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
    const view = (c) => ({ karma: c ? karmaOf(c) : 0, debt: c ? c.debt || 0 : 0 });
    const byName = {}; world.forEach((e) => { if (e.kind === 'item') byName[e.name.toLowerCase()] = e; });
    const listed = {}; cfg.cats.forEach((k) => k.items.forEach((i) => { if (!listed[i.itemId]) listed[i.itemId] = i; }));
    // Sells back at 90% of the shop price (the sale price while a sale is on, so a sale cannot be farmed), else the registry price.
    const worth = (e) => { const l = listed[e.id]; return Math.floor((l ? l.sale || l.price : e.price) * 0.9); };

    if (!b.action || b.action === 'state') {
      return reply(200, Object.assign(view(c), {
        mammon: { name: cfg.mammon.name, image: cfg.mammon.image ? '/.netlify/functions/market?img=1&v=' + Date.parse(cfg.updatedAt) : '', lines: cfg.mammon.lines },
        cats: cfg.cats.map((k) => ({ id: k.id, name: k.name, items: k.items.filter((i) => byId[i.itemId]).map((i) => { const e = byId[i.itemId]; return { itemId: e.id, name: e.name, desc: e.desc, image: e.image ? '/.netlify/functions/world?img=' + e.id + '&v=' + Date.parse(e.updatedAt || 0) : '', price: i.price, sale: i.sale || 0 }; }) })),
      }));
    }
    if (u.admin) {
      // Headmaster quick tools: no need to open the character.
      if (['hm_karma', 'hm_additem', 'hm_takeitem', 'hm_giveitem'].includes(b.action)) {
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
    if (b.action === 'myitems') {
      return reply(200, Object.assign(view(c), { items: (c.items || []).map((x) => { const e = byName[String(x.name).toLowerCase()]; return { name: x.name, qty: x.qty, desc: x.desc || (e && e.desc) || '', usable: !!(e && e.usable), use: e && e.usable && Array.isArray(e.use) ? e.use.map(fxLabel) : [], sellable: !!(e && e.sellable && worth(e) > 0), worth: e ? worth(e) : 0 }; }) }));
    }
    if (b.action === 'use') {
      // Using an item applies what the headmaster wrote on it (see the World registry) and removes one from the inventory.
      const n = S(b.name, 100).trim().toLowerCase(), e = byName[n], have = (c.items || []).find((x) => String(x.name).toLowerCase() === n);
      if (!have || !e) return reply(404, { error: 'You do not have that item.' });
      if (!e.usable) return reply(400, { error: 'That item cannot be used.' });
      const fx = Array.isArray(e.use) ? e.use : [];
      have.qty -= 1; c.items = c.items.filter((x) => x.qty > 0);
      const added = fx.length ? addBuffs(c, e.name, fx, crypto.randomUUID()) : 0;
      await save();
      return reply(200, Object.assign(view(c), { message: 'You used ' + e.name + '.' + (added ? ' ' + fx.map(fxLabel).join(', ') + '.' : '') }));
    }
    if (b.action === 'sell') {
      const n = S(b.name, 100).trim().toLowerCase(), e = byName[n], have = (c.items || []).find((x) => String(x.name).toLowerCase() === n), qty = N(b.qty, 1, 9999);
      if (!have || !e) return reply(404, { error: 'You do not have that item.' });
      if (!e.sellable || worth(e) < 1) return reply(400, { error: 'That item cannot be sold.' });
      if (have.qty < qty) return reply(400, { error: 'You only have ' + have.qty + '.' });
      const gain = worth(e) * qty; have.qty -= qty; c.items = c.items.filter((x) => x.qty > 0); c.karma = String(karmaOf(c) + gain); await save();
      return reply(200, Object.assign(view(c), { message: 'Sold ' + qty + ' x ' + e.name + ' for ' + gain + ' karma.' }));
    }
    if (b.action === 'buy') {
      const cat = cfg.cats.find((k) => k.id === String(b.catId)), li = cat && cat.items.find((i) => i.itemId === String(b.itemId)), e = li && byId[li.itemId];
      if (!e) return reply(404, { error: 'That item is not for sale.' });
      const bal = karmaOf(c), price = li.sale || li.price;
      if (bal < price) return reply(400, { error: 'Not enough karma. You have ' + bal + ' and it costs ' + price + '.' });
      c.karma = String(bal - price);
      c.items = Array.isArray(c.items) ? c.items : [];
      const have = c.items.find((x) => String(x.name).toLowerCase() === e.name.toLowerCase());
      if (have) have.qty = Math.min(9999, (Number(have.qty) || 0) + 1); else if (c.items.length < 100) c.items.push({ name: e.name, qty: 1, desc: S(e.desc, 500) });
      await save();
      return reply(200, Object.assign(view(c), { message: 'Bought ' + e.name + ' for ' + price + ' karma.' }));
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
