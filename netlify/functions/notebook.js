// Notebook: each person (every player, and the headmaster) keeps their own chapters, like the story editor.
// Only the owner can read or change their notebook.
const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const { reply, S, ID, needUser, parseBody } = require('./lib/auth');

const MAX_CHAPTERS = 100;
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  let b; try { b = parseBody(event); } catch (e) { return reply(400, { error: 'Bad request' }); }
  try {
    connectLambda(event);
    const u = await needUser(b);
    if (!u) return reply(401, { error: 'Sign in first.' });
    const store = getStore('gehenna-notebook');
    let list = (await store.get(u.id, { type: 'json' })) || [];
    const done = async (extra) => { await store.setJSON(u.id, list); return reply(200, Object.assign({ chapters: list }, extra || {})); };

    if (!b.action || b.action === 'list') return reply(200, { chapters: list });
    if (b.action === 'save') {
      const inc = b.chapter || {}, i = ID.test(String(inc.id || '')) ? list.findIndex((c) => c.id === inc.id) : -1;
      if (i < 0 && list.length >= MAX_CHAPTERS) return reply(400, { error: 'That is enough chapters (' + MAX_CHAPTERS + ').' });
      const ch = { id: i >= 0 ? list[i].id : crypto.randomUUID(), title: S(inc.title, 100), body: S(inc.body, 30000), updatedAt: new Date().toISOString() };
      if (i >= 0) list[i] = ch; else list.push(ch);
      return done({ chapter: ch });
    }
    if (b.action === 'delete') { list = list.filter((c) => c.id !== String(b.id)); return done(); }
    if (b.action === 'move') {
      const i = list.findIndex((c) => c.id === String(b.id)), j = i + (b.dir === 'up' ? -1 : 1);
      if (i >= 0 && j >= 0 && j < list.length) { const t = list[i]; list[i] = list[j]; list[j] = t; }
      return done();
    }
    return reply(400, { error: 'Unknown action' });
  } catch (e) { return reply(502, { error: 'Server error: ' + e.message }); }
};
