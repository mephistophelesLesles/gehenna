// Registry helpers shared by the public reader (registry.js) and the headmaster admin (admin.js).
// Players, NPCs and Monsters/Shadows each live in their own Netlify Blobs entry ('gehenna-registry' store).
const crypto = require('crypto');

const TYPES = ['player', 'npc', 'shadow'];
const STATS = ['STR', 'WIS', 'DEX', 'INT', 'CHA', 'CON'];

// THE TEMPLATE. This decides which sections each kind of entry has. Anything not listed here is never
// sent to players, even if it was saved. Edit these lists to change a template.
const COMMON = ['stats', 'basic', 'skills', 'ultimate', 'quirk'];
const TEMPLATE = {
  player: COMMON.concat(['karma', 'notes', 'risk']),
  npc: COMMON.concat(['karma', 'notes', 'risk']),
  shadow: COMMON.concat(['risk']), // no karma, no headmaster notes
};

const ID = /^[a-f0-9-]{8,40}$/i;
const IMG = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/;
const S = (v, n) => String(v == null ? '' : v).slice(0, n == null ? 4000 : n);
const N = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

async function loadAll(store) {
  const { blobs } = await store.list();
  const all = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
  return all.filter(Boolean);
}

// Only known fields are kept, with limits.
function clean(e, old) {
  const type = TYPES.includes(e.type) ? e.type : (old ? old.type : 'player');
  const img = typeof e.image === 'string' && IMG.test(e.image) && e.image.length < 250000 ? e.image : '';
  return {
    id: old ? old.id : crypto.randomUUID(),
    type,
    name: S(e.name, 100).trim() || 'Unnamed',
    image: img,
    listed: e.listed === false ? false : true,
    undisclosed: type === 'npc' && e.undisclosed === true,
    revealTo: (Array.isArray(e.revealTo) ? e.revealTo : []).filter((x) => ID.test(String(x))).slice(0, 200).map(String),
    stats: STATS.reduce((o, k) => { o[k] = N((e.stats || {})[k], 0, 99); return o; }, {}),
    basic: S(e.basic, 200),
    skills: (Array.isArray(e.skills) ? e.skills : []).slice(0, 10).map((x) => S(x, 200)).filter(Boolean),
    ultimate: S(e.ultimate, 200),
    quirk: S(e.quirk, 400),
    karma: S(e.karma, 40),
    notes: S(e.notes, 2000),
    risk: S(e.risk, 40),
    createdAt: old ? old.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// Can this viewer see the details? Undisclosed NPCs are sealed unless the headmaster let this player in.
function canOpen(e, viewerId) {
  if (!(e.type === 'npc' && e.undisclosed)) return { open: true, granted: false };
  return viewerId && (e.revealTo || []).includes(viewerId) ? { open: true, granted: true } : { open: false, granted: false };
}

// What a player is allowed to receive. Public images are served by URL; granted ones go inline.
function view(e, viewerId, detail) {
  const o = canOpen(e, viewerId);
  const out = { id: e.id, type: e.type, name: e.name, undisclosed: !o.open, image: '' };
  if (!o.open) return out;
  if (e.image) out.image = o.granted ? e.image : '/.netlify/functions/registry?img=' + e.id + '&v=' + Date.parse(e.updatedAt || 0);
  if (!detail) return out;
  TEMPLATE[e.type].forEach((k) => { out[k] = e[k] == null ? '' : e[k]; });
  return out;
}

// Headmaster actions. Returns [status, body], or null when the action is not a registry action.
async function registryAdmin(b, store) {
  if (!['reglist', 'regsave', 'regdelete'].includes(b.action)) return null;
  if (b.action === 'reglist') {
    const all = await loadAll(store);
    return [200, { entries: all.sort((x, y) => x.name.localeCompare(y.name)), template: TEMPLATE }];
  }
  if (b.action === 'regsave') {
    const inc = b.entry || {};
    const old = ID.test(String(inc.id || '')) ? await store.get(inc.id, { type: 'json' }) : null;
    const next = clean(inc, old);
    await store.setJSON(next.id, next);
    return [200, { entry: next }];
  }
  if (!ID.test(String(b.id || ''))) return [400, { error: 'Bad id' }];
  await store.delete(b.id);
  return [200, { ok: true }];
}

module.exports = { loadAll, view, canOpen, registryAdmin, TEMPLATE, TYPES };
