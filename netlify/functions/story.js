// Public storyline reader: the list of chapters, and the text of a chapter that is open.
// Locked chapters never leave the server, only their title does.
const { getStore, connectLambda } = require('@netlify/blobs');
const { loadAll, meta } = require('./lib/story');
const vn1 = require('./lib/vn1');
const reply = (status, obj) => ({ statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') return reply(405, { error: 'POST or GET only' });
  let b = {};
  try { b = event.httpMethod === 'POST' ? JSON.parse(event.body || '{}') : (event.queryStringParameters || {}); } catch (e) { return reply(400, { error: 'Bad request' }); }
  try {
    connectLambda(event);
    const all = await loadAll(getStore('gehenna-story'));
    const id = String(b.id || '');
    if (!id) return reply(200, { chapters: all.map(meta) });
    const c = all.find((x) => x.id === id);
    if (!c) return reply(404, { error: 'That chapter does not exist.' });
    if (c.locked) return reply(403, { error: 'This chapter is not open yet.' });
    const out = { id: c.id, title: c.title, body: c.body, images: c.images || [] };
    // Chapter 1 is a visual novel. Its script is only sent once the chapter is open.
    if (c.id === 'chapter-1') out.vn = vn1;
    return reply(200, { chapter: out });
  } catch (e) { return reply(502, { error: 'Server error: ' + e.message }); }
};
