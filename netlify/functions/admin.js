// Admin API for the Gehenna site. Reads and deletes Netlify Forms submissions.
// Needs env vars: NETLIFY_TOKEN (personal access token) and ADMIN_PASSWORD.
const crypto = require('crypto');
const API = 'https://api.netlify.com/api/v1';
const FORM = process.env.FORM_NAME || 'gehenna-sheet';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'pleasenevercookagain@gmail.com').trim().toLowerCase();

function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const reply = (status, obj) => ({ statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
async function nf(path, opts) {
  const r = await fetch(API + path, Object.assign({ headers: { Authorization: 'Bearer ' + process.env.NETLIFY_TOKEN } }, opts));
  if (!r.ok) throw new Error('Netlify API ' + r.status);
  return r.status === 204 ? null : r.json();
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  if (!process.env.NETLIFY_TOKEN || !process.env.ADMIN_PASSWORD) return reply(500, { error: 'Admin is not set up yet (missing environment variables).' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch (e) { return reply(400, { error: 'Bad request' }); }
  const okEmail = same(String(b.email || '').trim().toLowerCase(), ADMIN_EMAIL);
  const okPass = same(b.password || '', process.env.ADMIN_PASSWORD);
  if (!(okEmail && okPass)) { await new Promise(r => setTimeout(r, 900)); return reply(401, { error: 'Wrong email or password.' }); }
  try {
    if (b.action === 'delete') {
      if (!/^[a-f0-9]{8,40}$/i.test(String(b.id || ''))) return reply(400, { error: 'Bad id' });
      await nf('/submissions/' + b.id, { method: 'DELETE' });
      return reply(200, { ok: true });
    }
    const siteId = process.env.SITE_ID || process.env.GEHENNA_SITE_ID;
    if (!siteId) return reply(500, { error: 'Site id not found. Add GEHENNA_SITE_ID in environment variables.' });
    const forms = await nf('/sites/' + siteId + '/forms');
    const form = forms.find(f => f.name === FORM);
    if (!form) return reply(200, { items: [] });
    const subs = await nf('/forms/' + form.id + '/submissions?per_page=100');
    return reply(200, { items: subs.map(s => ({ id: s.id, at: s.created_at, name: (s.data && s.data.name) || 'Unnamed soul', sheet: (s.data && s.data.sheet) || '' })) });
  } catch (e) { return reply(502, { error: 'Could not reach Netlify: ' + e.message }); }
};
