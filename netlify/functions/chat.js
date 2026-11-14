// Chat: an OOC room, an RP room, and private messages between any two people (players and the headmaster).
// Names are shortened to 10 characters. Players cannot rename themselves or change their icon (it is their character's);
// only the headmaster can edit her own profile. Chat logs are deleted at the start of every month.
const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const { reply, S, IMG, ID, needUser, parseBody, imageReply } = require('./lib/auth');

const ymOf = (d) => (d || new Date()).toISOString().slice(0, 7);
const short = (n) => String(n || '').trim().slice(0, 10) || '?';
const pad = (n) => String(n).padStart(13, '0');

async function characters(cstore) {
  const { blobs } = await cstore.list();
  const all = await Promise.all(blobs.map((b) => cstore.get(b.key, { type: 'json' }).catch(() => null)));
  return all.filter((c) => c && c.id && c.name);
}
async function profile(store) { return (await store.get('hm-profile', { type: 'json' })) || { name: 'Headmaster', image: '', at: 0 }; }

// Once a month, drop everything written in earlier months.
async function monthlyCleanup(store) {
  const ym = ymOf();
  const meta = await store.get('meta', { type: 'json' });
  if (meta && meta.ym === ym) return;
  for (const prefix of ['m/', 'i/']) {
    const { blobs } = await store.list({ prefix });
    await Promise.all(blobs.filter((b) => {
      const seg = b.key.split('/');
      const month = prefix === 'm/' ? seg[2] : seg[1];
      return month && month < ym;
    }).map((b) => store.delete(b.key).catch(() => {})));
  }
  await store.setJSON('meta', { ym });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') return reply(405, { error: 'POST or GET only' });
  let b; try { b = parseBody(event); } catch (e) { return reply(400, { error: 'Bad request' }); }
  try {
    connectLambda(event);
    const store = getStore('gehenna-chat'), cstore = getStore('gehenna-characters');

    // Pictures: character icons, the headmaster's icon, and images posted in chat. Their ids are unguessable.
    if (event.httpMethod === 'GET') {
      if (b.avatar) {
        const id = String(b.avatar);
        if (id === 'hm') { const p = await profile(store); return p.image ? imageReply(p.image, 300) : reply(404, { error: 'No image' }); }
        const c = ID.test(id) && await cstore.get(id, { type: 'json' });
        return c && c.image ? imageReply(c.image, 300) : reply(404, { error: 'No image' });
      }
      if (b.mimg && /^\d{4}-\d{2}_[a-f0-9-]{10,40}$/.test(String(b.mimg))) {
        const [ym, id] = String(b.mimg).split('_');
        const img = await store.get('i/' + ym + '/' + id);
        return img ? imageReply(img, 86400) : reply(404, { error: 'No image' });
      }
      return reply(404, { error: 'Not found' });
    }

    const u = await needUser(b);
    if (!u) return reply(401, { error: 'Sign in first.' });

    const channelOf = () => {
      if (b.channel === 'ooc' || b.channel === 'rp') return b.channel;
      const w = String(b.with || '');
      if (!ID.test(w) || w === u.id) return null;
      return 'pm_' + [u.id, w].sort().join('_');
    };

    if (b.action === 'members') {
      const chars = await characters(cstore), p = await profile(store), inbox = (await store.get('in/' + u.id, { type: 'json' })) || {};
      const list = chars.map((c) => ({ id: c.id, name: short(c.name), avatar: c.image ? '/.netlify/functions/chat?avatar=' + c.id + '&v=' + Date.parse(c.updatedAt || 0) : '' }));
      list.unshift({ id: 'hm', name: short(p.name), avatar: p.image ? '/.netlify/functions/chat?avatar=hm&v=' + (p.at || 0) : '', headmaster: true });
      return reply(200, { me: u.id, admin: u.admin, members: list, unread: inbox });
    }
    if (b.action === 'setprofile') {
      if (!u.admin) return reply(403, { error: 'Only the headmaster can edit her profile.' });
      const p = await profile(store);
      p.name = short(b.name === undefined ? p.name : b.name);
      if (b.image === '') p.image = ''; else if (typeof b.image === 'string' && IMG.test(b.image) && b.image.length < 200000) p.image = b.image;
      p.at = Date.now(); await store.setJSON('hm-profile', p);
      return reply(200, { ok: true });
    }

    const ch = channelOf();
    if (!ch) return reply(400, { error: 'Pick who to talk to.' });
    const prefix = 'm/' + ch + '/';

    if (b.action === 'history') {
      let keys = (await store.list({ prefix })).blobs.map((x) => x.key).sort();
      keys = b.after ? keys.filter((k) => k > String(b.after)) : keys.slice(-60);
      const msgs = (await Promise.all(keys.map((k) => store.get(k, { type: 'json' }).then((m) => m && Object.assign(m, { k })).catch(() => null)))).filter(Boolean);
      if (ch.startsWith('pm_')) { // opening a private chat clears its unread count
        const inbox = (await store.get('in/' + u.id, { type: 'json' })) || {};
        if (inbox[String(b.with)]) { delete inbox[String(b.with)]; await store.setJSON('in/' + u.id, inbox); }
      }
      return reply(200, { msgs });
    }
    if (b.action === 'send') {
      const text = S(b.text, 500).trim(), image = typeof b.image === 'string' && IMG.test(b.image) && b.image.length < 180000 ? b.image : '';
      if (!text && !image) return reply(400, { error: 'Write something first.' });
      await monthlyCleanup(store);
      const ym = ymOf(), id = crypto.randomBytes(8).toString('hex'), ts = Date.now();
      let img = '';
      if (image) { await store.set('i/' + ym + '/' + id, image); img = ym + '_' + id; }
      await store.setJSON(prefix + ym + '/' + pad(ts) + '-' + id, { from: u.id, text, img, ts });
      if (ch.startsWith('pm_')) {
        const to = String(b.with), inbox = (await store.get('in/' + to, { type: 'json' })) || {};
        inbox[u.id] = (inbox[u.id] || 0) + 1; await store.setJSON('in/' + to, inbox);
      }
      return reply(200, { ok: true });
    }
    return reply(400, { error: 'Unknown action' });
  } catch (e) { return reply(502, { error: 'Server error: ' + e.message }); }
};
