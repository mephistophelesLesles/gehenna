// Storyline helpers shared by the public reader (story.js) and the headmaster admin (admin.js).
// Chapters live in one Netlify Blobs entry ('chapters' in the 'gehenna-story' store). Until the headmaster
// saves something, the starter chapters below are served.
const crypto = require('crypto');

const PROLOGUE = `The first thing you notice is the ash on your mouth, and the second one is that you're no longer breathing.

At that point, you understood.

**You are already dead**

Heaven, hell, none of it mattered here. What matters is whether you deserve another life, a chance to be reincarnated. Before long, you find yourself standing in the fields of Gehenna, where your sins are carried, and your karma is weighed.

I wonder... will you end up staying here? Or perhaps you would be able to leave, or perchance... you'll fade away as most souls do.`;

const DEFAULTS = [
  { id: 'prologue', title: 'Prologue', locked: false, body: PROLOGUE, images: [] },
  { id: 'chapter-1', title: 'Chapter 1', locked: true, body: '', images: [] },
  { id: 'chapter-2', title: 'Chapter 2', locked: true, body: '', images: [] },
  { id: 'chapter-3', title: 'Chapter 3', locked: true, body: '', images: [] },
];

const ID = /^[a-z0-9-]{1,40}$/;
const IMG = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/;
const S = (v, n) => String(v == null ? '' : v).slice(0, n);

async function loadAll(store) {
  const a = await store.get('chapters', { type: 'json' });
  return Array.isArray(a) ? a : JSON.parse(JSON.stringify(DEFAULTS));
}
const saveAll = (store, all) => store.setJSON('chapters', all);
const meta = (c) => ({ id: c.id, title: c.title, locked: !!c.locked });

// Only known fields are kept, with limits. A chapter is locked unless it is explicitly opened.
function clean(c, old) {
  const imgs = (Array.isArray(c.images) ? c.images : []).slice(0, 6)
    .filter((i) => i && typeof i.src === 'string' && i.src.length < 500000 && IMG.test(i.src))
    .map((i) => ({ src: i.src, caption: S(i.caption, 200) }));
  return {
    id: old ? old.id : crypto.randomUUID(),
    title: S(c.title, 120).trim() || 'Untitled',
    locked: c.locked === false ? false : true,
    body: S(c.body, 60000),
    images: imgs,
    updatedAt: new Date().toISOString(),
  };
}

// Headmaster actions. Returns [status, body], or null when the action is not a storyline action.
async function storyAdmin(b, store) {
  if (!['storylist', 'storysave', 'storydelete', 'storymove'].includes(b.action)) return null;
  const all = await loadAll(store);
  const idx = (id) => all.findIndex((x) => x.id === String(id || ''));

  if (b.action === 'storylist') return [200, { chapters: all }];

  if (b.action === 'storysave') {
    const inc = b.chapter || {};
    const i = ID.test(String(inc.id || '')) ? idx(inc.id) : -1;
    const next = clean(inc, i >= 0 ? all[i] : null);
    if (i >= 0) all[i] = next; else all.push(next);
    await saveAll(store, all);
    return [200, { chapter: next }];
  }

  const i = idx(b.id);
  if (i < 0) return [404, { error: 'Chapter not found' }];

  if (b.action === 'storydelete') {
    all.splice(i, 1);
    await saveAll(store, all);
    return [200, { ok: true }];
  }

  const j = i + (Number(b.dir) < 0 ? -1 : 1);
  if (j >= 0 && j < all.length) {
    [all[i], all[j]] = [all[j], all[i]];
    await saveAll(store, all);
  }
  return [200, { ok: true }];
}

module.exports = { loadAll, meta, storyAdmin, DEFAULTS };
