// Marketplace with Mammon. Players buy items (karma is worked out automatically and the item lands in their inventory),
// pay down karma debt in amounts they choose, and take loans. The headmaster sets the categories, prices and Mammon's lines.
// Only items that exist in the World registry can be sold.
const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const { reply, S, N, IMG, ID, isAdmin, who, needUser, karmaOf, parseBody, imageReply } = require('./lib/auth');
const { loadAll } = require('./lib/world');

const LOAN_CAP = 10000;
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
      items: (Array.isArray(c.items) ? c.items : []).slice(0, 200).filter((i) => i && worldIds.has(String(i.itemId))).map((i) => ({ itemId: String(i.itemId), price: N(i.price, 0, 1000000) })),
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
    if (!u.admin) { c = await cstore.get(u.id, { type: 'json' }); if (!c) return reply(404, { error: 'Character not found.' }); }
    const view = (c) => ({ karma: c ? karmaOf(c) : 0, debt: c ? c.debt || 0 : 0 });

    if (!b.action || b.action === 'state') {
      return reply(200, Object.assign(view(c), {
        mammon: { name: cfg.mammon.name, image: cfg.mammon.image ? '/.netlify/functions/market?img=1&v=' + Date.parse(cfg.updatedAt) : '', lines: cfg.mammon.lines },
        cats: cfg.cats.map((k) => ({ id: k.id, name: k.name, items: k.items.filter((i) => byId[i.itemId]).map((i) => { const e = byId[i.itemId]; return { itemId: e.id, name: e.name, desc: e.desc, image: e.image ? '/.netlify/functions/world?img=' + e.id + '&v=' + Date.parse(e.updatedAt || 0) : '', price: i.price }; }) })),
      }));
    }
    if (u.admin) return reply(400, { error: 'Only souls can trade.' });

    const save = async () => { await cstore.setJSON(u.id, c); };
    if (b.action === 'buy') {
      const cat = cfg.cats.find((k) => k.id === String(b.catId)), li = cat && cat.items.find((i) => i.itemId === String(b.itemId)), e = li && byId[li.itemId];
      if (!e) return reply(404, { error: 'That item is not for sale.' });
      const bal = karmaOf(c);
      if (bal < li.price) return reply(400, { error: 'Not enough karma. You have ' + bal + ' and it costs ' + li.price + '.' });
      c.karma = String(bal - li.price);
      c.items = Array.isArray(c.items) ? c.items : [];
      const have = c.items.find((x) => String(x.name).toLowerCase() === e.name.toLowerCase());
      if (have) have.qty = Math.min(9999, (Number(have.qty) || 0) + 1); else if (c.items.length < 100) c.items.push({ name: e.name, qty: 1, desc: S(e.desc, 500) });
      await save();
      return reply(200, Object.assign(view(c), { message: 'Bought ' + e.name + ' for ' + li.price + ' karma.' }));
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
      if (debt + amt > LOAN_CAP) return reply(400, { error: 'Loans are capped at ' + LOAN_CAP + ' karma.' });
      c.karma = String(bal + amt); c.debt = debt + amt; await save();
      return reply(200, Object.assign(view(c), { message: 'Borrowed ' + amt + ' karma. It is added to your debt.' }));
    }
    return reply(400, { error: 'Unknown action' });
  } catch (e) { return reply(502, { error: 'Server error: ' + e.message }); }
};
