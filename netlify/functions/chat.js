// Chat: an OOC room, an RP room, private messages, group chats and NPC chats.
//  - Players show up by their first name. Players cannot rename themselves or change their icon (it is their character's);
//    only the headmaster can edit her own profile.
//  - Unread messages ("the ping") are kept on the server per person, so they survive logging out and in.
//    They go away when the person opens the conversation, or presses X on the ping (until the next new message).
//  - Group chats: players and the headmaster can make them. The headmaster can read every group chat without being listed
//    in it (players cannot see that), but she can only write in groups she was added to or made herself.
//    Each member can set their own name inside a group.
//  - NPC chats: the headmaster makes an NPC contactable (for everyone or chosen players). The player writes to the NPC,
//    the headmaster answers as that NPC.
//  - Hidden players: the headmaster can hide a player from everyone else's contacts (e.g. not in the story yet).
//  Chat logs are deleted at the start of every month.
const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');
const { reply, S, IMG, ID, needUser, parseBody, imageReply } = require('./lib/auth');

const ymOf = (d) => (d || new Date()).toISOString().slice(0, 7);
// Players appear by their first name only. The headmaster's display name is whatever she typed.
const first = (n) => String(n || '').trim().split(/\s+/)[0].slice(0, 30) || '?';
const display = (n) => String(n || '').trim().slice(0, 30) || 'Headmaster';
const pad = (n) => String(n).padStart(13, '0');
const GID = /^[a-f0-9]{12}$/;
const NID = /^[a-f0-9-]{8,40}$/i;
const jget = (store, key) => store.get(key, { type: 'json' }).catch(() => null);

async function characters(cstore) {
  const { blobs } = await cstore.list();
  const all = await Promise.all(blobs.map((b) => jget(cstore, b.key)));
  return all.filter((c) => c && c.id && c.name);
}
async function profile(store) { return (await jget(store, 'hm-profile')) || { name: 'Headmaster', image: '', at: 0 }; }

// Once a month, drop everything written in earlier months.
async function monthlyCleanup(store) {
  const ym = ymOf();
  const meta = await jget(store, 'meta');
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

// ---- the ping: unread counts per conversation, plus a flag the person can switch off with the X ----
// inbox = { <conversation key>: count, _off: true }.  Keys: <person id> (private), gc:<gid>, npc:<npcId> (player side), npc:<npcId>:<playerId> (headmaster side).
const counts = (inbox) => { const o = {}; Object.keys(inbox || {}).forEach((k) => { if (k !== '_off' && inbox[k] > 0) o[k] = inbox[k]; }); return o; };
const total = (inbox) => Object.values(counts(inbox)).reduce((a, b) => a + b, 0);
const pingOn = (inbox) => !(inbox && inbox._off) && total(inbox) > 0;
async function bump(store, id, key) {
  const inbox = (await jget(store, 'in/' + id)) || {};
  inbox[key] = (inbox[key] || 0) + 1; delete inbox._off;
  return store.setJSON('in/' + id, inbox);
}
// Remember who a person has talked to, so the list is still there after logging out and in.
async function remember(store, id, tag) {
  const th = (await jget(store, 'th/' + id)) || [];
  if (th[0] === tag) return;
  const next = [tag].concat(th.filter((x) => x !== tag)).slice(0, 80);
  return store.setJSON('th/' + id, next);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') return reply(405, { error: 'POST or GET only' });
  let b; try { b = parseBody(event); } catch (e) { return reply(400, { error: 'Bad request' }); }
  try {
    connectLambda(event);
    const store = getStore('gehenna-chat'), cstore = getStore('gehenna-characters'), rstore = getStore('gehenna-registry');

    // Pictures: character icons, the headmaster's icon, NPC icons and images posted in chat. Their ids are unguessable.
    if (event.httpMethod === 'GET') {
      if (b.avatar) {
        const id = String(b.avatar);
        if (id === 'hm') { const p = await profile(store); return p.image ? imageReply(p.image, 300) : reply(404, { error: 'No image' }); }
        if (id.startsWith('npc_')) { // only NPCs the headmaster made contactable
          const nid = id.slice(4), reg = (await jget(store, 'npc-contacts')) || { npcs: {} };
          const e = NID.test(nid) && reg.npcs[nid] && await jget(rstore, nid);
          return e && e.image ? imageReply(e.image, 300) : reply(404, { error: 'No image' });
        }
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

    // The light call the ping uses (every few seconds, on any tab): two small reads.
    if (b.action === 'ping') { const inbox = (await jget(store, 'in/' + u.id)) || {}; return reply(200, { ping: pingOn(inbox), n: total(inbox) }); }
    if (b.action === 'dismiss') { // the X: hides the ping until something new arrives
      const inbox = (await jget(store, 'in/' + u.id)) || {};
      if (!inbox._off) { inbox._off = true; await store.setJSON('in/' + u.id, inbox); }
      return reply(200, { ok: true });
    }

    const [hiddenDoc, npcDoc] = await Promise.all([jget(store, 'hidden'), jget(store, 'npc-contacts')]);
    const hidden = new Set((hiddenDoc && hiddenDoc.ids) || []);
    const npcs = (npcDoc && npcDoc.npcs) || {};
    const meHidden = !u.admin && hidden.has(u.id);
    const npcOpenTo = (nid, pid) => !!npcs[nid] && (npcs[nid].all === true || (npcs[nid].to || []).includes(pid));
    const npcCard = (nid) => ({ id: nid, name: S(npcs[nid].name, 60) || 'NPC', avatar: npcs[nid].hasImage ? '/.netlify/functions/chat?avatar=npc_' + nid + '&v=' + (npcs[nid].at || 0) : '' });

    // Who a player is allowed to see and write to.
    const canReach = (id) => u.admin || id === 'hm' || (!meHidden && !hidden.has(id));

    // Characters carry pictures, so they are only read when needed (the poll every few seconds must stay light).
    const charCache = {};
    const getChar = async (id) => { id = String(id || ''); if (!ID.test(id)) return null; if (!(id in charCache)) charCache[id] = await jget(cstore, id); return charCache[id] && charCache[id].id ? charCache[id] : null; };
    const exists = async (id) => id === 'hm' || !!(await getChar(id));
    const hmProf = await profile(store);
    const charCard = (c) => ({ id: c.id, name: first(c.name), avatar: c.image ? '/.netlify/functions/chat?avatar=' + c.id + '&v=' + Date.parse(c.updatedAt || 0) : '' });
    const hmCard = () => ({ id: 'hm', name: display(hmProf.name), avatar: hmProf.image ? '/.netlify/functions/chat?avatar=hm&v=' + (hmProf.at || 0) : '', headmaster: true });
    const cardOf = async (id) => { if (id === 'hm') return hmCard(); const c = await getChar(id); return c ? charCard(c) : { id, name: '?', avatar: '' }; };

    // ---- group chats ----
    const allGroups = async () => {
      const { blobs } = await store.list({ prefix: 'gc/' });
      return (await Promise.all(blobs.map((x) => jget(store, x.key)))).filter((g) => g && g.id);
    };
    const gcView = (g, watch) => ({ id: g.id, name: g.name, members: g.members, nick: g.nick || {}, watch: !!watch, by: g.by });
    // Players: only groups they are in. Headmaster: every group, marked "watch" when she is not a member (players never see that).
    const groupRole = (g) => g.members.includes(u.id) ? 'member' : (u.admin ? 'watch' : null);
    const loadGroup = async (gid) => { const g = GID.test(String(gid || '')) && await jget(store, 'gc/' + gid); return g && g.id ? g : null; };
    const cleanIds = async (ids) => {
      const uniq = [...new Set((Array.isArray(ids) ? ids : []).map(String))].slice(0, 60);
      const ok = await Promise.all(uniq.map((x) => exists(x)));
      return uniq.filter((x, i) => ok[i] && x !== u.id && canReach(x));
    };

    // ---- which conversation this request is about ----
    const resolve = async () => {
      if (b.channel === 'ooc' || b.channel === 'rp') return { ch: b.channel, kind: 'room', canSend: true };
      if (b.gid) {
        const g = await loadGroup(b.gid); if (!g) return { err: 'That group does not exist.' };
        const role = groupRole(g); if (!role) return { err: 'That group does not exist.' };
        return { ch: 'gc_' + g.id, kind: 'gc', g, role, canSend: role === 'member', from: u.id, inboxKey: 'gc:' + g.id, notify: g.members.filter((m) => m !== u.id).map((m) => [m, 'gc:' + g.id]) };
      }
      if (b.npc) {
        const nid = String(b.npc); if (!NID.test(nid) || !npcs[nid]) return { err: 'That NPC is not available.' };
        if (u.admin) {
          const pid = String(b.with || ''); if (pid === 'hm' || !(await getChar(pid))) return { err: 'Pick which player this NPC is talking to.' };
          return { ch: 'npc_' + nid + '_' + pid, kind: 'npc', nid, pid, canSend: true, from: 'npc:' + nid, inboxKey: 'npc:' + nid + ':' + pid, notify: [[pid, 'npc:' + nid]] };
        }
        if (!npcOpenTo(nid, u.id)) return { err: 'That NPC is not available.' };
        return { ch: 'npc_' + nid + '_' + u.id, kind: 'npc', nid, pid: u.id, canSend: true, from: u.id, inboxKey: 'npc:' + nid, notify: [['hm', 'npc:' + nid + ':' + u.id]] };
      }
      const w = String(b.with || '');
      if (!ID.test(w) || w === u.id) return { err: 'Pick who to talk to.' };
      if (!(await exists(w)) || (!u.admin && !canReach(w))) return { err: 'Pick who to talk to.' };
      return { ch: 'pm_' + [u.id, w].sort().join('_'), kind: 'pm', canSend: true, from: u.id, inboxKey: w, notify: [[w, u.id]] };
    };

    // ---------- lists ----------
    if (b.action === 'members') {
      const inbox = (await jget(store, 'in/' + u.id)) || {};
      const chars = await characters(cstore);
      let list = chars.filter((c) => u.admin || c.id === u.id || canReach(c.id)).map((c) => Object.assign(charCard(c), u.admin ? { hidden: hidden.has(c.id) } : {}));
      list.unshift(hmCard());
      const th = (await jget(store, 'th/' + u.id)) || [];
      const groups = (await allGroups()).map((g) => ({ g, role: groupRole(g) })).filter((x) => x.role).map((x) => gcView(x.g, x.role === 'watch'));
      // NPCs: a player sees the ones open to them; the headmaster sees every contactable NPC.
      const npcList = Object.keys(npcs).filter((nid) => u.admin || npcOpenTo(nid, u.id)).map(npcCard);
      // People that show up in a group, even if they are not in this person's contacts (e.g. a hidden player added by the headmaster).
      const extra = {};
      const missing = [...new Set([].concat(...groups.map((g) => g.members)))].filter((m) => !list.some((x) => x.id === m));
      (await Promise.all(missing.map((m) => cardOf(m)))).forEach((cd) => { extra[cd.id] = cd; });
      return reply(200, { me: u.id, admin: u.admin, members: list.concat(Object.values(extra)), contactIds: list.map((x) => x.id), unread: counts(inbox), ping: pingOn(inbox), n: total(inbox), threads: th, groups, npcs: npcList, hidden: u.admin ? [...hidden] : undefined });
    }
    if (b.action === 'setprofile') {
      if (!u.admin) return reply(403, { error: 'Only the headmaster can edit her profile.' });
      const p = await profile(store);
      p.name = display(b.name === undefined ? p.name : b.name);
      if (b.image === '') p.image = ''; else if (typeof b.image === 'string' && IMG.test(b.image) && b.image.length < 200000) p.image = b.image;
      p.at = Date.now(); await store.setJSON('hm-profile', p);
      return reply(200, { ok: true });
    }

    const cleanPlayers = async (ids) => { const uniq = [...new Set((Array.isArray(ids) ? ids : []).map(String))].slice(0, 200); const ok = await Promise.all(uniq.map((x) => x !== 'hm' && getChar(x))); return uniq.filter((x, i) => ok[i]); };

    // ---------- headmaster tools ----------
    if (b.action === 'sethidden') {
      if (!u.admin) return reply(403, { error: 'Only the headmaster can do that.' });
      const id = String(b.id || ''); if (id === 'hm' || !(await getChar(id))) return reply(400, { error: 'Unknown player.' });
      if (b.hidden) hidden.add(id); else hidden.delete(id);
      await store.setJSON('hidden', { ids: [...hidden] });
      return reply(200, { ok: true, hidden: [...hidden] });
    }
    if (b.action === 'npcmanage') { // every NPC in the registry, with who may contact it
      if (!u.admin) return reply(403, { error: 'Only the headmaster can do that.' });
      const { blobs } = await rstore.list();
      const all = (await Promise.all(blobs.map((x) => jget(rstore, x.key)))).filter((e) => e && e.type === 'npc' && e.id);
      let changed = false;
      const out = all.sort((a, c) => String(a.name).localeCompare(String(c.name))).map((e) => {
        const cur = npcs[e.id];
        if (cur) { const at = Date.parse(e.updatedAt || 0) || 0, nm = S(e.name, 60); if (cur.name !== nm || cur.at !== at || cur.hasImage !== !!e.image) { cur.name = nm; cur.at = at; cur.hasImage = !!e.image; changed = true; } }
        return { id: e.id, name: S(e.name, 60) || 'NPC', avatar: e.image ? (cur ? '/.netlify/functions/chat?avatar=npc_' + e.id + '&v=' + (cur.at || 0) : '/.netlify/functions/registry?img=' + e.id + '&v=' + (Date.parse(e.updatedAt || 0) || 0)) : '', hasImage: !!e.image, on: !!cur, all: !!(cur && cur.all), to: cur ? cur.to || [] : [] };
      });
      if (changed) await store.setJSON('npc-contacts', { npcs });
      return reply(200, { ok: true, npcs: out });
    }
    if (b.action === 'npcset') {
      if (!u.admin) return reply(403, { error: 'Only the headmaster can do that.' });
      const nid = String(b.npc || ''); const e = NID.test(nid) && await jget(rstore, nid);
      if (!e || e.type !== 'npc') return reply(400, { error: 'Unknown NPC.' });
      if (!b.on) delete npcs[nid];
      else npcs[nid] = { name: S(e.name, 60), hasImage: !!e.image, at: Date.parse(e.updatedAt || 0) || 0, all: b.all === true, to: (await cleanPlayers(b.to)) };
      await store.setJSON('npc-contacts', { npcs });
      return reply(200, { ok: true });
    }

    // ---------- group chat management ----------
    if (b.action === 'gccreate') {
      const ids = await cleanIds(b.ids);
      if (!ids.length && !u.admin) return reply(400, { error: 'Pick at least one person.' });
      const g = { id: crypto.randomBytes(6).toString('hex'), name: S(b.name, 40).trim() || 'Group chat', by: u.id, members: [u.id].concat(ids).slice(0, 40), nick: {}, at: Date.now() };
      await store.setJSON('gc/' + g.id, g);
      return reply(200, { ok: true, gc: gcView(g, false) });
    }
    if (['gcadd', 'gcrename', 'gcnick', 'gcleave'].includes(b.action)) {
      const g = await loadGroup(b.gid);
      if (!g || !g.members.includes(u.id)) return reply(404, { error: 'That group does not exist.' });
      if (b.action === 'gcadd') {
        const ids = (await cleanIds(b.ids)).filter((x) => !g.members.includes(x));
        g.members = g.members.concat(ids).slice(0, 40);
      } else if (b.action === 'gcrename') {
        g.name = S(b.name, 40).trim() || g.name;
      } else if (b.action === 'gcnick') {
        g.nick = g.nick || {}; const n = S(b.nick, 30).trim();
        if (n) g.nick[u.id] = n; else delete g.nick[u.id];
      } else { // leave
        g.members = g.members.filter((x) => x !== u.id); if (g.nick) delete g.nick[u.id];
        const inbox = (await jget(store, 'in/' + u.id)) || {}; if (inbox['gc:' + g.id]) { delete inbox['gc:' + g.id]; await store.setJSON('in/' + u.id, inbox); }
        if (!g.members.length) { await store.delete('gc/' + g.id).catch(() => {}); return reply(200, { ok: true, left: true }); }
        await store.setJSON('gc/' + g.id, g); return reply(200, { ok: true, left: true });
      }
      await store.setJSON('gc/' + g.id, g);
      return reply(200, { ok: true, gc: gcView(g, false) });
    }

    // ---------- reading and writing a conversation ----------
    const rv = await resolve();
    if (rv.err) return reply(400, { error: rv.err });
    const prefix = 'm/' + rv.ch + '/';

    if (b.action === 'history') {
      let keys = (await store.list({ prefix })).blobs.map((x) => x.key).sort();
      keys = b.after ? keys.filter((k) => k > String(b.after)) : keys.slice(-60);
      const msgs = (await Promise.all(keys.map((k) => store.get(k, { type: 'json' }).then((m) => m && Object.assign(m, { k })).catch(() => null)))).filter(Boolean);
      // Opening a conversation clears its unread count (the headmaster only watching a group has none).
      if (rv.inboxKey) {
        const inbox = (await jget(store, 'in/' + u.id)) || {};
        if (inbox[rv.inboxKey]) { delete inbox[rv.inboxKey]; await store.setJSON('in/' + u.id, inbox); }
      }
      const out = { msgs, canSend: rv.canSend };
      if (rv.kind === 'gc') {
        out.gc = gcView(rv.g, rv.role === 'watch');
        if (!b.after) { // names and pictures of everyone in the group, once, when it is opened
          const ids = [...new Set(rv.g.members.concat(msgs.map((m) => m.from)))].filter((id) => !String(id).startsWith('npc:'));
          out.people = {}; (await Promise.all(ids.map((id) => cardOf(id)))).forEach((cd) => { out.people[cd.id] = cd; });
        }
      }
      if (rv.kind === 'npc') { out.npc = npcCard(rv.nid); if (!b.after) out.people = { [rv.pid]: await cardOf(rv.pid) }; }
      return reply(200, out);
    }
    if (b.action === 'send') {
      if (!rv.canSend) return reply(403, { error: 'You can only read this chat.' });
      const text = S(b.text, 500).trim(), image = typeof b.image === 'string' && IMG.test(b.image) && b.image.length < 180000 ? b.image : '';
      if (!text && !image) return reply(400, { error: 'Write something first.' });
      const ym = ymOf(), id = crypto.randomBytes(8).toString('hex'), ts = Date.now(), k = prefix + ym + '/' + pad(ts) + '-' + id;
      const ops = [monthlyCleanup(store), store.setJSON(k, { from: rv.from || u.id, text, img: image ? ym + '_' + id : '', ts })];
      if (image) ops.push(store.set('i/' + ym + '/' + id, image));
      (rv.notify || []).forEach(([to, key]) => ops.push(bump(store, to, key)));
      // So the conversation is still in the list after logging out and in.
      if (rv.kind === 'pm') { const w = String(b.with); ops.push(remember(store, u.id, 'u:' + w), remember(store, w, 'u:' + u.id)); }
      if (rv.kind === 'npc') {
        ops.push(remember(store, rv.pid, 'n:' + rv.nid), remember(store, 'hm', 'n:' + rv.nid + ':' + rv.pid));
        // If the headmaster starts the talk, that player can now see the NPC.
        if (u.admin && npcs[rv.nid] && !npcs[rv.nid].all && !(npcs[rv.nid].to || []).includes(rv.pid)) { npcs[rv.nid].to = (npcs[rv.nid].to || []).concat(rv.pid); ops.push(store.setJSON('npc-contacts', { npcs })); }
      }
      await Promise.all(ops); // all at once, so sending stays quick
      return reply(200, { ok: true, k });
    }
    return reply(400, { error: 'Unknown action' });
  } catch (e) { return reply(502, { error: 'Server error: ' + e.message }); }
};
