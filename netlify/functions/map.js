// Battle maps in lobbies. The headmaster uploads a picture, drags it around the box, sets the size of the grid squares,
// and places tokens. A player only ever receives the lobbies they were added to; if they are removed, the lobby stops
// being served to them. Players poll cheaply (just a revision number) and fetch the full map only when it changes.
const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const { reply, S, IMG, ID, needUser, parseBody } = require('./lib/auth');

const TOKEN_IMG = /^\/\.netlify\/functions\/(registry|chat|world)\?(img|avatar)=[A-Za-z0-9-]+(&v=\d+)?$/;
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const meta = (l) => ({ id: l.id, name: l.name, rev: l.rev });

function clean(inc, old) {
  return {
    id: old ? old.id : crypto.randomUUID(),
    name: S(inc.name, 40).trim() || 'Lobby',
    rev: Date.now(),
    cell: num(inc.cell, 2, 25, 6),
    imgScale: num(inc.imgScale, 0.1, 6, 1), imgX: num(inc.imgX, -3, 3, 0), imgY: num(inc.imgY, -3, 3, 0),
    members: (Array.isArray(inc.members) ? inc.members : []).filter((x) => ID.test(String(x))).slice(0, 200).map(String),
    tokens: (Array.isArray(inc.tokens) ? inc.tokens : []).slice(0, 150).map((t) => ({
      id: ID.test(String(t.id || '')) ? String(t.id) : crypto.randomUUID(),
      label: S(t.label, 30), img: TOKEN_IMG.test(String(t.img || '')) ? String(t.img) : '',
      x: num(t.x, 0, 1, 0.5), y: num(t.y, 0, 1, 0.5),
    })),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  let b; try { b = parseBody(event); } catch (e) { return reply(400, { error: 'Bad request' }); }
  try {
    connectLambda(event);
    const u = await needUser(b);
    if (!u) return reply(401, { error: 'Sign in first.' });
    const store = getStore('gehenna-map');
    let all = (await store.get('lobbies', { type: 'json' })) || [];
    const mine = (l) => u.admin || l.members.includes(u.id);

    if (b.action === 'poll') return reply(200, { lobbies: all.filter(mine).map(meta) });
    if (b.action === 'get') {
      const l = all.find((x) => x.id === String(b.id));
      if (!l || !mine(l)) return reply(404, { error: 'You are not in that lobby.' });
      const image = (await store.get('img/' + l.id)) || '';
      return reply(200, { lobby: Object.assign({}, l, { image }) });
    }
    if (!u.admin) return reply(403, { error: 'Headmaster only.' });

    if (b.action === 'save') {
      const inc = b.lobby || {};
      const old = ID.test(String(inc.id || '')) ? all.find((x) => x.id === inc.id) : null;
      if (!old && all.length >= 20) return reply(400, { error: 'That is enough lobbies (20).' });
      const next = clean(inc, old);
      if (typeof inc.image === 'string') {
        if (inc.image === '') await store.delete('img/' + next.id).catch(() => {});
        else if (IMG.test(inc.image) && inc.image.length < 4500000) await store.set('img/' + next.id, inc.image);
        else return reply(400, { error: 'That image is too large or not a picture.' });
      }
      all = all.filter((x) => x.id !== next.id).concat([next]);
      await store.setJSON('lobbies', all);
      return reply(200, { lobby: meta(next), lobbies: all.map(meta) });
    }
    if (b.action === 'delete') {
      all = all.filter((x) => x.id !== String(b.id));
      await store.setJSON('lobbies', all); await store.delete('img/' + String(b.id)).catch(() => {});
      return reply(200, { lobbies: all.map(meta) });
    }
    return reply(400, { error: 'Unknown action' });
  } catch (e) { return reply(502, { error: 'Server error: ' + e.message }); }
};
