// Registry helpers shared by the public reader (registry.js) and the headmaster admin (admin.js).
// Players, NPCs and Monsters/Shadows each live in their own Netlify Blobs entry ('gehenna-registry' store).
const crypto = require('crypto');
const { imgOk } = require('./auth');

const TYPES = ['player', 'npc', 'shadow'];
const STATS = ['STR', 'WIS', 'DEX', 'INT', 'CHA', 'CON'];

// THE TEMPLATE. This decides which sections each kind of entry has. Anything not listed here is never
// sent to players, even if it was saved. Edit these lists to change a template.
const COMMON = ['hp', 'armor', 'speed', 'initiative', 'size', 'languages', 'level', 'prof', 'saves', 'senses', 'immunities', 'attacks', 'stats', 'basic', 'skills', 'ultimate', 'quirks', 'weaknesses', 'resistances'];
const TEMPLATE = {
  player: COMMON.concat(['karma', 'notes', 'risk']),
  npc: COMMON.concat(['karma', 'notes', 'risk']),
  shadow: COMMON.concat(['risk']), // no karma, no headmaster notes
};

// The "stats" a headmaster can seal. When statsOpen is false these are never sent to players.
const GATED = ['hp', 'armor', 'speed', 'initiative', 'stats', 'prof', 'saves', 'immunities', 'resistances', 'weaknesses', 'attacks'];

const ID = /^[a-f0-9-]{8,40}$/i;
const IMG = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+\/=]+$/;
// Up to 3 quirks. Older entries stored one text; split it so nothing is lost.
const S = (v, n) => String(v == null ? '' : v).slice(0, n == null ? 4000 : n);
const N = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
// Up to 3 quirks. Older entries stored a single text, so split it and nothing is lost.
function quirksOf(e) { return (Array.isArray(e.quirks) ? e.quirks : String(e.quirk || '').split('\n')).map((x) => S(x, 100).trim()).filter(Boolean).slice(0, 3); }

async function loadAll(store) {
  const { blobs } = await store.list();
  const all = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
  return all.filter(Boolean);
}

// Only known fields are kept, with limits.
function clean(e, old, secs) {
  // A custom category (tab) decides the type, so the entry always follows that category's template.
  const sec = secs && secs.find((x) => x.id === String(e.section || ''));
  const type = sec ? sec.base : (TYPES.includes(e.type) ? e.type : (old ? old.type : 'player'));
  const img = imgOk(e.image, 250000) ? e.image : '';
  return {
    id: old ? old.id : crypto.randomUUID(),
    type,
    section: sec ? sec.id : '',
    name: S(e.name, 100).trim() || 'Unnamed',
    image: img,
    listed: e.listed === false ? false : true,
    undisclosed: type === 'npc' && e.undisclosed === true,
    // A label the headmaster makes up (e.g. ver1.0, Gehenna's Worker, S Rank). Always public.
    category: S(e.category, 40).trim(),
    // For sealed NPCs only: a short public note, and the fields the headmaster chose to reveal.
    teaser: S(e.teaser, 300).trim(),
    revealFields: (Array.isArray(e.revealFields) ? e.revealFields : []).filter((k) => TEMPLATE[type].includes(k)).slice(0, 30),
    // Sealed NPCs show their picture by default. Only when this is true is the picture sealed too.
    hideImage: type === 'npc' && e.undisclosed === true && e.hideImage === true,
    revealTo: (Array.isArray(e.revealTo) ? e.revealTo : []).filter((x) => ID.test(String(x))).slice(0, 200).map(String),
    hp: N(e.hp, 0, 9999),
    armor: N(e.armor, 0, 999),
    speed: N(e.speed == null ? 30 : e.speed, 0, 999),
    initiative: N(e.initiative, -99, 99),
    size: S(e.size, 40),
    level: S(e.level, 40),
    prof: N(e.prof, 0, 20),
    saves: S(e.saves, 200),
    senses: S(e.senses, 200),
    immunities: S(e.immunities, 300),
    attacks: S(e.attacks, 1500),
    // Older entries have no value and stay disclosed; new entries start sealed.
    statsOpen: typeof e.statsOpen === 'boolean' ? e.statsOpen : (old ? old.statsOpen !== false : false),
    languages: S(e.languages, 200),
    weaknesses: S(e.weaknesses, 300),
    resistances: S(e.resistances, 300),
    stats: STATS.reduce((o, k) => { o[k] = N((e.stats || {})[k], 0, 99); return o; }, {}),
    basic: S(e.basic, 200),
    skills: (Array.isArray(e.skills) ? e.skills : []).slice(0, 40).map((x) => S(x, 200)).filter(Boolean),
    ultimate: S(e.ultimate, 200),
    quirks: quirksOf(e),
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
  const out = { id: e.id, type: e.type, section: e.section || '', name: e.name, category: e.category || '', undisclosed: !o.open, image: '' };
  // The picture is public unless the headmaster hid the appearance too. Everything else stays sealed.
  if (e.image && (o.open || !e.hideImage)) out.image = o.granted ? e.image : '/.netlify/functions/registry?img=' + e.id + '&v=' + Date.parse(e.updatedAt || 0);
  if (!detail) return out;
  // A sealed entry only gets its public note and the fields the headmaster chose to reveal.
  const keys = o.open ? TEMPLATE[e.type] : TEMPLATE[e.type].filter((k) => (e.revealFields || []).includes(k));
  if (!o.open && e.teaser) out.teaser = e.teaser;
  keys.forEach((k) => { out[k] = k === 'quirks' ? quirksOf(e) : (e[k] == null ? '' : e[k]); });
  if (e.statsOpen === false) { GATED.forEach((k) => { delete out[k]; }); if (o.open) out.statsHidden = true; }
  return out;
}

// Custom categories: extra tabs next to Players / NPCs / Shadows. Each one works like one of the three built-in kinds
// (its "base"), which decides the fields the entry has. Kept in their own store so they never mix with the entries.
async function loadSections(sstore) {
  const l = await sstore.get('list', { type: 'json' });
  return (Array.isArray(l) ? l : []).filter((x) => x && ID.test(String(x.id || '')) && TYPES.includes(x.base)).map((x) => ({ id: String(x.id), name: S(x.name, 40).trim() || 'Category', base: x.base }));
}

// Headmaster actions. Returns [status, body], or null when the action is not a registry action.
async function registryAdmin(b, store, sstore) {
  if (!['reglist', 'regsave', 'regdelete', 'regsecsave', 'regsecdelete'].includes(b.action)) return null;
  if (b.action === 'reglist') {
    const all = await loadAll(store);
    return [200, { entries: all.map((e) => Object.assign({}, e, { quirks: quirksOf(e) })).sort((x, y) => x.name.localeCompare(y.name)), template: TEMPLATE, sections: await loadSections(sstore) }];
  }
  if (b.action === 'regsecsave') {
    // Add a category, or rename / re-base an existing one. Entries already inside follow the new base.
    const list = await loadSections(sstore), name = S(b.name, 40).trim(), base = TYPES.includes(b.base) ? b.base : 'npc';
    if (!name) return [400, { error: 'Give the category a name.' }];
    if (['players', 'npcs', 'shadows', 'monsters'].includes(name.toLowerCase())) return [400, { error: 'That name is already a built-in tab.' }];
    if (list.some((x) => x.name.toLowerCase() === name.toLowerCase() && x.id !== b.id)) return [400, { error: 'A category with that name already exists.' }];
    const i = list.findIndex((x) => x.id === String(b.id || ''));
    let sec;
    if (i >= 0) { sec = { id: list[i].id, name, base }; list[i] = sec; }
    else { if (list.length >= 12) return [400, { error: 'You can have at most 12 categories.' }]; sec = { id: crypto.randomUUID(), name, base }; list.push(sec); }
    await sstore.setJSON('list', list);
    if (i >= 0) { const all = await loadAll(store); await Promise.all(all.filter((e) => e.section === sec.id && e.type !== base).map((e) => { e.type = base; if (base !== 'npc') { e.undisclosed = false; e.hideImage = false; } return store.setJSON(e.id, e); })); }
    return [200, { sections: list, section: sec }];
  }
  if (b.action === 'regsecdelete') {
    // The entries are not deleted: they move back to their built-in tab.
    const list = await loadSections(sstore), id = String(b.id || '');
    if (!list.some((x) => x.id === id)) return [404, { error: 'That category does not exist.' }];
    await sstore.setJSON('list', list.filter((x) => x.id !== id));
    const all = await loadAll(store);
    await Promise.all(all.filter((e) => e.section === id).map((e) => { e.section = ''; return store.setJSON(e.id, e); }));
    return [200, { sections: list.filter((x) => x.id !== id) }];
  }
  if (b.action === 'regsave') {
    const inc = b.entry || {};
    const old = ID.test(String(inc.id || '')) ? await store.get(inc.id, { type: 'json' }) : null;
    const next = clean(inc, old, await loadSections(sstore));
    await store.setJSON(next.id, next);
    return [200, { entry: next }];
  }
  if (!ID.test(String(b.id || ''))) return [400, { error: 'Bad id' }];
  await store.delete(b.id);
  return [200, { ok: true }];
}

module.exports = { loadAll, loadSections, view, canOpen, registryAdmin, TEMPLATE, TYPES };
