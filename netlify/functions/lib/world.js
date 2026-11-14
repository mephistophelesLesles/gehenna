// World registry: Locations and Items. Everyone can read them; the headmaster edits them.
// The Marketplace can only sell items that exist here.
const crypto = require('crypto');
const { S, N, IMG, ID } = require('./auth');

const KINDS = ['location', 'item'];

async function loadAll(store) {
  const { blobs } = await store.list();
  const all = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
  return all.filter(Boolean);
}
function clean(e, old) {
  const kind = KINDS.includes(e.kind) ? e.kind : (old ? old.kind : 'item');
  let image = old ? old.image || '' : '';
  if (e.image === '') image = '';
  else if (typeof e.image === 'string' && IMG.test(e.image) && e.image.length < 250000) image = e.image;
  return {
    id: old ? old.id : crypto.randomUUID(), kind,
    name: S(e.name, 100).trim() || 'Unnamed', image,
    desc: S(e.desc, 2000), category: S(e.category, 60).trim(),
    price: N(e.price, 0, 1000000),
    createdAt: old ? old.createdAt : new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}
const imgUrl = (e) => (e.image ? '/.netlify/functions/world?img=' + e.id + '&v=' + Date.parse(e.updatedAt || 0) : '');
const pub = (e) => ({ id: e.id, kind: e.kind, name: e.name, image: imgUrl(e), desc: e.desc, category: e.category, price: e.price });

async function worldAdmin(b, store) {
  if (b.action === 'wlist') {
    const all = await loadAll(store);
    return [200, { entries: all.map((e) => Object.assign(pub(e), { hasImage: !!e.image })).sort((x, y) => x.name.localeCompare(y.name)) }];
  }
  if (b.action === 'wsave') {
    const inc = b.entry || {};
    const old = ID.test(String(inc.id || '')) ? await store.get(inc.id, { type: 'json' }) : null;
    const next = clean(inc, old);
    await store.setJSON(next.id, next);
    return [200, { entry: Object.assign(pub(next), { hasImage: !!next.image }) }];
  }
  if (b.action === 'wdelete') {
    if (!ID.test(String(b.id || ''))) return [400, { error: 'Bad id' }];
    await store.delete(b.id); return [200, { ok: true }];
  }
  return null;
}
module.exports = { loadAll, pub, worldAdmin };
