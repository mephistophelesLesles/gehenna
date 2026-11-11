// Admin API: reads Netlify Forms submissions, accepts them into saved characters (Netlify Blobs), edits them, makes login keys, edits the storyline chapters, and edits the Players / NPCs / Monsters registry.
// Env vars: NETLIFY_TOKEN, ADMIN_PASSWORD, (optional) ADMIN_EMAIL, FORM_NAME, GEHENNA_SITE_ID.
const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const { storyAdmin } = require('./lib/story');
const { registryAdmin } = require('./lib/registry');
const API = 'https://api.netlify.com/api/v1';
const FORM = process.env.FORM_NAME || 'gehenna-sheet';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'Mephisto').trim().toLowerCase();
const ST = ['STR', 'INT', 'DEX', 'WIS', 'CHA', 'CON'], TYPES = ['Damage', 'Heal', 'Shield', 'Other'];
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function same(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
const reply = (status, obj) => ({ statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
async function nf(path, opts) {
  const r = await fetch(API + path, Object.assign({ headers: { Authorization: 'Bearer ' + process.env.NETLIFY_TOKEN } }, opts));
  if (!r.ok) throw new Error('Netlify API ' + r.status);
  return r.status === 204 ? null : r.json();
}
const newKey = () => 'GEH-' + Array.from(crypto.randomBytes(12), x => ALPH[x % 32]).join('').match(/.{4}/g).join('-');
const hash = k => crypto.createHash('sha256').update(String(k).trim().toUpperCase()).digest('hex');
const S = (v, n) => String(v == null ? '' : v).slice(0, n || 4000);
const N = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
const IMG = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/;

// At most 3 quirks, one per line.
const quirks = v => String(v || '').split('\n').map(x => x.trim().slice(0, 100)).filter(Boolean).slice(0, 3).join('\n');

// Turn the sheet text a player sent into a structured character.
function fromSheet(d) {
  const t = '\n' + String(d.sheet || '').replace(/\r/g, '');
  const L = ['Name', 'Gender', 'Date of Birth and Date of Death', 'Persona', 'Destiny', 'Accumulated Karma', 'Appearance Description', 'Core Most Treasured Item', 'Basic Skill', 'Skill 1', 'Skill 2', 'Skill 3', 'Skill 4', 'Ultimate', 'Quirk', 'Health Points'];
  let from = 0; const at = L.map(l => { const i = t.indexOf('\n' + l + ':', from); if (i >= 0) from = i + 1; return i; });
  const val = k => { const i = at[k]; if (i < 0) return ''; let e = t.length; for (let j = k + 1; j < at.length; j++) if (at[j] >= 0) { e = at[j]; break; } return t.slice(i + L[k].length + 2, e).trim(); };
  const item = val(7).split('\n'), stats = {};
  ST.forEach(k => { const m = t.match(new RegExp('\\n' + k + ': (\\d+) \\((\\d+) base')); const s = m ? +m[1] : 3; stats[k] = { score: s, mod: s }; });
  const skill = (label, k) => { const text = val(k); return { label, name: text.split(/[:\n\-–.,]/)[0].trim().slice(0, 40), text, cooldown: '', effects: [] }; };
  const karma = val(5);
  return {
    name: val(0) || S(d.name, 100), gender: val(1), dates: val(2), persona: val(3), destiny: val(4), karma: /judged by the headmaster/i.test(karma) ? '' : karma,
    appearance: val(6), itemName: item[0] || '', itemDesc: item.slice(1).join('\n').trim(), quirk: quirks(val(14)), hp: 20, armor: 0, speed: 30, items: [], stats,
    skills: [skill('Basic Skill', 8), skill('Skill 1', 9), skill('Skill 2', 10), skill('Skill 3', 11), skill('Skill 4', 12), skill('Ultimate', 13)].filter(s => s.text || s.label === 'Basic Skill' || s.label === 'Ultimate' || /[12]$/.test(s.label)),
  };
}

// Only known fields get saved, with sane limits.
function clean(c, old) {
  return {
    id: old.id, key: old.key, createdAt: old.createdAt, image: c.image ? old.image : '',
    name: S(c.name, 100), gender: S(c.gender, 100), dates: S(c.dates, 200), persona: S(c.persona), destiny: S(c.destiny), karma: S(c.karma), appearance: S(c.appearance),
    itemName: S(c.itemName, 200), itemDesc: S(c.itemDesc),
    items: (Array.isArray(c.items) ? c.items : []).slice(0, 100).map(i => ({ name: S(i.name, 100), qty: N(i.qty, 0, 9999), desc: S(i.desc, 500) })), quirk: quirks(c.quirk), hp: N(c.hp, 0, 9999), armor: N(c.armor, 0, 999), speed: N(c.speed, 0, 999),
    stats: ST.reduce((o, k) => { const s = (c.stats || {})[k] || {}; o[k] = { score: N(s.score, 0, 99), mod: N(s.mod, -99, 99) }; return o; }, {}),
    skills: (Array.isArray(c.skills) ? c.skills : []).slice(0, 12).map(s => ({
      label: S(s.label, 40), name: S(s.name, 100), text: S(s.text), cooldown: S(s.cooldown, 100),
      effects: (Array.isArray(s.effects) ? s.effects : []).slice(0, 10).map(e => ({ type: TYPES.includes(e.type) ? e.type : 'Other', n: N(e.n, 0, 50), d: N(e.d, 0, 1000), flat: N(e.flat, -999, 999), note: S(e.note, 200) })),
    })),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  if (!process.env.NETLIFY_TOKEN || !process.env.ADMIN_PASSWORD) return reply(500, { error: 'Admin is not set up yet (missing environment variables).' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch (e) { return reply(400, { error: 'Bad request' }); }
  const okEmail = same(String(b.email || '').trim().toLowerCase(), ADMIN_EMAIL);
  const okPass = same(b.password || '', process.env.ADMIN_PASSWORD);
  if (!(okEmail && okPass)) { await new Promise(r => setTimeout(r, 900)); return reply(401, { error: 'Wrong Secret ID or Secret Key.' }); }
  try {
    connectLambda(event);
    const chars = getStore('gehenna-characters'), keys = getStore('gehenna-keys');
    const goodId = /^[a-f0-9-]{8,40}$/i.test(String(b.id || ''));
    const sr = await storyAdmin(b, getStore('gehenna-story'));
    if (sr) return reply(sr[0], sr[1]);
    const rr = await registryAdmin(b, getStore('gehenna-registry'));
    if (rr) return reply(rr[0], rr[1]);

    if (b.action === 'delete') {
      if (!goodId) return reply(400, { error: 'Bad id' });
      await nf('/submissions/' + b.id, { method: 'DELETE' });
      return reply(200, { ok: true });
    }
    if (b.action === 'accept') {
      if (!goodId) return reply(400, { error: 'Bad id' });
      const sub = await nf('/submissions/' + b.id);
      const c = fromSheet(sub.data || {});
      c.id = crypto.randomUUID(); c.key = newKey(); c.createdAt = new Date().toISOString();
      const img = String((sub.data || {}).image || '');
      c.image = IMG.test(img) && img.length < 700000 ? img : '';
      await chars.setJSON(c.id, c); await keys.set(hash(c.key), c.id);
      await nf('/submissions/' + b.id, { method: 'DELETE' }).catch(() => {});
      return reply(200, { char: c });
    }
    if (b.action === 'chars') {
      const { blobs } = await chars.list();
      const all = (await Promise.all(blobs.map(x => chars.get(x.key, { type: 'json' })))).filter(Boolean);
      return reply(200, { chars: all.sort((x, y) => x.name.localeCompare(y.name)) });
    }
    if (b.action === 'save' || b.action === 'newkey' || b.action === 'delchar') {
      if (!goodId && !(b.char && /^[a-f0-9-]{8,40}$/i.test(String(b.char.id || '')))) return reply(400, { error: 'Bad id' });
      const id = b.id || b.char.id, old = await chars.get(id, { type: 'json' });
      if (!old) return reply(404, { error: 'Character not found' });
      if (b.action === 'save') { const c = clean(b.char, old); await chars.setJSON(id, c); return reply(200, { char: c }); }
      await keys.delete(hash(old.key));
      if (b.action === 'delchar') { await chars.delete(id); return reply(200, { ok: true }); }
      old.key = newKey(); await chars.setJSON(id, old); await keys.set(hash(old.key), id);
      return reply(200, { char: old });
    }

    const siteId = process.env.SITE_ID || process.env.GEHENNA_SITE_ID;
    if (!siteId) return reply(500, { error: 'Site id not found. Add GEHENNA_SITE_ID in environment variables.' });
    const forms = await nf('/sites/' + siteId + '/forms');
    const form = forms.find(f => f.name === FORM);
    if (!form) return reply(200, { items: [] });
    const base = '/forms/' + form.id + '/submissions?per_page=100';
    const [ok, spam] = await Promise.all([nf(base), nf(base + '&state=spam').catch(() => [])]);
    const map = (flag) => (s) => ({ id: s.id, at: s.created_at, spam: flag, name: (s.data && s.data.name) || 'Unnamed soul', sheet: (s.data && s.data.sheet) || '', image: (s.data && IMG.test(s.data.image || '') && s.data.image) || '' });
    const items = ok.map(map(false)).concat(spam.map(map(true))).sort((a, b) => new Date(b.at) - new Date(a.at));
    return reply(200, { items: items });
  } catch (e) { return reply(502, { error: 'Server error: ' + e.message }); }
};
