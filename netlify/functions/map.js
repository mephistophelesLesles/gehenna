// Battle maps in lobbies. The headmaster uploads a picture, drags it around the box, sets the size of the grid squares,
// and places tokens. A player only ever receives the lobbies they were added to; if they are removed, the lobby stops
// being served to them. Players poll cheaply (just a revision number) and fetch the full map only when it changes.
const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const { reply, S, IMG, ID, needUser, parseBody, imageReply } = require('./lib/auth');

const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const meta = (l) => ({ id: l.id, name: l.name, rev: l.rev });

// Where a token's picture comes from: a player's character, a registry entry (NPC / monster), or a world item.
const SRC = /^(player|reg|world):[A-Za-z0-9-]{1,60}$/;
// Older tokens only remember a picture URL. Work out the source from it so they can be repaired.
const legacySrc = (u) => { const m = /^\/\.netlify\/functions\/(registry|chat|world)\?(?:img|avatar)=([A-Za-z0-9-]+)/.exec(String(u || '')); return m ? { registry: 'reg', chat: 'player', world: 'world' }[m[1]] + ':' + m[2] : ''; };
const tokUrl = (lid, tid, rev) => '/.netlify/functions/map?timg=' + lid + '_' + tid + '&v=' + rev;

async function sourceImage(src) {
  const [kind, id] = src.split(':');
  let data = '';
  if (kind === 'player') { const c = await getStore('gehenna-characters').get(id, { type: 'json' }); data = c && c.image; }
  else if (kind === 'reg') { const e = await getStore('gehenna-registry').get(id, { type: 'json' }); if (e && !(e.type === 'npc' && e.undisclosed && e.hideImage)) data = e.image; }
  else if (kind === 'world') { const e = await getStore('gehenna-world').get(id, { type: 'json' }); data = e && e.image; }
  return typeof data === 'string' && IMG.test(data) ? data : '';
}
// Keeps a private copy of each token's picture inside the lobby, so it always shows and survives later registry edits.
async function attachImages(store, next, old) {
  const oldTok = {}; (old ? old.tokens : []).forEach((t) => { oldTok[t.id] = t; });
  const keep = new Set();
  await Promise.all(next.tokens.map(async (t) => {
    if (!t.src) return;
    const key = 'timg/' + next.id + '/' + t.id, o = oldTok[t.id];
    if (o && o.src === t.src && o.img && o.img.indexOf('map?timg=') > 0) { t.img = o.img; keep.add(key); return; }
    let data = ''; try { data = await sourceImage(t.src); } catch (e) { data = ''; }
    if (data) { await store.set(key, data); t.img = tokUrl(next.id, t.id, next.rev); keep.add(key); }
  }));
  await Promise.all(Object.keys(oldTok).filter((id) => !keep.has('timg/' + next.id + '/' + id)).map((id) => store.delete('timg/' + next.id + '/' + id).catch(() => {})));
}

function clean(inc, old) {
  return {
    id: old ? old.id : crypto.randomUUID(),
    name: S(inc.name, 40).trim() || 'Lobby',
    rev: Date.now(),
    cell: num(inc.cell, 2, 25, 6), tokScale: num(inc.tokScale, 0.3, 4, 1),
    imgScale: num(inc.imgScale, 0.1, 6, 1), imgX: num(inc.imgX, -3, 3, 0), imgY: num(inc.imgY, -3, 3, 0),
    members: (Array.isArray(inc.members) ? inc.members : []).filter((x) => ID.test(String(x))).slice(0, 200).map(String),
    tokens: (Array.isArray(inc.tokens) ? inc.tokens : []).slice(0, 150).map((t) => ({
      id: ID.test(String(t.id || '')) ? String(t.id) : crypto.randomUUID(),
      label: S(t.label, 30), img: '', src: SRC.test(String(t.src || '')) ? String(t.src) : legacySrc(t.img),
      size: num(t.size, 0.25, 4, 1), x: num(t.x, 0, 1, 0.5), y: num(t.y, 0, 1, 0.5),
    })),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') return reply(405, { error: 'POST or GET only' });
  let b; try { b = parseBody(event); } catch (e) { return reply(400, { error: 'Bad request' }); }
  try {
    connectLambda(event);
    // Token pictures (ids are unguessable, like the other picture links on the site).
    if (event.httpMethod === 'GET') {
      const m = /^([a-zA-Z0-9-]{1,60})_([a-zA-Z0-9-]{1,60})$/.exec(String(b.timg || ''));
      const img = m && await getStore('gehenna-map').get('timg/' + m[1] + '/' + m[2]);
      return img ? imageReply(img, 86400) : reply(404, { error: 'No image' });
    }
    const u = await needUser(b);
    if (!u) return reply(401, { error: 'Sign in first.' });
    const store = getStore('gehenna-map');
    let all = (await store.get('lobbies', { type: 'json' })) || [];
    const mine = (l) => u.admin || l.members.includes(u.id);

    if (b.action === 'poll') return reply(200, { lobbies: all.filter(mine).map(meta) });
    if (b.action === 'get') {
      const l = all.find((x) => x.id === String(b.id));
      if (!l || !mine(l)) return reply(404, { error: 'You are not in that lobby.' });
      if (u.admin && l.tokens.some((t) => !t.src && t.img)) {
        // Old tokens: find where their picture came from and keep a copy, once.
        const was = {};
        l.tokens.forEach((t) => { if (!t.src) { t.src = legacySrc(t.img); if (t.src) { was[t.id] = t.img; t.img = ''; } } });
        l.rev = Date.now(); await attachImages(store, l, null);
        l.tokens.forEach((t) => { if (!t.img && was[t.id]) t.img = was[t.id]; });
        all = all.map((x) => (x.id === l.id ? l : x)); await store.setJSON('lobbies', all);
      }
      const image = (await store.get('img/' + l.id)) || '';
      return reply(200, { lobby: Object.assign({}, l, { image }) });
    }
    if (!u.admin) return reply(403, { error: 'Headmaster only.' });

    if (b.action === 'save') {
      const inc = b.lobby || {};
      const old = ID.test(String(inc.id || '')) ? all.find((x) => x.id === inc.id) : null;
      if (!old && all.length >= 20) return reply(400, { error: 'That is enough lobbies (20).' });
      const next = clean(inc, old);
      await attachImages(store, next, old);
      if (typeof inc.image === 'string') {
        if (inc.image === '') await store.delete('img/' + next.id).catch(() => {});
        else if (IMG.test(inc.image) && inc.image.length < 4500000) await store.set('img/' + next.id, inc.image);
        else return reply(400, { error: 'That image is too large or not a picture.' });
      }
      all = all.filter((x) => x.id !== next.id).concat([next]);
      await store.setJSON('lobbies', all);
      return reply(200, { lobby: meta(next), lobbies: all.map(meta), tokens: next.tokens.map((t) => ({ id: t.id, img: t.img, src: t.src })) });
    }
    if (b.action === 'delete') {
      all = all.filter((x) => x.id !== String(b.id));
      await store.setJSON('lobbies', all); await store.delete('img/' + String(b.id)).catch(() => {});
      const { blobs } = await store.list({ prefix: 'timg/' + String(b.id) + '/' }).catch(() => ({ blobs: [] }));
      await Promise.all(blobs.map((x) => store.delete(x.key).catch(() => {})));
      return reply(200, { lobbies: all.map(meta) });
    }
    return reply(400, { error: 'Unknown action' });
  } catch (e) { return reply(502, { error: 'Server error: ' + e.message }); }
};
