// Shared helpers for the headmaster tools (map, market, chat, world).
// The headmaster signs in with the Secret ID + Secret Key (same as admin.js); a player signs in with their soul key.
const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const hash = (k) => crypto.createHash('sha256').update(String(k).trim().toUpperCase()).digest('hex');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'Mephisto').trim().toLowerCase();

const reply = (status, obj) => ({ statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });
const S = (v, n) => String(v == null ? '' : v).slice(0, n == null ? 4000 : n);
const N = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
const IMG = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/;
const ID = /^[a-zA-Z0-9-]{1,60}$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isAdmin(b) {
  return !!process.env.ADMIN_PASSWORD && same(String(b.email || '').trim().toLowerCase(), ADMIN_EMAIL) && same(b.password || '', process.env.ADMIN_PASSWORD);
}
// Returns { admin: true, id: 'hm' } or { admin: false, id: <character id> } or null.
async function who(b) {
  if (b.email || b.password) return isAdmin(b) ? { admin: true, id: 'hm' } : null;
  const key = String(b.key || '').trim();
  if (key.length < 10 || key.length > 40) return null;
  const id = await getStore('gehenna-keys').get(hash(key));
  return id ? { admin: false, id } : null;
}
async function needUser(b) {
  const u = await who(b);
  if (!u) { await sleep(900); return null; }
  return u;
}
// Whole-number karma from the free text field ("1,000", "-5"). Anything else counts as 0.
function karmaOf(c) { const m = /-?\d[\d,]*/.exec(String(c.karma || '')); return m ? parseInt(m[0].replace(/,/g, ''), 10) || 0 : 0; }

// Negative karma is debt. Moves it into the debt balance (karma becomes 0). Returns true if the character changed.
function settle(c) { const k = karmaOf(c); if (k >= 0) return false; c.debt = Math.min(1e9, (Number(c.debt) || 0) - k); c.karma = '0'; return true; }

function parseBody(event) {
  if (event.httpMethod === 'POST') return JSON.parse(event.body || '{}');
  return event.queryStringParameters || {};
}
function imageReply(dataUrl, maxAge) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return reply(404, { error: 'No image' });
  return { statusCode: 200, isBase64Encoded: true, headers: { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=' + (maxAge || 86400) }, body: m[2] };
}

module.exports = { settle, reply, S, N, IMG, ID, sleep, isAdmin, who, needUser, karmaOf, parseBody, imageReply, hash };
