/* Gehenna hub: the section tabs (Character details / Map / Marketplace / Chat / Notebook) shared by the headmaster and the players,
   plus the public World registry (Locations and Items). Talks to /.netlify/functions/{map,market,chat,world}.
   Relies on window.GEH, which the login script in index.html sets up. */
(function () {
  'use strict';
  var G = window.GEH;
  if (!G) return;
  var h = G.h;
  var $ = function (id) { return document.getElementById(id); };
  var FN = '/.netlify/functions/';

  /* ---------- helpers ---------- */
  function authBody() { var c = G.creds(); if (c) return c; var k = G.pkey(); return k ? { key: k } : null; }
  function raw(fn, body) {
    return fetch(FN + fn, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .catch(function () { return { ok: false, j: { error: 'Could not reach the server.' } }; });
  }
  function call(fn, body) {
    var a = authBody();
    return a ? raw(fn, Object.assign({}, a, body)) : Promise.resolve({ ok: false, j: { error: 'Sign in first.' } });
  }
  function clear(n) { n.textContent = ''; return n; }
  function note(text, cls) { return h('p', { className: cls || 'mono hb-note', text: text }); }
  // Any picture file -> a JPEG that is at most maxSide pixels wide or tall and under maxLen characters.
  function shrink(file, maxSide, maxLen, cb) {
    var fr = new FileReader();
    fr.onload = function () {
      var im = new Image();
      im.onerror = function () { cb(null); };
      im.onload = function () {
        var s = Math.min(1, maxSide / Math.max(im.width, im.height)), w = Math.max(1, Math.round(im.width * s)), hh = Math.max(1, Math.round(im.height * s));
        var cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
        var x = cv.getContext('2d'); x.fillStyle = '#0d0b0c'; x.fillRect(0, 0, w, hh); x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, w, hh);
        var q = 0.88, out = '';
        for (var n = 0; n < 7; n++) { out = cv.toDataURL('image/jpeg', q); if (out.length < maxLen) break; q -= 0.1; }
        cb(out.length < maxLen ? out : null);
      };
      im.src = fr.result;
    };
    fr.onerror = function () { cb(null); };
    fr.readAsDataURL(file);
  }
  function thumb(url, letter, cls) {
    var d = h('div', { className: 'hb-thumb ' + (cls || '') });
    if (url) { var i = h('img', { src: url, alt: '', loading: 'lazy' }); i.onerror = function () { i.remove(); d.textContent = letter || '?'; }; d.appendChild(i); } else d.textContent = letter || '?';
    return d;
  }


  /* ---------- buffs and debuffs (shared by the skill editor, the item editor and the Effects tab) ---------- */
  var FXS = ['STR', 'INT', 'DEX', 'WIS', 'CHA', 'CON', 'HP', 'Armor', 'Speed', 'Initiative', 'Other'];
  function fxText(e) { return (e.stat === 'Other' ? e.note : (e.kind === 'debuff' || e.amt < 0 ? '-' : '+') + Math.abs(e.amt) + ' ' + e.stat + (e.note ? ' (' + e.note + ')' : '')) + (e.perm ? ' (permanent)' : ' (until ended)'); }
  // Rows for writing buffs and debuffs: Buff/Debuff, which stat, how much, permanent or until the headmaster ends it, and a note.
  G.fxEditor = function (list, redraw) {
    var box = h('div', { className: 'fxs' });
    list.forEach(function (e, i) {
      var k = h('select', { 'aria-label': 'Buff or debuff' }, [['buff', 'Buff'], ['debuff', 'Debuff']].map(function (o) { return h('option', { value: o[0], text: o[1], selected: (e.kind || 'buff') === o[0] }); })); k.onchange = function () { e.kind = k.value; };
      var st = h('select', { 'aria-label': 'Stat' }, FXS.map(function (n) { return h('option', { value: n, text: n === 'Other' ? 'Other (sense, text)' : n, selected: (e.stat || 'STR') === n }); })); st.onchange = function () { e.stat = st.value; redraw(); };
      var am = h('input', { type: 'number', min: 0, value: e.amt || 0, className: 'ni', 'aria-label': 'Amount' }); am.oninput = function () { e.amt = Math.max(0, Math.floor(+am.value) || 0); };
      var du = h('select', { 'aria-label': 'How long' }, [['0', 'Until I end it'], ['1', 'Permanent']].map(function (o) { return h('option', { value: o[0], text: o[1], selected: !!e.perm === (o[0] === '1') }); })); du.onchange = function () { e.perm = du.value === '1'; };
      var nt = h('input', { value: e.note || '', maxLength: 120, placeholder: e.stat === 'Other' ? 'Describe it (e.g. Darkvision 60 ft)' : 'Note (optional)', 'aria-label': 'Note' }); nt.oninput = function () { e.note = nt.value; };
      var x = h('button', { type: 'button', className: 'link', text: 'Remove' }); x.onclick = function () { list.splice(i, 1); redraw(); };
      box.appendChild(h('div', { className: 'ef' }, [k, st, am, du, nt, x]));
    });
    var add = h('button', { type: 'button', className: 'btn', text: '+ Add buff or debuff' }); add.onclick = function () { list.push({ kind: 'buff', stat: 'STR', amt: 1, perm: false, note: '' }); redraw(); };
    box.appendChild(add); return box;
  };

  // Rows for dice an item rolls when used (heal, damage...). Same idea as a skill's effects: type, number of dice, sides, flat bonus, optional stat modifier.
  G.diceEditor = function (list, redraw) {
    var box = h('div', { className: 'fxs' });
    list.forEach(function (e, i) {
      var ty = h('select', { 'aria-label': 'Type' }, ['Damage', 'Heal', 'Shield', 'Other'].map(function (n) { return h('option', { value: n, text: n, selected: (e.type || 'Heal') === n }); })); ty.onchange = function () { e.type = ty.value; };
      function num(k, label, min) { var x = h('input', { type: 'number', min: min, value: e[k] == null ? 0 : e[k], className: 'ni', 'aria-label': label }); x.oninput = function () { e[k] = Math.floor(+x.value) || 0; }; return x; }
      var st = h('select', { 'aria-label': 'Adds the modifier of' }, [['', 'No stat']].concat(['STR', 'INT', 'DEX', 'WIS', 'CHA', 'CON'].map(function (n) { return [n, '+ ' + n + ' modifier']; })).map(function (o) { return h('option', { value: o[0], text: o[1], selected: (e.stat || '') === o[0] }); })); st.onchange = function () { e.stat = st.value; };
      var nt = h('input', { value: e.note || '', maxLength: 120, placeholder: 'Note (optional)', 'aria-label': 'Note' }); nt.oninput = function () { e.note = nt.value; };
      var x = h('button', { type: 'button', className: 'link', text: 'Remove' }); x.onclick = function () { list.splice(i, 1); redraw(); };
      box.appendChild(h('div', { className: 'ef' }, [ty, num('n', 'Number of dice', 0), 'd', num('d', 'Sides', 0), '+', num('flat', 'Flat bonus', -999), st, nt, x]));
    });
    var add = h('button', { type: 'button', className: 'btn', text: '+ Add heal or damage dice' }); add.onclick = function () { list.push({ type: 'Heal', n: 1, d: 4, flat: 0, stat: '', note: '' }); redraw(); };
    box.appendChild(add); return box;
  };

  /* ---------- section tabs ---------- */
  /* ---------- fixed effects library (poison, stun, corruption...) ---------- */
  G.statuses = [];
  G.loadStatuses = function () { return call('effects', { action: 'list' }).then(function (r) { if (r.ok && r.j.statuses) { G.statuses.length = 0; r.j.statuses.forEach(function (x) { G.statuses.push(x); }); } return r; }); };

  /* ---------- "what just happened" pop-ups for items: big, obvious, one line per change ---------- */
  function overlay(label, kids, onClose) {
    var prev = document.activeElement, back = h('div', { className: 'ur-back' }), card = h('div', { className: 'ur-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, kids);
    function close() { document.removeEventListener('keydown', key, true); back.remove(); if (prev && prev.focus) try { prev.focus(); } catch (e) { } if (onClose) onClose(); }
    function key(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } }
    back.onclick = function (ev) { if (ev.target === back) close(); };
    document.addEventListener('keydown', key, true);
    back.appendChild(card); document.body.appendChild(back);
    return { close: close, card: card };
  }
  G.showResult = function (item, changes) {
    var lines = changes.map(function (x) {
      if (x.kind === 'stat') return h('div', { className: 'ur-line stat' }, [h('span', { className: 'ur-tag', text: x.random ? 'Random stat' : 'Stat raised' }), h('div', { className: 'ur-statrow' }, [h('b', { className: 'ur-big', text: x.stat }), h('span', { className: 'ur-num', text: x.from + ' → ' + x.to }), h('span', { className: 'ur-up', text: '+' + x.amt + ' forever' })])]);
      if (x.kind === 'heal' || x.kind === 'damage') {
        var pct = x.max > 0 ? Math.max(0, Math.min(100, (x.to / x.max) * 100)) : 0;
        return h('div', { className: 'ur-line ' + x.kind }, [h('span', { className: 'ur-tag', text: x.kind === 'heal' ? 'Healed' : 'Damage' }), h('div', { className: 'ur-statrow' }, [h('b', { className: 'ur-big', text: (x.kind === 'heal' ? '+' : '−') + Math.abs(x.to - x.from) + ' HP' }), h('span', { className: 'ur-num', text: x.from + ' → ' + x.to + ' / ' + x.max })]), h('div', { className: 'ur-bar' }, [h('i', { style: 'width:' + pct + '%' })])]);
      }
      if (x.kind === 'cleanse') return h('div', { className: 'ur-line cleanse' }, [h('span', { className: 'ur-tag', text: 'Cured' }), h('b', { className: 'ur-med', text: x.text.replace(/^Cured:\s*/, '') })]);
      if (x.kind === 'buff') return h('div', { className: 'ur-line ' + (x.bad ? 'damage' : 'buff') }, [h('span', { className: 'ur-tag', text: x.bad ? 'Debuff' : 'Buff' }), h('b', { className: 'ur-med', text: x.text })]);
      return h('div', { className: 'ur-line' }, [h('span', { className: 'mono', text: x.text })]);
    });
    var ok = h('button', { type: 'button', className: 'btn primary', text: 'OK' }), o;
    ok.onclick = function () { o.close(); };
    o = overlay('Item used', [h('p', { className: 'mono red', text: 'Item used' }), h('h3', { text: item })].concat(lines, [ok]));
    ok.focus();
  };
  // Items that let the player choose which stat to raise.
  G.pickStat = function (item, onPick) {
    var up = item.statUp, o, btns = up.stats.map(function (s) {
      var b = h('button', { type: 'button', className: 'btn ur-pick' }, [h('b', { text: s.k }), h('span', { className: 'mono', text: s.score + ' → ' + (s.score + up.amt) })]);
      b.onclick = function () { o.close(); onPick(s.k); }; return b;
    }), cancel = h('button', { type: 'button', className: 'btn', text: 'Cancel' });
    cancel.onclick = function () { o.close(); };
    o = overlay('Choose a stat', [h('p', { className: 'mono red', text: item.name }), h('h3', { text: 'Which stat do you want to raise by +' + up.amt + '?' }), h('p', { className: 'mono hb-note', text: 'This is permanent. It cannot be undone.' }), h('div', { className: 'ur-picks' }, btns), cancel]);
    if (btns[0]) btns[0].focus();
  };

  var nav = $('adm-nav'), PANES = ['char', 'items', 'map', 'market', 'chat', 'note', 'dice', 'fx'], current = 'char', lastMode = '';
  var modules = {};
  function pane(name) {
    if (modules[current] && modules[current].leave) modules[current].leave();
    current = name;
    PANES.forEach(function (p) { var e = $('pane-' + p); if (e) e.hidden = p !== name; });
    Array.prototype.forEach.call(nav.querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-pane') === name)); });
    var act = nav.querySelector('button[aria-pressed="true"]'); if (act && act.scrollIntoView) { try { act.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (e) {} }
    if (modules[name] && modules[name].enter) modules[name].enter();
    var a = $('adm'); if (a) a.scrollTop = 0;
  }
  Array.prototype.forEach.call(nav.querySelectorAll('button'), function (b) { b.addEventListener('click', function () { pane(b.getAttribute('data-pane')); }); });
  G.onMode = function (m) {
    nav.hidden = m === 'login'; var fxb = $('nav-fx'); if (fxb) fxb.hidden = m !== 'admin';
    if (m === 'login') { stopPing(); if (modules[current] && modules[current].leave) modules[current].leave(); Object.keys(modules).forEach(function (k) { if (modules[k].reset) modules[k].reset(); }); current = 'char'; lastMode = m; return; }
    if (m !== lastMode) { lastMode = m; pane('char'); startPing(); }
  };
  $('adm-refresh').addEventListener('click', function () { if (current !== 'char' && modules[current] && modules[current].enter) modules[current].enter(true); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) return; if (modules[current] && modules[current].wake) modules[current].wake(); if (lastMode && lastMode !== 'login') pollPing(); });

  /* ======================= MAP ======================= */
  modules.map = (function () {
    var root = $('pane-map'), built = false, lobbies = [], curId = null, lob = null, timer = null, saveT = null, selTok = null, tab = 'shadow', q = '', snapMode = 'square', paint = { on: false, color: '#2ecc71', erase: false, fog: false }, fogPrev = false, markers = [];
    var ui = {}, zm = { s: 1, x: 0, y: 0 }, npcs = [], npcOpen = {};
    // Show or hide the names under the map tokens (on a phone they can cover a lot of the map). Remembered on this device.
    var namesOff = false;
    function namesOn() { try { var v = localStorage.getItem('gehenna-map-names'); return v === null ? !namesOff : v !== '0'; } catch (e) { return !namesOff; } }
    function applyNames() { var on = namesOn(); if (ui.box) ui.box.classList.toggle('nonames', !on); if (ui.names) { ui.names.textContent = on ? 'Names: on' : 'Names: off'; ui.names.setAttribute('aria-pressed', String(on)); } }
    function isDM() { return !!G.creds(); }
    function reset() { built = false; lobbies = []; curId = null; lob = null; selTok = null; npcs = []; npcOpen = {}; zm = { s: 1, x: 0, y: 0 }; clear(root); stop(); }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function start() { stop(); if (!isDM()) timer = setInterval(function () { if (!document.hidden) poll(); }, 5000); }

    function build() {
      clear(root); built = true;
      ui.tabs = h('div', { className: 'mp-tabs', role: 'tablist' });
      ui.status = h('span', { className: 'mono hb-note' });
      ui.names = h('button', { type: 'button', className: 'btn sq mp-names' });
      ui.names.onclick = function () { try { localStorage.setItem('gehenna-map-names', namesOn() ? '0' : '1'); } catch (e) { namesOff = !namesOff; } applyNames(); };
      ui.box = h('div', { className: 'mp-box' + (isDM() ? ' edit' : '') }); applyNames();
      ui.msg = h('p', { className: 'mono hb-note' }); ui.npcs = h('div', { className: 'mp-npcs' });
      ui.side = h('div', { className: 'mp-side' });
      root.appendChild(h('div', { className: 'hb-wrap' }, [
        h('div', { className: 'mp-head' }, [ui.tabs, ui.names, ui.status]),
        h('div', { className: 'mp-body' }, [h('div', { className: 'mp-stage' }, [ui.box, ui.msg, isDM() ? null : ui.npcs]), isDM() ? ui.side : null]),
      ]));
      if (window.ResizeObserver) new ResizeObserver(fit).observe(ui.box); else window.addEventListener('resize', fit);
      if (!isDM()) setupZoom();
    }
    function enter() { if (!built) build(); poll(true); start(); }
    function wake() { if (!isDM()) poll(); }

    function poll(first) {
      call('map', { action: 'poll' }).then(function (r) {
        if (!r.ok) { ui.msg.textContent = r.j.error || 'Could not load the maps.'; return; }
        lobbies = r.j.lobbies || [];
        var had = curId, meta = lobbies.filter(function (l) { return l.id === curId; })[0];
        if (!meta) { if (had && !isDM()) ui.msg.textContent = 'You are no longer in that lobby.'; curId = lobbies[0] ? lobbies[0].id : null; lob = null; selTok = null; }
        else if (!isDM() && lob && lob.rev !== meta.rev) lob = null;
        drawTabs();
        if (!curId) { drawBox(); if (!isDM()) ui.msg.textContent = 'You are not in any lobby yet. The headmaster adds you to one.'; return; }
        if (!lob || lob.id !== curId) fetchLobby(curId); else if (first) drawBox();
      });
    }
    function fetchLobby(id) {
      call('map', { action: 'get', id: id }).then(function (r) {
        if (id !== curId) return;
        if (!r.ok) { lob = null; ui.msg.textContent = r.j.error || 'Could not open that map.'; drawBox(); return; }
        ui.msg.textContent = isDM() ? '' : 'The map updates by itself. Zoom with + / −, pinch, or Ctrl + scroll. Tap a token to see who it is.';
        if (!lob || lob.id !== r.j.lobby.id) zm = { s: 1, x: 0, y: 0 };
        lob = r.j.lobby; drawBox(); if (isDM()) drawSide(); else loadNpcs();
      });
    }
    function drawTabs() {
      clear(ui.tabs);
      lobbies.forEach(function (l) {
        var b = h('button', { type: 'button', className: 'mp-tab', text: l.name, role: 'tab', 'aria-selected': String(l.id === curId) });
        b.onclick = function () { curId = l.id; lob = null; selTok = null; drawTabs(); drawBox(); fetchLobby(l.id); };
        ui.tabs.appendChild(b);
      });
      if (isDM()) { var add = h('button', { type: 'button', className: 'mp-tab add', text: '+ Lobby', 'aria-label': 'Add a lobby' }); add.onclick = addLobby; ui.tabs.appendChild(add); }
    }
    function addLobby() {
      call('map', { action: 'save', lobby: { name: 'Lobby ' + (lobbies.length + 1) } }).then(function (r) {
        if (!r.ok) { ui.msg.textContent = r.j.error || 'Could not add a lobby.'; return; }
        lobbies = r.j.lobbies; curId = r.j.lobby.id; lob = null; drawTabs(); fetchLobby(curId);
      });
    }

    /* the map box: picture, grid, tokens. Everything is positioned in fractions of the box, so players see exactly what the headmaster sees. */
    function fit() {
      zApply();
      if (!lob || !ui.grid) return; var w = ui.box.clientWidth, c = w * lob.cell / 100; ui.grid.style.backgroundSize = c + 'px ' + c + 'px';
      Object.keys(ui.tiles || {}).forEach(function (k) { layTile(ui.tiles[k], c); });
      Object.keys(ui.ftiles || {}).forEach(function (k) { layTile(ui.ftiles[k], c); });
    }
    /* coloured squares: they belong to the grid, so they follow the square size */
    function layTile(t, c) { var s = t.el.style; s.left = (t.col * c) + 'px'; s.top = (t.row * c) + 'px'; s.width = c + 'px'; s.height = c + 'px'; }
    function addTile(col, row, color) {
      var el = h('div', { className: 'mp-tile' }); el.style.background = color; ui.paint.appendChild(el);
      var t = { el: el, col: col, row: row }; ui.tiles[col + ',' + row] = t; layTile(t, ui.box.clientWidth * lob.cell / 100);
    }
    function setTile(col, row, color) {
      var k = col + ',' + row, cur = ui.tiles[k];
      if (cur) { if (color && cur.el.style.background && lob.cells.some(function (c) { return c[0] === col && c[1] === row && c[2] === color; })) return; cur.el.remove(); delete ui.tiles[k]; }
      lob.cells = lob.cells.filter(function (c) { return !(c[0] === col && c[1] === row); });
      if (color) { lob.cells.push([col, row, color]); addTile(col, row, color); }
    }
    /* hidden tiles: solid black over the picture and the tokens. The headmaster sees them see-through (with a dashed edge) so the map stays workable. */
    function addFog(col, row) {
      var el = h('div', { className: 'mp-fog' }); ui.fogl.appendChild(el);
      var t = { el: el, col: col, row: row }; ui.ftiles[col + ',' + row] = t; layTile(t, ui.box.clientWidth * lob.cell / 100);
    }
    function setFog(col, row, on) {
      var k = col + ',' + row, cur = ui.ftiles[k];
      if (!!cur === !!on) return;
      if (cur) { cur.el.remove(); delete ui.ftiles[k]; }
      lob.fog = (lob.fog || []).filter(function (c) { return !(c[0] === col && c[1] === row); });
      if (on) { lob.fog.push([col, row]); addFog(col, row); }
      if (ui.fcnt) ui.fcnt.textContent = lob.fog.length + ' hidden';
    }
    function fogClasses() { if (!ui.box) return; ui.box.classList.toggle('fogoff', lob && lob.fogOn === false); ui.box.classList.toggle('fogprev', !!fogPrev); }
    function place(t, el) { el.style.left = (t.x * 100) + '%'; el.style.top = (t.y * 100) + '%'; el.style.width = (lob.cell * 0.9 * (lob.tokScale || 1) * (t.size || 1)) + '%'; }
    function drawBox() {
      clear(ui.box); ui.grid = null; ui.zoom = null;
      if (!lob) { npcs = []; drawNpcs(); ui.box.appendChild(h('div', { className: 'mp-empty' }, [h('p', { className: 'mono', text: curId ? 'Opening the map…' : (isDM() ? 'Add a lobby to begin.' : 'Nothing to show yet.') })])); return; }
      if (lob.image) ui.box.appendChild(h('img', { className: 'mp-img', src: lob.image, alt: '', draggable: false }));
      ui.img = ui.box.querySelector('.mp-img'); styleImg();
      lob.cells = lob.cells || [];
      ui.paint = h('div', { className: 'mp-paint' }); ui.paint.style.opacity = lob.tileAlpha || 0.4; ui.box.appendChild(ui.paint); ui.tiles = {};
      ui.grid = h('div', { className: 'mp-grid' }); ui.box.appendChild(ui.grid);
      lob.cells.forEach(function (c) { addTile(c[0], c[1], c[2]); });
      ui.box.classList.toggle('painting', isDM() && paint.on);
      lob.tokens.forEach(function (t) { ui.box.appendChild(tokenEl(t)); });
      lob.fog = lob.fog || []; ui.fogl = h('div', { className: 'mp-fogl' }); ui.box.appendChild(ui.fogl); ui.ftiles = {};
      lob.fog.forEach(function (c) { addFog(c[0], c[1]); }); fogClasses();
      if (!lob.image && isDM()) ui.box.appendChild(h('p', { className: 'mp-hint mono', text: 'Upload a map image on the right.' }));
      if (!isDM()) wrapZoom();
      fit();
    }
    function styleImg() { if (!ui.img) return; ui.img.style.width = (lob.imgScale * 100) + '%'; ui.img.style.left = (lob.imgX * 100) + '%'; ui.img.style.top = (lob.imgY * 100) + '%'; }
    function tokenEl(t) {
      var e = h('div', { className: 'mp-tok' + (t.id === selTok ? ' sel' : ''), title: t.label }, [thumb(t.img, (t.label || '?').charAt(0).toUpperCase(), 'tk'), h('span', { className: 'mp-lab', text: t.label })]);
      place(t, e); e.setAttribute('data-id', t.id);
      var rg = /^reg:([A-Za-z0-9-]+)$/.exec(String(t.src || '')); if (!isDM() && rg) { e.setAttribute('data-reg', rg[1]); e.classList.add('tap'); }
      if (isDM()) e.addEventListener('pointerdown', function (ev) { dragToken(ev, t, e); });
      return e;
    }
    function dragToken(ev, t, e) {
      ev.preventDefault(); ev.stopPropagation(); e.setPointerCapture(ev.pointerId);
      if (selTok !== t.id) { selTok = t.id; Array.prototype.forEach.call(ui.box.querySelectorAll('.mp-tok'), function (n) { n.classList.remove('sel'); }); e.classList.add('sel'); drawSide(); }
      var move = function (m) { var r = ui.box.getBoundingClientRect(); t.x = Math.max(0, Math.min(1, (m.clientX - r.left) / r.width)); t.y = Math.max(0, Math.min(1, (m.clientY - r.top) / r.height)); place(t, e); };
      var up = function () {
        e.removeEventListener('pointermove', move); e.removeEventListener('pointerup', up); e.removeEventListener('pointercancel', up);
        if (snapMode !== 'free') {
          var r = ui.box.getBoundingClientRect(), cx = lob.cell / 100, cy = cx * r.width / r.height;
          if (snapMode === 'fine') { t.x = Math.max(0, Math.min(1, Math.round(t.x / (cx / 4)) * cx / 4)); t.y = Math.max(0, Math.min(1, Math.round(t.y / (cy / 4)) * cy / 4)); }
          else {
            var gx = Math.floor(t.x / cx), gy = Math.floor(t.y / cy), spots = [[0, 0], [0.25, 0.25], [-0.25, 0.25], [0.25, -0.25], [-0.25, -0.25], [0, 0.3], [0.3, 0], [-0.3, 0], [0, -0.3]], pick = spots[0];
            // another token already in this square? sit beside it instead of hiding it
            for (var i = 0; i < spots.length; i++) {
              var px = (gx + 0.5 + spots[i][0]) * cx, py = (gy + 0.5 + spots[i][1]) * cy;
              if (!lob.tokens.some(function (o) { return o !== t && Math.abs(o.x - px) < cx * 0.12 && Math.abs(o.y - py) < cy * 0.12; })) { pick = spots[i]; break; }
            }
            t.x = Math.min(1, (gx + 0.5 + pick[0]) * cx); t.y = Math.min(1, (gy + 0.5 + pick[1]) * cy);
          }
          place(t, e);
        }
        save();
      };
      e.addEventListener('pointermove', move); e.addEventListener('pointerup', up); e.addEventListener('pointercancel', up);
    }
    function boxDown(ev) { if (!isDM() || !lob) return; if (paint.on) paintDown(ev); else dragImage(ev); }
    function paintDown(ev) {
      ev.preventDefault(); ui.box.setPointerCapture(ev.pointerId);
      var prev = null;
      var cellAt = function (m) { var r = ui.box.getBoundingClientRect(), c = ui.box.clientWidth * lob.cell / 100; return { x: m.clientX - r.left - ui.box.clientLeft, y: m.clientY - r.top - ui.box.clientTop, c: c, w: ui.box.clientWidth, h: ui.box.clientHeight }; };
      var hit = function (x, y, c, w, hh) { if (x < 0 || y < 0 || x >= w || y >= hh) return; if (paint.fog) setFog(Math.floor(x / c), Math.floor(y / c), !paint.erase); else setTile(Math.floor(x / c), Math.floor(y / c), paint.erase ? null : paint.color); };
      var go = function (m) {
        var a = cellAt(m);
        if (prev) { var n = Math.max(1, Math.ceil(Math.hypot(a.x - prev.x, a.y - prev.y) / (a.c / 3))); for (var i = 1; i <= n; i++) hit(prev.x + (a.x - prev.x) * i / n, prev.y + (a.y - prev.y) * i / n, a.c, a.w, a.h); } else hit(a.x, a.y, a.c, a.w, a.h);
        prev = a;
      };
      var up = function () { ui.box.removeEventListener('pointermove', go); ui.box.removeEventListener('pointerup', up); ui.box.removeEventListener('pointercancel', up); save(); };
      go(ev); ui.box.addEventListener('pointermove', go); ui.box.addEventListener('pointerup', up); ui.box.addEventListener('pointercancel', up);
    }
    function dragImage(ev) {
      if (!isDM() || !lob || !lob.image || ev.target.closest('.mp-tok')) return;
      ev.preventDefault(); ui.box.setPointerCapture(ev.pointerId);
      var r = ui.box.getBoundingClientRect(), sx = ev.clientX, sy = ev.clientY, ox = lob.imgX, oy = lob.imgY;
      var move = function (m) { lob.imgX = ox + (m.clientX - sx) / r.width; lob.imgY = oy + (m.clientY - sy) / r.height; styleImg(); };
      var up = function () { ui.box.removeEventListener('pointermove', move); ui.box.removeEventListener('pointerup', up); ui.box.removeEventListener('pointercancel', up); save(); };
      ui.box.addEventListener('pointermove', move); ui.box.addEventListener('pointerup', up); ui.box.addEventListener('pointercancel', up);
    }


    /* ---- viewing: zoom and pan (players only; the headmaster edits the map, players can only look) ---- */
    function zApply() {
      if (!ui.zoom || !ui.box) return;
      var W = ui.box.clientWidth, H = ui.box.clientHeight;
      zm.s = Math.max(1, Math.min(6, zm.s));
      zm.x = Math.min(0, Math.max(W - W * zm.s, zm.x)); zm.y = Math.min(0, Math.max(H - H * zm.s, zm.y));
      ui.zoom.style.transform = 'translate(' + zm.x + 'px,' + zm.y + 'px) scale(' + zm.s + ')';
      ui.box.classList.toggle('zoomed', zm.s > 1.001);
    }
    function zAt(px, py, s2) { var s = zm.s; s2 = Math.max(1, Math.min(6, s2)); zm.x = px - (px - zm.x) * s2 / s; zm.y = py - (py - zm.y) * s2 / s; zm.s = s2; zApply(); }
    function wrapZoom() {
      var z = h('div', { className: 'mp-zoom' });
      Array.prototype.slice.call(ui.box.childNodes).forEach(function (n) { z.appendChild(n); });
      ui.box.appendChild(z); ui.zoom = z;
      ui.box.appendChild(h('div', { className: 'mp-zc' }, [['+', 'Zoom in', 1.4], ['\u2212', 'Zoom out', 1 / 1.4], ['\u27F2', 'Reset zoom', 0]].map(function (d) {
        var b = h('button', { type: 'button', text: d[0], title: d[1], 'aria-label': d[1] });
        b.onclick = function () { if (d[2]) zAt(ui.box.clientWidth / 2, ui.box.clientHeight / 2, zm.s * d[2]); else { zm = { s: 1, x: 0, y: 0 }; zApply(); } };
        return b;
      })));
      zApply();
    }
    function setupZoom() {
      var ptrs = {}, count = 0, moved = 0, tapTok = null, lastTap = 0;
      var pts = function () { return Object.keys(ptrs).map(function (k) { return ptrs[k]; }); };
      ui.box.addEventListener('wheel', function (ev) {
        if (!lob || (!ev.ctrlKey && !ev.metaKey && zm.s <= 1.001)) return;
        ev.preventDefault(); var r = ui.box.getBoundingClientRect(); zAt(ev.clientX - r.left, ev.clientY - r.top, zm.s * (ev.deltaY < 0 ? 1.2 : 1 / 1.2));
      }, { passive: false });
      ui.box.addEventListener('dblclick', function (ev) {
        if (!lob || ev.target.closest('.mp-zc')) return;
        if (zm.s > 1.001) { zm = { s: 1, x: 0, y: 0 }; zApply(); } else { var r = ui.box.getBoundingClientRect(); zAt(ev.clientX - r.left, ev.clientY - r.top, 2.5); }
      });
      ui.box.addEventListener('pointerdown', function (ev) {
        if (!lob || ev.target.closest('.mp-zc')) return;
        if (!ptrs[ev.pointerId]) count++;
        ptrs[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
        if (count === 1) { moved = 0; var tk = ev.target.closest && ev.target.closest('.mp-tok[data-reg]'); tapTok = tk ? tk.getAttribute('data-reg') : null; }
        try { ui.box.setPointerCapture(ev.pointerId); } catch (e) {}
      });
      ui.box.addEventListener('pointermove', function (ev) {
        var p = ptrs[ev.pointerId]; if (!p) return;
        if (count === 1) {
          var dx = ev.clientX - p.x, dy = ev.clientY - p.y; moved += Math.abs(dx) + Math.abs(dy); p.x = ev.clientX; p.y = ev.clientY;
          if (zm.s > 1.001) { zm.x += dx; zm.y += dy; zApply(); }
        } else if (count === 2) {
          var a = pts(), d0 = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), c0x = (a[0].x + a[1].x) / 2, c0y = (a[0].y + a[1].y) / 2;
          p.x = ev.clientX; p.y = ev.clientY;
          var b = pts(), d1 = Math.hypot(b[0].x - b[1].x, b[0].y - b[1].y), c1x = (b[0].x + b[1].x) / 2, c1y = (b[0].y + b[1].y) / 2, r = ui.box.getBoundingClientRect();
          moved += 20; zm.x += c1x - c0x; zm.y += c1y - c0y;
          if (d0 > 0) zAt(c1x - r.left, c1y - r.top, zm.s * d1 / d0); else zApply();
        }
      });
      var end = function (ev) {
        if (!ptrs[ev.pointerId]) return;
        delete ptrs[ev.pointerId]; count = Math.max(0, count - 1);
        if (count === 0 && ev.type === 'pointerup' && moved < 8) {
          if (tapTok) openNpc(tapTok);
          var now = Date.now(); if (!tapTok && now - lastTap < 300 && ev.pointerType === 'touch') { var r = ui.box.getBoundingClientRect(); if (zm.s > 1.001) { zm = { s: 1, x: 0, y: 0 }; zApply(); } else zAt(ev.clientX - r.left, ev.clientY - r.top, 2.5); lastTap = 0; } else lastTap = now;
        }
      };
      ui.box.addEventListener('pointerup', end); ui.box.addEventListener('pointercancel', end);
    }

    /* ---- the NPCs and monsters on this map, with their stats when the headmaster has disclosed them ---- */
    function loadNpcs() {
      var id = lob && lob.id; if (!id || isDM()) return;
      call('map', { action: 'npcs', id: id }).then(function (r) { if (!lob || lob.id !== id) return; npcs = r.ok ? (r.j.entries || []) : []; drawNpcs(); });
    }
    function openNpc(id) {
      if (!npcs.some(function (e) { return e.id === id; })) return;
      npcOpen[id] = true; drawNpcs();
      var n = ui.npcs.querySelector('[data-reg="' + id + '"]'); if (n && n.scrollIntoView) { try { n.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {} }
    }
    function statBlock(e) {
      var box = h('div', { className: 'mp-stat' }), has = function (k) { return Object.prototype.hasOwnProperty.call(e, k); }, any = false;
      var line = function (label, text) { if (text == null || String(text).trim() === '') return; any = true; box.appendChild(h('p', {}, [h('b', { text: label + ' ' }), String(text)])); };
      if (e.teaser) box.appendChild(h('p', { className: 'mono', text: e.teaser }));
      var vit = [];
      if (has('hp')) vit.push(['HP', e.hp]); if (has('armor')) vit.push(['Armor', e.armor]);
      if (has('speed') && e.speed !== '') vit.push(['Speed', e.speed + ' ft']);
      if (has('initiative') && e.initiative !== '') vit.push(['Initiative', (e.initiative >= 0 ? '+' : '') + e.initiative]);
      if (has('prof') && e.prof) vit.push(['Prof.', '+' + e.prof]);
      if (vit.length) { any = true; box.appendChild(h('div', { className: 'mp-vit' }, vit.map(function (v) { return h('div', {}, [h('span', { className: 'mono', text: v[0] }), h('b', { text: String(v[1]) })]); }))); }
      if (e.stats && typeof e.stats === 'object') { any = true; box.appendChild(h('div', { className: 'mp-vit ab' }, Object.keys(e.stats).map(function (k) { return h('div', {}, [h('span', { className: 'mono', text: k }), h('b', { text: String(e.stats[k]) })]); }))); }
      line('Size:', e.size); line('Level / CR:', e.level); line('Senses:', e.senses); line('Languages:', e.languages); line('Saving throws:', e.saves);
      line('Immunities:', e.immunities); line('Resistances:', e.resistances); line('Weaknesses:', e.weaknesses);
      line('Basic:', e.basic); (Array.isArray(e.skills) ? e.skills : []).forEach(function (s, i) { line('Skill ' + (i + 1) + ':', s); }); line('Ultimate:', e.ultimate);
      line('Attacks:', e.attacks); line('Quirks:', Array.isArray(e.quirks) ? e.quirks.join(', ') : e.quirks);
      if (e.statsHidden) box.appendChild(h('p', { className: 'mono', text: 'The headmaster has not revealed its stats yet.' }));
      else if (!any && !e.teaser) box.appendChild(h('p', { className: 'mono', text: 'Nothing is known about this one yet.' }));
      return box;
    }
    function drawNpcs() {
      if (!ui.npcs) return; clear(ui.npcs);
      if (!lob || !npcs.length) return;
      ui.npcs.appendChild(h('p', { className: 'mono red', text: 'On this map' }));
      npcs.forEach(function (e) {
        var open = !!npcOpen[e.id];
        var sub = [e.type === 'shadow' ? 'Monster' : 'NPC', e.level && !e.undisclosed ? 'Lv ' + e.level : '', e.undisclosed ? 'Undisclosed' : (e.statsHidden ? 'Stats sealed' : '')].filter(Boolean).join(' \u00B7 ');
        var row = h('button', { type: 'button', className: 'mp-nrow', 'aria-expanded': String(open), 'data-reg': e.id }, [thumb(e.image, (e.name || '?').charAt(0).toUpperCase(), 'tk'), h('span', {}, [h('b', { text: e.name }), h('small', { text: sub })]), h('span', { className: 'mono', text: open ? 'Hide' : 'Stats' })]);
        row.onclick = function () { npcOpen[e.id] = !npcOpen[e.id]; drawNpcs(); };
        var item = h('div', { className: 'mp-nitem' }, [row]); if (open) item.appendChild(statBlock(e)); ui.npcs.appendChild(item);
      });
    }

    /* saving (headmaster) */
    function save(now) {
      if (!lob) return;
      ui.status.textContent = 'Saving…'; clearTimeout(saveT);
      saveT = setTimeout(function () {
        var l = { id: lob.id, name: lob.name, cell: lob.cell, tokScale: lob.tokScale || 1, tileAlpha: lob.tileAlpha || 0.4, cells: lob.cells || [], fog: lob.fog || [], fogOn: lob.fogOn !== false, imgScale: lob.imgScale, imgX: lob.imgX, imgY: lob.imgY, members: lob.members, tokens: lob.tokens.map(function (t) { return { id: t.id, label: t.label, src: t.src, up: t.up || '', size: t.size, x: t.x, y: t.y }; }) };
        if (lob._img) l.image = lob.image;
        var id = lob.id;
        call('map', { action: 'save', lobby: l }).then(function (r) {
          if (!r.ok) { ui.status.textContent = r.j.error || 'Save failed'; return; }
          if (lob && lob.id === id) { lob.rev = r.j.lobby.rev; lob._img = false; (r.j.tokens || []).forEach(function (s) { var t = lob.tokens.filter(function (x) { return x.id === s.id; })[0]; if (!t) return; t.src = s.src; delete t.up; if (s.img && t.img !== s.img) { t.img = s.img; var old = ui.box.querySelector('.mp-tok[data-id="' + s.id + '"]'); if (old && !old.matches(':active')) old.replaceWith(tokenEl(t)); } }); }
          lobbies = r.j.lobbies; ui.status.textContent = 'Saved.'; drawTabs();
        });
      }, now ? 0 : 500);
    }

    /* the headmaster's panel */
    function slider(label, min, max, step, val, on, done) {
      var i = h('input', { type: 'range', min: min, max: max, step: step, value: val }), out = h('span', { className: 'mono', text: String(Math.round(val * 100) / 100) });
      i.oninput = function () { on(Number(i.value)); out.textContent = String(Math.round(i.value * 100) / 100); }; i.onchange = done;
      return h('label', { className: 'fl' }, [h('span', {}, [label + ' ', out]), i]);
    }
    function drawSide() {
      clear(ui.side);
      if (!lob) return;
      var name = h('input', { value: lob.name, maxLength: 40, 'aria-label': 'Lobby name' });
      name.oninput = function () { lob.name = name.value; var m = lobbies.filter(function (l) { return l.id === lob.id; })[0]; if (m) m.name = name.value || 'Lobby'; drawTabs(); save(); };
      var file = h('input', { type: 'file', accept: 'image/*' });
      file.onchange = function () {
        var f = file.files && file.files[0]; if (!f) return; ui.status.textContent = 'Preparing image…';
        shrink(f, 2200, 4400000, function (d) { if (!d) { ui.status.textContent = 'Could not use that image.'; return; } lob.image = d; lob._img = true; drawBox(); save(true); });
      };
      var rm = h('button', { type: 'button', className: 'link', text: 'Remove image' }); rm.onclick = function () { lob.image = ''; lob._img = true; drawBox(); save(true); };
      var fitb = h('button', { type: 'button', className: 'btn', text: 'Fit image to box' }); fitb.onclick = function () { lob.imgScale = 1; lob.imgX = 0; lob.imgY = 0; styleImg(); drawSide(); save(); };
      var sn = h('select', { 'aria-label': 'Token snapping' }, [['square', 'Snap to squares (side by side if shared)'], ['fine', 'Fine snap (quarter squares)'], ['free', 'Free (no snap, anywhere)']].map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
      sn.value = snapMode; sn.onchange = function () { snapMode = sn.value; };
      var del = h('button', { type: 'button', className: 'btn', text: 'Delete lobby' });
      G.two(del, 'Delete lobby', function () { call('map', { action: 'delete', id: lob.id }).then(function (r) { if (r.ok) { lobbies = r.j.lobbies; curId = null; lob = null; poll(); } }); });
      var chars = G.chars(), mem = h('div', { className: 'mp-mem' });
      if (!chars.length) mem.appendChild(note('No saved characters yet.'));
      chars.forEach(function (c) {
        var cb = h('input', { type: 'checkbox', checked: lob.members.indexOf(c.id) >= 0 });
        cb.onchange = function () { lob.members = lob.members.filter(function (x) { return x !== c.id; }); if (cb.checked) lob.members.push(c.id); save(); };
        mem.appendChild(h('label', { className: 'chk' }, [cb, h('span', { text: c.name || 'Unnamed' })]));
      });
      ui.side.appendChild(h('div', { className: 'mp-card' }, [
        h('p', { className: 'mono red', text: 'Lobby' }), h('label', { className: 'fl' }, [h('span', { text: 'Name' }), name]),
        h('label', { className: 'fl' }, [h('span', { text: 'Map image' }), file]), h('div', { className: 'ef' }, [fitb, rm]),
        slider('Image size', 0.2, 4, 0.01, lob.imgScale, function (v) { lob.imgScale = v; styleImg(); }, save),
        slider('Square size', 3, 20, 0.1, lob.cell, function (v) { lob.cell = v; drawBoxKeepImg(); }, save),
        slider('All tokens size', 0.3, 3, 0.05, lob.tokScale || 1, function (v) { lob.tokScale = v; drawBoxKeepImg(); }, save),
        h('label', { className: 'fl' }, [h('span', { text: 'Token placing' }), sn]),
        note('Drag the map image to move it. Drag a token to move it. Use Fine or Free to put several tokens in one square.'),
      ]));
      markers = []; ui.side.appendChild(paintCard()); ui.side.appendChild(fogCard());
      ui.side.appendChild(h('div', { className: 'mp-card' }, [h('p', { className: 'mono red', text: 'Souls in this lobby' }), mem, note('Players only see lobbies they are in.')]));
      ui.side.appendChild(tokenCard());
      ui.side.appendChild(h('div', { className: 'mp-card' }, [del]));
    }
    function paintCard() {
      var COL = [['#2ecc71', 'Green'], ['#3b82f6', 'Blue'], ['#ef4444', 'Red'], ['#f59e0b', 'Orange'], ['#eab308', 'Yellow'], ['#a855f7', 'Purple'], ['#06b6d4', 'Cyan'], ['#ffffff', 'White']];
      var onb = h('button', { type: 'button', className: 'btn', text: paint.on && !paint.fog ? 'Painting: ON' : 'Paint tiles: OFF', 'aria-pressed': String(paint.on && !paint.fog) });
      var custom = h('input', { type: 'color', value: paint.color, 'aria-label': 'Custom colour' }), er = h('button', { type: 'button', className: 'mp-sw er', text: 'Erase', 'aria-pressed': String(paint.erase) });
      var sws = COL.map(function (c) { var b = h('button', { type: 'button', className: 'mp-sw', title: c[1], 'aria-label': c[1], 'aria-pressed': String(!paint.erase && paint.color === c[0]) }); b.style.background = c[0]; b.onclick = function () { paint.color = c[0]; paint.erase = false; paint.fog = false; paint.on = true; markAll(); }; return b; });
      function mark() {
        var mine = paint.on && !paint.fog; onb.textContent = mine ? 'Painting: ON' : 'Paint tiles: OFF'; onb.setAttribute('aria-pressed', String(mine));
        sws.forEach(function (b, i) { b.setAttribute('aria-pressed', String(mine && !paint.erase && paint.color === COL[i][0])); }); er.setAttribute('aria-pressed', String(mine && paint.erase)); custom.value = paint.color;
      }
      markers.push(mark);
      onb.onclick = function () { if (paint.on && !paint.fog) paint.on = false; else { paint.fog = false; paint.on = true; } markAll(); };
      er.onclick = function () { paint.erase = true; paint.fog = false; paint.on = true; markAll(); };
      custom.oninput = function () { paint.color = custom.value; paint.erase = false; paint.fog = false; paint.on = true; markAll(); };
      var clr = h('button', { type: 'button', className: 'btn', text: 'Clear all tiles' });
      G.two(clr, 'Clear all tiles', function () { lob.cells = []; ui.tiles = {}; clear(ui.paint); save(); });
      return h('div', { className: 'mp-card' }, [
        h('p', { className: 'mono red', text: 'Tile colours' }), onb,
        h('div', { className: 'mp-sws' }, sws.concat([custom, er])),
        slider('Tile strength', 0.1, 0.9, 0.05, lob.tileAlpha || 0.4, function (v) { lob.tileAlpha = v; if (ui.paint) ui.paint.style.opacity = v; }, save),
        clr, note('Turn painting on, pick a colour, then click or drag over squares to tint them. Erase takes a colour off. Tokens cannot be dragged while painting is on.'),
      ]);
    }
    function markAll() { markers.forEach(function (f) { f(); }); if (ui.box) ui.box.classList.toggle('painting', !!paint.on); }
    function fogCard() {
      var hideB = h('button', { type: 'button', className: 'btn', 'aria-pressed': 'false' }), showB = h('button', { type: 'button', className: 'btn', 'aria-pressed': 'false' });
      function mark() {
        var hm = paint.on && paint.fog && !paint.erase, rm = paint.on && paint.fog && paint.erase;
        hideB.textContent = hm ? 'Hiding tiles: ON' : 'Hide tiles'; hideB.setAttribute('aria-pressed', String(hm));
        showB.textContent = rm ? 'Revealing tiles: ON' : 'Reveal a tile'; showB.setAttribute('aria-pressed', String(rm));
      }
      markers.push(mark); mark();
      hideB.onclick = function () { if (paint.on && paint.fog && !paint.erase) paint.on = false; else { paint.fog = true; paint.erase = false; paint.on = true; } markAll(); };
      showB.onclick = function () { if (paint.on && paint.fog && paint.erase) paint.on = false; else { paint.fog = true; paint.erase = true; paint.on = true; } markAll(); };
      var tick = h('input', { type: 'checkbox', checked: lob.fogOn !== false });
      var cnt = h('span', { className: 'mono', text: (lob.fog || []).length + ' hidden' });
      tick.onchange = function () { lob.fogOn = tick.checked; fogClasses(); save(true); };
      var prev = h('input', { type: 'checkbox', checked: fogPrev });
      prev.onchange = function () { fogPrev = prev.checked; fogClasses(); };
      var clr = h('button', { type: 'button', className: 'btn', text: 'Reveal all tiles' });
      G.two(clr, 'Reveal all tiles', function () { lob.fog = []; ui.ftiles = {}; clear(ui.fogl); cnt.textContent = '0 hidden'; save(); });
      ui.fcnt = cnt;
      return h('div', { className: 'mp-card' }, [
        h('p', { className: 'mono red', text: 'Hidden tiles' }),
        h('div', { className: 'ef' }, [hideB, showB]),
        h('label', { className: 'chk' }, [tick, h('span', { text: 'Hidden from players (untick to show everyone)' })]),
        h('label', { className: 'chk' }, [prev, h('span', { text: 'Preview as a player sees it (solid black)' })]),
        h('div', { className: 'ef' }, [cnt, clr]),
        note('Turn on Hide tiles, then click or drag over squares to black them out. Anything standing on a hidden square is also hidden from players, and its stats stay off their page. Unticking the box shows every tile to everyone at once and keeps your tiles for next time.'),
      ]);
    }
    function drawBoxKeepImg() { if (!lob || !ui.grid) return; fit(); Array.prototype.forEach.call(ui.box.querySelectorAll('.mp-tok'), function (n, i) { if (lob.tokens[i]) place(lob.tokens[i], n); }); }

    function tokenCard() {
      var card = h('div', { className: 'mp-card' }), list = h('div', { className: 'mp-list' });
      var tabs = h('div', { className: 'mp-mini' }, [['shadow', 'Monsters'], ['npc', 'NPCs'], ['player', 'Players'], ['custom', 'Quick']].map(function (t) {
        return h('button', { type: 'button', text: t[1], 'aria-pressed': String(tab === t[0]), onclick: function () { tab = t[0]; drawSide(); } });
      }));
      var s = h('input', { type: 'search', placeholder: 'Search ' + (tab === 'shadow' ? 'monsters' : tab === 'npc' ? 'NPCs' : 'players'), value: q, 'aria-label': 'Search tokens' }); if (tab === 'custom') s.hidden = true;
      s.oninput = function () { q = s.value; fill(); };
      function source() {
        if (tab === 'player') return G.chars().map(function (c) { return { name: c.name || 'Unnamed', sub: 'Player', img: c.image ? FN + 'chat?avatar=' + c.id + '&v=' + (Date.parse(c.updatedAt || 0) || 0) : '', src: c.image ? 'player:' + c.id : '' }; });
        return G.reg().filter(function (e) { return e.type === tab && e.listed !== false; }).map(function (e) { return { name: e.name, sub: tab === 'npc' ? 'NPC' : 'Monster', img: e.image && !(e.type === 'npc' && e.undisclosed && e.hideImage) ? FN + 'registry?img=' + e.id + '&v=' + (Date.parse(e.updatedAt || 0) || 0) : '', src: e.image && !(e.type === 'npc' && e.undisclosed && e.hideImage) ? 'reg:' + e.id : '' }; });
      }
      function fill() {
        clear(list); var n = 0;
        if (tab === 'custom') {
          var cn = h('input', { placeholder: 'Name (Chest, Fire, Key…)', maxLength: 30, 'aria-label': 'Quick token name' }), cf = h('input', { type: 'file', accept: 'image/*', 'aria-label': 'Quick token picture' });
          var ca = h('button', { type: 'button', className: 'btn', text: 'Add to map' }), cm = note('A name, and a picture if you like. Add as many as you need.');
          var put = function (d) {
            var id = 't' + Date.now().toString(36) + Math.floor(Math.random() * 1000);
            var t = { id: id, label: cn.value.trim().slice(0, 30), img: d, src: d ? 'custom:' + id : '', up: d, size: 1, x: 0.5, y: 0.5 };
            lob.tokens.push(t); selTok = t.id; drawBox(); drawSide(); save();
          };
          ca.onclick = function () {
            if (!cn.value.trim()) { cm.textContent = 'Give it a name first.'; return; }
            var f = cf.files && cf.files[0]; if (!f) { put(''); return; }
            cm.textContent = 'Preparing picture…';
            shrink(f, 256, 150000, function (d) { if (!d) { cm.textContent = 'Could not use that picture.'; return; } put(d); });
          };
          [cn, h('label', { className: 'fl' }, [h('span', { text: 'Picture (optional)' }), cf]), ca, cm].forEach(function (x) { list.appendChild(x); });
          return;
        }
        source().filter(function (e) { return !q || e.name.toLowerCase().indexOf(q.toLowerCase()) >= 0; }).forEach(function (e) {
          n++;
          var add = h('button', { type: 'button', className: 'mp-plus', text: '+', 'aria-label': 'Add ' + e.name + ' to the map' });
          add.onclick = function () {
            var t = { id: 't' + Date.now().toString(36) + Math.floor(Math.random() * 1000), label: e.name.slice(0, 30), img: e.img, src: e.src || '', size: 1, x: 0.5, y: 0.5 };
            lob.tokens.push(t); selTok = t.id; drawBox(); drawSide(); save();
          };
          list.appendChild(h('div', { className: 'mp-row' }, [thumb(e.img, e.name.charAt(0).toUpperCase(), 'sm'), h('div', {}, [h('b', { text: e.name }), h('small', { className: 'mono', text: e.sub })]), add]));
        });
        if (!n) list.appendChild(note(tab === 'player' ? 'No saved characters yet.' : 'Nothing here. Add entries in Character details › Registry.'));
      }
      card.appendChild(h('p', { className: 'mono red', text: 'Token browser' })); card.appendChild(tabs); card.appendChild(s); card.appendChild(list); fill();
      var t = lob.tokens.filter(function (x) { return x.id === selTok; })[0];
      if (t) {
        var lab = h('input', { value: t.label, maxLength: 30, 'aria-label': 'Token label' }); lab.oninput = function () { t.label = lab.value; var n = ui.box.querySelector('.mp-tok.sel .mp-lab'); if (n) n.textContent = lab.value; save(); };
        var rmt = h('button', { type: 'button', className: 'btn', text: 'Remove token' });
        rmt.onclick = function () { lob.tokens = lob.tokens.filter(function (x) { return x.id !== t.id; }); selTok = null; drawBox(); drawSide(); save(); };
        var sz = slider('Token size', 0.25, 4, 0.05, t.size || 1, function (v) { t.size = v; var el = ui.box.querySelector('.mp-tok[data-id="' + t.id + '"]'); if (el) place(t, el); }, save);
        card.appendChild(h('div', { className: 'mp-sel' }, [h('p', { className: 'mono red', text: 'Selected token' }), lab, sz, rmt]));
      }
      return card;
    }
    ui.box = null;
    return { enter: function (r) { if (!built) build(); ui.box.onpointerdown = boxDown; poll(true); start(); }, leave: stop, wake: wake, reset: reset };
  })();

  /* ======================= GACHA (animation and result cards, used by the Marketplace) ======================= */
  var RAR = {
    common:   { label: 'Common',   tag: 'C',   title: 'SCRAPS',          sub: 'MAMMON SHRUGS' },
    uncommon: { label: 'Uncommon', tag: 'UC',  title: 'ADEQUATE',        sub: 'AN UNCOMMON FIND' },
    r:        { label: 'Rare',     tag: 'R',   title: 'NOT BAD',         sub: 'A RARE FIND' },
    sr:       { label: 'SR',       tag: 'SR',  title: 'WELL DRAWN',      sub: 'A SUPER RARE PRIZE' },
    ssr:      { label: 'SSR',      tag: 'SSR', title: 'CONGRATULATIONS', sub: 'YOU WON THE GRAND PRIZE' }
  };
  var RAR_ORDER = ['common', 'uncommon', 'r', 'sr', 'ssr'];
  var reduceMotion = function () { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  // Ransom-note lettering: every letter is a little cut-out in its own face, colour and tilt.
  function ransom(text) {
    var faces = ['var(--f-display)', 'var(--f-mono)', "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif", 'var(--f-body)', "Georgia, 'Times New Roman', serif"];
    var tiles = [['#e3151f', '#fff'], ['#f3efec', '#0a0808'], ['#0a0808', '#ff4d4d'], ['#7a0b11', '#f3efec'], ['#f3efec', '#e3151f']];
    var box = h('div', { className: 'gc-ransom', 'aria-label': text, role: 'img' });
    text.split('').forEach(function (ch, i) {
      if (ch === ' ') { box.appendChild(h('span', { className: 'gap', 'aria-hidden': 'true' })); return; }
      var s = h('span', { text: ch, 'aria-hidden': 'true' }), t = tiles[(i * 3 + 1) % tiles.length];
      s.style.cssText = 'font-family:' + faces[(i * 2 + (i % 3)) % faces.length] + ';background:' + t[0] + ';color:' + t[1] + ';transform:rotate(' + (((i * 37) % 13) - 6) + 'deg) translateY(' + (((i * 11) % 7) - 3) + 'px);font-size:' + (1.5 + ((i * 5) % 4) * 0.22) + 'em;font-weight:' + (i % 2 ? 700 : 500) + ';animation-delay:' + (i * 45) + 'ms';
      box.appendChild(s);
    });
    return box;
  }
  function prizeCard(it, opts) {
    opts = opts || {};
    var r = it.rarity;
    var card = h('div', { className: 'gc-card r-' + r }, [
      h('div', { className: 'gc-tag', text: RAR[r].tag }),
      h('div', { className: 'gc-orb' }, [thumb(it.image, (it.name || '?').charAt(0), 'gc-art')]),
      h('b', { className: 'gc-name', text: it.name }),
      opts.desc && it.desc ? h('p', { className: 'gc-desc', text: it.desc }) : null,
      h('small', { className: 'gc-rl', text: RAR[r].label })
    ]);
    if (!opts.back) return card;
    // A face-down card for the ten-pull: flips over when revealed.
    var wrap = h('div', { className: 'gc-slot' }, [h('div', { className: 'gc-flip' }, [h('div', { className: 'gc-back-side' }, [h('span', { text: '獄' })]), h('div', { className: 'gc-front-side' }, [card])])]);
    wrap._rar = r; return wrap;
  }
  // Plays the draw: a capsule drops, shakes, bursts, then the prize card (or ten cards) appear. results = [{name, desc, image, rarity}]
  G.gachaReveal = function (results, done) {
    var prev = document.activeElement, quick = reduceMotion(), timers = [], finished = false;
    var best = results.reduce(function (a, x) { return RAR_ORDER.indexOf(x.rarity) > RAR_ORDER.indexOf(a) ? x.rarity : a; }, 'common');
    var ov = h('div', { className: 'gc-ov r-' + best, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Gacha result' });
    var stage = h('div', { className: 'gc-stage' }), skip = h('button', { type: 'button', className: 'btn gc-skip', text: 'Skip' });
    ov.appendChild(stage); ov.appendChild(skip); document.body.appendChild(ov); document.body.classList.add('gc-lock');
    function later(fn, ms) { timers.push(setTimeout(fn, quick ? Math.min(ms, 120) : ms)); }
    function close() { timers.forEach(clearTimeout); document.removeEventListener('keydown', onKey); ov.remove(); document.body.classList.remove('gc-lock'); if (prev && prev.focus) { try { prev.focus(); } catch (e) {} } if (done) done(); }
    function onKey(e) { if (e.key === 'Escape' && finished) close(); }
    document.addEventListener('keydown', onKey);
    var closeBtn = h('button', { type: 'button', className: 'btn primary gc-close', text: 'Close' }); closeBtn.onclick = close;

    function showResult() {
      clear(stage); skip.hidden = true;
      if (results.length === 1) {
        var it = results[0];
        stage.appendChild(h('div', { className: 'gc-one r-' + it.rarity }, [
          ransom(RAR[it.rarity].title),
          h('div', { className: 'gc-big', text: RAR[it.rarity].tag }),
          prizeCard(it, { desc: true }),
          h('div', { className: 'gc-sub', text: RAR[it.rarity].sub }),
          closeBtn
        ]));
        finished = true; closeBtn.focus();
        return;
      }
      var grid = h('div', { className: 'gc-grid' }), slots = results.map(function (x) { var s = prizeCard(x, { back: true }); grid.appendChild(s); return s; });
      var tally = h('p', { className: 'mono gc-tally', text: '\u00a0' });
      stage.appendChild(h('div', { className: 'gc-ten' }, [ransom(RAR[best].title), grid, tally, closeBtn]));
      closeBtn.hidden = true; skip.hidden = false; skip.textContent = 'Reveal all';
      var i = 0;
      function flip(s) { s.classList.add('on'); if (s._rar === 'sr' || s._rar === 'ssr') s.classList.add('pop'); }
      function end() {
        slots.forEach(flip); timers.forEach(clearTimeout); skip.hidden = true; closeBtn.hidden = false; finished = true;
        var n = {}; results.forEach(function (x) { n[x.rarity] = (n[x.rarity] || 0) + 1; });
        tally.textContent = RAR_ORDER.slice().reverse().filter(function (k) { return n[k]; }).map(function (k) { return RAR[k].tag + ' \u00d7' + n[k]; }).join('   ');
        closeBtn.focus();
      }
      skip.onclick = end;
      (function step() { if (i >= slots.length) { later(end, 400); return; } flip(slots[i++]); later(step, 330); })();
    }

    // Capsule phase
    var cap = h('div', { className: 'gc-cap' }, [h('i', { className: 'top' }), h('i', { className: 'bot' })]), flash = h('div', { className: 'gc-flash' });
    stage.appendChild(cap); stage.appendChild(flash);
    cap.classList.add('drop');
    later(function () { cap.classList.remove('drop'); cap.classList.add('shake'); }, 750);
    later(function () { cap.classList.remove('shake'); cap.classList.add('burst'); flash.classList.add('go'); }, 1650);
    later(showResult, 2100);
    skip.onclick = function () { timers.forEach(clearTimeout); showResult(); };
    skip.focus();
  };

  /* ======================= MARKETPLACE ======================= */
  modules.market = (function () {
    var root = $('pane-market'), data = null, cfg = null, cat = null, sel = null, line = '', msg = '', err = false, editMammon = false, adding = false;
    function isDM() { return !!G.creds(); }
    function reset() { data = null; cfg = null; clear(root); }
    function pickLine() { var l = (data && data.mammon.lines) || []; return l.length ? l[Math.floor(Math.random() * l.length)] : ''; }
    function enter() {
      clear(root).appendChild(note('Mammon is counting coins…'));
      var jobs = [call('market', { action: 'state' })];
      if (isDM()) { jobs.push(call('market', { action: 'getconfig' })); jobs.push(G.worldLoad()); }
      Promise.all(jobs).then(function (rs) {
        if (!rs[0].ok) { clear(root).appendChild(note(rs[0].j.error || 'Could not open the marketplace.')); return; }
        data = rs[0].j; cfg = rs[1] && rs[1].ok ? rs[1].j.config : null;
        if (!data.cats.some(function (c) { return c.id === cat; }) && cat !== 'debt' && cat !== 'gacha') cat = data.cats[0] ? data.cats[0].id : 'debt';
        sel = null; line = pickLine(); draw();
      });
    }
    function after(r, okMsg) {
      err = !r.ok; msg = r.ok ? (r.j.message || okMsg || '') : (r.j.error || 'Something went wrong.');
      if (!r.ok && r.j.battle) data.battle = true;
      if (r.ok) { data.battle = !!r.j.battle; data.karma = r.j.karma; data.debt = r.j.debt; data.tickets = r.j.tickets; data.discount = r.j.discount; if (G.reloadChar) G.reloadChar(); }
      draw();
    }
    function saveCfg() {
      var c = JSON.parse(JSON.stringify(cfg)), m = c.mammon;
      if (!/^data:/.test(m.image || '') && m.image !== '') delete m.image;
      call('market', { action: 'saveconfig', config: c }).then(function (r) { if (!r.ok) { err = true; msg = r.j.error || 'Could not save.'; draw(); return; } editMammon = false; adding = false; enter(); });
    }
    function money(n) { return Number(n || 0).toLocaleString('en-US'); }

    function draw() {
      clear(root);
      var dm = isDM(), cats = data.cats, c = cats.filter(function (x) { return x.id === cat; })[0];
      var fig = h('button', { type: 'button', className: 'mk-face', 'aria-label': 'Talk to ' + data.mammon.name }, [thumb(data.mammon.image, data.mammon.name.charAt(0), 'big')]);
      fig.onclick = function () { line = pickLine(); draw(); };
      var side = h('div', { className: 'mk-side' }, [fig, h('div', { className: 'mk-who' }, [h('h3', { text: data.mammon.name }), h('p', { className: 'mk-line', text: line ? '“' + line + '”' : '' })])]);
      var list = h('div', { className: 'mk-cats' });
      cats.forEach(function (k) { list.appendChild(h('button', { type: 'button', className: 'mk-cat', text: k.name, 'aria-pressed': String(cat === k.id), onclick: function () { cat = k.id; sel = null; adding = false; msg = ''; draw(); } })); });
      list.appendChild(h('button', { type: 'button', className: 'mk-cat', text: 'Gacha', 'aria-pressed': String(cat === 'gacha'), onclick: function () { cat = 'gacha'; sel = null; adding = false; msg = ''; draw(); } }));
      if (!dm) list.appendChild(h('button', { type: 'button', className: 'mk-cat', text: 'Pay debt / Loan', 'aria-pressed': String(cat === 'debt'), onclick: function () { cat = 'debt'; sel = null; msg = ''; draw(); } }));
      if (!dm) list.appendChild(h('button', { type: 'button', className: 'mk-cat', text: 'Sell items', 'aria-pressed': String(cat === 'sell'), onclick: function () { cat = 'sell'; sel = null; adding = false; msg = ''; draw(); } }));
      if (dm) {
        var addc = h('button', { type: 'button', className: 'mk-cat add', text: '(Add category)' });
        addc.onclick = function () { cfg.cats.push({ id: 'new' + Date.now(), name: 'New category', items: [] }); cat = cfg.cats[cfg.cats.length - 1].id; saveCfg(); };
        list.appendChild(addc);
        var em = h('button', { type: 'button', className: 'link', text: editMammon ? 'Close Mammon settings' : 'Edit Mammon' }); em.onclick = function () { editMammon = !editMammon; draw(); };
        list.appendChild(em);
      }
      side.appendChild(list);
      var top = dm ? h('div', { className: 'mk-top' }, [note('You are viewing the shop as the headmaster. Items can only come from the World registry.')])
        : h('div', { className: 'mk-top' }, [h('p', { className: 'mk-tot', text: 'Total karma: ' + money(data.karma) }), h('p', { className: 'mk-tot' + (data.debt ? ' bad' : ''), text: 'Karma debt: ' + (data.debt ? '-' + money(data.debt) : '0') })]);
      var main = h('div', { className: 'mk-main' }, [top]);
      if (msg) main.appendChild(h('p', { className: 'mk-msg' + (err ? ' bad' : ''), text: msg, role: 'status' }));
      if (dm && editMammon && cfg) main.appendChild(mammonEditor());
      if (data.battle && !dm) main.appendChild(h('div', { className: 'mk-detail' }, [h('h4', { text: 'The marketplace is closed' }), note('You are in battle. Nothing can be bought, sold or borrowed until the headmaster ends the battle.')]));
      else if (cat === 'sell' && !dm) main.appendChild(sellPanel());
      else if (cat === 'debt' && !dm) main.appendChild(debtPanel());
      else if (cat === 'gacha') main.appendChild(gachaPanel());
      else if (c) main.appendChild(shelf(c));
      else main.appendChild(note('No categories yet.'));
      root.appendChild(h('div', { className: 'hb-wrap mk' }, [side, main]));
    }
    /* ---- Gacha machine ---- */
    function machineSvg() {
      var pairs = [['#e3151f', '#f3efec'], ['#1b1212', '#e3151f'], ['#f3efec', '#3a2727'], ['#7a0b11', '#ff4d4d'], ['#2a1d1d', '#b3a5a3'], ['#ff4d4d', '#0a0808']];
      var spots = [[58, 190], [100, 192], [142, 191], [184, 189], [78, 168], [122, 170], [164, 166], [56, 150], [100, 148], [144, 146], [186, 150], [76, 128], [120, 126], [162, 124], [100, 106], [142, 104], [60, 108], [182, 110]];
      var caps = spots.map(function (p, i) {
        var c = pairs[i % pairs.length], x = p[0], y = p[1], r = 21;
        return '<g class="cp" style="animation-delay:' + ((i * 83) % 600) + 'ms"><circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + c[0] + '"/><path d="M' + (x - r) + ' ' + y + 'A' + r + ' ' + r + ' 0 0 0 ' + (x + r) + ' ' + y + 'Z" fill="' + c[1] + '"/><circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="2"/><ellipse cx="' + (x - 8) + '" cy="' + (y - 9) + '" rx="5" ry="3" fill="#fff" fill-opacity=".35" transform="rotate(-35 ' + (x - 8) + ' ' + (y - 9) + ')"/></g>';
      }).join('');
      var lights = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(function (i) { return '<circle class="ld" style="animation-delay:' + (i * 110) + 'ms" cx="' + (46 + i * 18.5) + '" cy="224" r="3.2" fill="#ff4d4d"/>'; }).join('');
      return '<svg viewBox="0 0 240 360" role="img" aria-label="Gacha machine" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M52 66a68 56 0 0 1 136 0z" fill="#e3151f" stroke="#000" stroke-width="3"/><circle cx="120" cy="38" r="11" fill="#0a0808" stroke="#f3efec" stroke-width="3"/>' +
        '<rect x="18" y="64" width="204" height="20" rx="3" fill="#7a0b11" stroke="#000" stroke-width="3"/>' +
        '<rect x="32" y="84" width="176" height="130" fill="#0d0a0a" stroke="#e3151f" stroke-width="6"/>' +
        '<g class="caps">' + caps + '</g>' +
        '<rect x="32" y="84" width="176" height="130" fill="url(#gcGlass)" opacity=".5"/>' +
        '<rect x="18" y="214" width="204" height="20" rx="3" fill="#0a0808" stroke="#7a0b11" stroke-width="3"/>' + lights +
        '<rect x="18" y="234" width="204" height="112" rx="4" fill="#b30f18" stroke="#000" stroke-width="3"/>' +
        '<rect x="26" y="240" width="188" height="4" fill="#e3151f"/>' +
        '<circle cx="120" cy="272" r="26" fill="#0a0808" stroke="#f3efec" stroke-width="3"/>' +
        '<g class="knob"><circle cx="120" cy="272" r="16" fill="#e3151f"/><rect x="113" y="254" width="14" height="36" rx="3" fill="#f3efec"/><circle cx="120" cy="272" r="5" fill="#0a0808"/></g>' +
        '<circle cx="190" cy="278" r="14" fill="#f3efec" stroke="#000" stroke-width="3"/><rect x="178" y="275" width="24" height="6" rx="2" fill="#0a0808"/>' +
        '<rect x="40" y="296" width="76" height="44" rx="3" fill="#050303" stroke="#f3efec" stroke-width="3"/>' +
        '<text x="168" y="318" text-anchor="middle" font-family="Georgia,serif" font-size="14" fill="#f3efec" opacity=".85">獄</text>' +
        '<rect x="12" y="346" width="216" height="12" rx="2" fill="#7a0b11" stroke="#000" stroke-width="3"/>' +
        '<defs><linearGradient id="gcGlass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".25" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient></defs></svg>';
    }
    var gcBusy = false;
    function gachaPanel() {
      var dm = isDM(), g = data.gacha || { ready: false, cost1: 300, cost10: 2900 }, ready = g.ready;
      var mach = h('div', { className: 'gc-machine' + (ready ? '' : ' off') });
      mach.innerHTML = machineSvg();
      var knob = h('button', { type: 'button', className: 'gc-knobbtn', 'aria-label': dm ? 'Preview one pull' : 'Pull once for ' + g.cost1 + ' karma', title: 'Start Gacha' });
      knob.disabled = !ready; mach.appendChild(knob);
      var b1 = h('button', { type: 'button', className: 'btn primary', text: dm ? 'Preview x1' : 'Pull x1 · ' + money(g.cost1) + ' karma' });
      var b10 = h('button', { type: 'button', className: 'btn primary', text: dm ? 'Preview x10' : 'Pull x10 · ' + money(g.cost10) + ' karma' });
      var wrap = h('div', { className: 'gc' }, [mach, h('div', { className: 'gc-btns' }, [b1, b10])]);
      function spin(on) { mach.classList.toggle('busy', on); }
      function previewPick() { var pool = cfg && cfg.gacha ? cfg.gacha.pool : [], it = pool[Math.floor(Math.random() * pool.length)], e = it && G.worldList.filter(function (x) { return x.id === it.itemId; })[0]; return e ? { name: e.name, desc: e.desc, image: e.image, rarity: it.rarity } : null; }
      function pull(n, byTicket) {
        if (gcBusy || !ready) return;
        if (dm) {
          var res = []; for (var i = 0; i < n; i++) { var p = previewPick(); if (p) res.push(p); }
          if (!res.length) { err = true; msg = 'Add items to the prize pool first.'; draw(); return; }
          gcBusy = true; spin(true); G.gachaReveal(res, function () { gcBusy = false; draw(); }); return;
        }
        gcBusy = true; spin(true); b1.disabled = b10.disabled = knob.disabled = true; msg = '';
        call('market', { action: 'gachapull', count: n, ticket: !!byTicket }).then(function (r) {
          if (!r.ok) { gcBusy = false; err = true; msg = r.j.error || 'The machine jammed.'; draw(); return; }
          data.karma = r.j.karma; data.debt = r.j.debt; data.tickets = r.j.tickets; data.discount = r.j.discount; if (G.reloadChar) G.reloadChar();
          G.gachaReveal(r.j.results, function () { gcBusy = false; err = false; msg = ''; draw(); });
        });
      }
      knob.onclick = function () { pull(1); };
      b1.onclick = function () { pull(1); };
      G.two(b10, dm ? 'Preview x10' : 'Pull x10 · ' + money(g.cost10) + ' karma', function () { pull(10); });
      if (dm) { b10.onclick = function () { pull(10); }; }
      b1.disabled = b10.disabled = !ready || gcBusy;
      if (!dm) { if (!ready) wrap.appendChild(note('The machine is out of order. Mammon is restocking.')); else if (data.karma < g.cost1) wrap.appendChild(note('You need ' + money(g.cost1 - data.karma) + ' more karma for a pull.')); }
      var tks = dm ? 0 : (data.tickets || 0);
      if (tks > 0) {
        var t1 = h('button', { type: 'button', className: 'btn', text: 'Use a ticket' + ' (' + tks + ' owned)' }); t1.onclick = function () { pull(1, true); }; t1.disabled = !ready || gcBusy;
        var t10 = tks >= 10 ? h('button', { type: 'button', className: 'btn', text: 'Use 10 tickets' }) : null; if (t10) { t10.onclick = function () { pull(10, true); }; t10.disabled = !ready || gcBusy; }
        wrap.appendChild(h('div', { className: 'gc-btns' }, [t1, t10]));
        wrap.appendChild(note('Gacha tickets pay for pulls instead of karma. Your discount ticket never works here.'));
      }
      if (dm && cfg) wrap.appendChild(gachaEditor());
      return wrap;
    }
    // Headmaster: which registry items sit in the machine, and how rare each one is.
    function gachaEditor() {
      cfg.gacha = cfg.gacha || { pool: [] };
      var pool = cfg.gacha.pool, byId = {}; G.worldList.forEach(function (e) { byId[e.id] = e; });
      var box = h('div', { className: 'mk-detail gc-ed' }, [h('h4', { text: 'Gacha prize pool' }),
        note('Only items from the World registry can go in. Rates: Common 40%, Uncommon 45.9% (everything left over), Rare 10%, SR 4%, SSR 0.1%. A ten-pull always includes an SR or better. If a rarity has no items, pulls fall back to the nearest lower rarity. The buttons above preview the animation for free and do not use real odds.')]);
      var counts = {}; pool.forEach(function (g) { counts[g.rarity] = (counts[g.rarity] || 0) + 1; });
      box.appendChild(h('p', { className: 'mono red', text: RAR_ORDER.slice().reverse().map(function (k) { return RAR[k].tag + ' ' + (counts[k] || 0); }).join('  ·  ') }));
      if (pool.length && !counts.sr && !counts.ssr) box.appendChild(note('Heads up: there is no SR or SSR item yet, so the ten-pull guarantee cannot be met.', 'mono hb-note bad'));
      var list = h('div', { className: 'gc-pool' });
      RAR_ORDER.slice().reverse().forEach(function (rk) {
        pool.filter(function (g) { return g.rarity === rk; }).forEach(function (g) {
          var e = byId[g.itemId];
          var sel = h('select', { 'aria-label': 'Rarity of ' + (e ? e.name : 'item') }, RAR_ORDER.slice().reverse().map(function (k) { return h('option', { value: k, text: RAR[k].label, selected: k === g.rarity }); }));
          sel.onchange = function () { g.rarity = sel.value; saveCfg(); };
          var rm = h('button', { type: 'button', className: 'btn', text: 'Remove' }); rm.onclick = function () { cfg.gacha.pool = pool.filter(function (x) { return x !== g; }); saveCfg(); };
          list.appendChild(h('div', { className: 'gc-row r-' + g.rarity }, [thumb(e && e.image, e ? e.name.charAt(0) : '?', 'sm'), h('b', { text: e ? e.name : '(removed from registry)' }), sel, rm]));
        });
      });
      if (!pool.length) list.appendChild(note('The machine is empty. Players will see it as out of order.'));
      box.appendChild(list);
      var have = {}; pool.forEach(function (g) { have[g.itemId] = 1; });
      var free = G.worldList.filter(function (e) { return e.kind === 'item' && !have[e.id]; });
      if (!free.length) { box.appendChild(note(G.worldList.some(function (e) { return e.kind === 'item'; }) ? 'Every registered item is already in the machine.' : 'No items are registered yet. Add some in Character details › World.')); return box; }
      var s = h('select', { 'aria-label': 'Item to add' }, free.map(function (e) { return h('option', { value: e.id, text: e.name }); }));
      var rs = h('select', { 'aria-label': 'Rarity' }, RAR_ORDER.slice().reverse().map(function (k) { return h('option', { value: k, text: RAR[k].label, selected: k === 'common' }); }));
      var add = h('button', { type: 'button', className: 'btn primary', text: 'Add to machine' }); add.onclick = function () { pool.push({ itemId: s.value, rarity: rs.value }); saveCfg(); };
      box.appendChild(h('div', { className: 'ef' }, [s, rs, add]));
      return box;
    }
    // Sell your own items to Mammon (the same items and prices as the Items tab: 90% of the shop price).
    function sellPanel() {
      var box = h('div', { className: 'mk-sell' }, [note('Mammon buys back the items the headmaster marked as sellable, at 90% of their price.')]);
      call('market', { action: 'myitems' }).then(function (r) {
        if (!r.ok) { box.appendChild(note(r.j.error || 'Could not open your items.')); return; }
        var rows = r.j.items.filter(function (x) { return x.sellable; });
        if (!rows.length) { box.appendChild(note('You have nothing Mammon will buy right now.')); return; }
        rows.forEach(function (x) {
          var q = h('input', { type: 'number', min: 1, max: x.qty, value: 1, className: 'ni', 'aria-label': 'How many ' + x.name + ' to sell' }), sb = h('button', { type: 'button', className: 'btn' });
          G.two(sb, 'Sell', function () { call('market', { action: 'sell', name: x.name, qty: q.value }).then(function (r2) { after(r2); }); }); sb.textContent = 'Sell';
          box.appendChild(h('div', { className: 'mk-detail' }, [h('div', { className: 'ef' }, [h('b', { text: x.name }), h('span', { className: 'mono', text: 'x' + x.qty }), h('span', { className: 'bdg on', text: 'Sells for ' + money(x.worth) + ' each' })]), h('div', { className: 'ef' }, [q, sb])]));
        });
      });
      return box;
    }
    // Normal price, crossed out and replaced by the sale price while a sale is on.
    function tag(it) { return it.sale ? h('small', {}, [h('s', { text: money(it.price) }), ' ' + money(it.sale) + ' Karma · SALE']) : h('small', { text: money(it.price) + ' Karma' }); }
    function shelf(c) {
      var dm = isDM(), wrap = h('div', {}), kc = dm && cfg ? cfg.cats.filter(function (x) { return x.id === c.id; })[0] : null;
      if (dm && kc) {
        var nm = h('input', { value: kc.name, maxLength: 40, 'aria-label': 'Category name' });
        var sv = h('button', { type: 'button', className: 'btn', text: 'Rename' }); sv.onclick = function () { kc.name = nm.value; saveCfg(); };
        var dl = h('button', { type: 'button', className: 'btn', text: 'Delete category' });
        G.two(dl, 'Delete category', function () { cfg.cats = cfg.cats.filter(function (x) { return x.id !== kc.id; }); cat = null; saveCfg(); });
        wrap.appendChild(h('div', { className: 'ef' }, [nm, sv, dl]));
      }
      var grid = h('div', { className: 'mk-grid' });
      c.items.forEach(function (it) {
        var b = h('button', { type: 'button', className: 'mk-item', 'aria-pressed': String(sel === it.itemId) }, [thumb(it.image, it.name.charAt(0), 'orb'), h('b', { text: it.name }), tag(it)]);
        b.onclick = function () { sel = it.itemId; msg = ''; draw(); };
        grid.appendChild(b);
      });
      if (dm) { var p = h('button', { type: 'button', className: 'mk-item plus', 'aria-label': 'Add an item', text: '+' }); p.onclick = function () { adding = !adding; draw(); }; grid.appendChild(p); }
      if (!c.items.length && !dm) grid.appendChild(note('Nothing on the shelf here yet.'));
      wrap.appendChild(grid);
      var it = c.items.filter(function (x) { return x.itemId === sel; })[0];
      if (it) wrap.appendChild(detail(c, it, kc));
      if (dm && adding && kc) wrap.appendChild(addItem(kc));
      return wrap;
    }
    function disc(v, pct) { return v ? Math.max(1, Math.round(v * (100 - pct) / 100)) : 0; }
    function detail(c, it, kc) {
      var p0 = it.sale || it.price, p = data.discount && !isDM() ? disc(p0, data.discount.pct) : p0;
      var box = h('div', { className: 'mk-detail' }, [h('h4', { text: it.name }), it.desc && h('p', { className: 'pre', text: it.desc }), h('p', { className: 'mono red' }, [(it.sale || p !== p0) ? h('s', { text: money(p !== p0 ? p0 : it.price) }) : null, ' ' + money(p) + ' Karma' + (p !== p0 ? ' (' + data.discount.pct + '% off, one purchase)' : (it.sale ? ' (on sale)' : ''))])]);
      if (data.discount && !isDM()) box.appendChild(note(data.discount.name + ' is active. It is used up by your next purchase here and does not work on the gacha.'));
      if (!isDM()) {
        var buy = h('button', { type: 'button', className: 'btn primary', text: 'Buy for ' + money(p) + ' karma' });
        G.two(buy, 'Buy for ' + money(p) + ' karma', function () { buy.disabled = true; call('market', { action: 'buy', catId: c.id, itemId: it.itemId }).then(function (r) { after(r); }); });
        box.appendChild(buy);
        if (data.karma < p) box.appendChild(note('You need ' + money(p - data.karma) + ' more karma.'));
      } else if (kc) {
        var ci = kc.items.filter(function (x) { return x.itemId === it.itemId; })[0];
        var pr = h('input', { type: 'number', min: 0, value: ci ? ci.price : 0, className: 'ni', 'aria-label': 'Price' });
        var sv = h('button', { type: 'button', className: 'btn', text: 'Set price' }); sv.onclick = function () { if (ci) { ci.price = Math.max(0, Math.floor(+pr.value) || 0); saveCfg(); } };
        var rm = h('button', { type: 'button', className: 'btn', text: 'Remove from shop' });
        G.two(rm, 'Remove from shop', function () { kc.items = kc.items.filter(function (x) { return x.itemId !== it.itemId; }); sel = null; saveCfg(); });
        box.appendChild(h('div', { className: 'ef' }, [pr, sv, rm]));
        var sp = h('input', { type: 'number', min: 0, value: (ci && ci.sale) || 0, className: 'ni', 'aria-label': 'Sale price' });
        var ss = h('button', { type: 'button', className: 'btn', text: 'Put on sale' }); ss.onclick = function () { if (ci) { ci.sale = Math.max(0, Math.floor(+sp.value) || 0); saveCfg(); } };
        var es = h('button', { type: 'button', className: 'btn', text: 'End sale' }); es.onclick = function () { if (ci) { ci.sale = 0; saveCfg(); } };
        box.appendChild(h('div', { className: 'ef' }, [h('label', { className: 'ef' }, ['Sale price (must be lower than the price)', sp]), ss, es]));
      }
      return box;
    }
    function addItem(kc) {
      var have = {}; kc.items.forEach(function (x) { have[x.itemId] = 1; });
      var pool = G.worldList.filter(function (e) { return e.kind === 'item' && !have[e.id]; });
      var box = h('div', { className: 'mk-detail' }, [h('p', { className: 'mono red', text: 'Add an item from the registry' })]);
      if (!pool.length) { box.appendChild(note(G.worldList.some(function (e) { return e.kind === 'item'; }) ? 'Every registered item is already here.' : 'No items are registered yet. Add some in Character details › World.')); return box; }
      var s = h('select', { 'aria-label': 'Item' }, pool.map(function (e) { return h('option', { value: e.id, text: e.name + (e.price ? ' (' + e.price + ')' : '') }); }));
      var pr = h('input', { type: 'number', min: 0, value: pool[0].price || 0, className: 'ni', 'aria-label': 'Price in karma' });
      s.onchange = function () { var e = pool.filter(function (x) { return x.id === s.value; })[0]; if (e) pr.value = e.price || 0; };
      var go = h('button', { type: 'button', className: 'btn primary', text: 'Add to ' + kc.name });
      go.onclick = function () { kc.items.push({ itemId: s.value, price: Math.max(0, Math.floor(+pr.value) || 0) }); saveCfg(); };
      box.appendChild(h('div', { className: 'ef' }, [s, h('label', { className: 'ef' }, ['Price', pr]), go]));
      return box;
    }
    function mammonEditor() {
      var m = cfg.mammon, c = { image: m.image }, crop = G.cropper(c);
      var nm = h('input', { value: m.name, maxLength: 40, 'aria-label': 'Name' }); nm.oninput = function () { m.name = nm.value; };
      var ln = h('textarea', { rows: 6, 'aria-label': 'Dialogue lines' }); ln.value = (m.lines || []).join('\n'); ln.oninput = function () { m.lines = ln.value.split('\n'); };
      var sv = h('button', { type: 'button', className: 'btn primary', text: 'Save Mammon' }); sv.onclick = function () { m.image = c.image; saveCfg(); };
      return h('div', { className: 'mk-detail ed' }, [h('p', { className: 'mono red', text: 'Mammon' }), h('label', { className: 'fl' }, [h('span', { text: 'Name' }), nm]), crop,
        h('label', { className: 'fl' }, [h('span', { text: 'Dialogue (one line each. A random one shows when a soul clicks her face)' }), ln]), sv]);
    }
    function debtPanel() {
      var amt = h('input', { type: 'number', min: 1, placeholder: 'Amount', className: 'ni', 'aria-label': 'Amount to pay' });
      var pay = h('button', { type: 'button', className: 'btn primary', text: 'Pay debt' }); pay.onclick = function () { call('market', { action: 'paydebt', amount: amt.value }).then(function (r) { after(r); }); };
      var la = h('input', { type: 'number', min: 1, max: 5000, placeholder: 'Amount (max 5,000)', className: 'ni', 'aria-label': 'Loan amount' });
      var loan = h('button', { type: 'button', className: 'btn primary', text: 'Take a loan' }); loan.onclick = function () { call('market', { action: 'loan', amount: la.value }).then(function (r) { after(r); }); };
      return h('div', { className: 'mk-debt' }, [
        h('div', { className: 'mk-detail' }, [h('h4', { text: 'Pay debt' }), note('Debt is never paid automatically. Choose how much. If you do not have that much karma, the payment is cancelled.'), h('div', { className: 'ef' }, [amt, pay])]),
        h('div', { className: 'mk-detail' }, [h('h4', { text: 'Loan' }), note('Loans are approved automatically and added to your debt. You cannot borrow while you are in debt, and you can borrow at most 5,000 karma.'), h('div', { className: 'ef' }, [la, loan])]),
      ]);
    }
    return { enter: function () { msg = ''; enter(); }, reset: reset };
  })();

  /* ======================= headmaster: pick a soul by portrait (Effects and Items share the choice) ======================= */
  var pickedId = '';
  function pickedChar(cs) { var c = cs.filter(function (x) { return x.id === pickedId; })[0] || cs[0]; pickedId = c ? c.id : ''; return c; }
  function charPicker(cs, onPick) {
    var row = h('div', { className: 'cp-row', role: 'group', 'aria-label': 'Choose a soul' });
    cs.forEach(function (c) {
      var b = h('button', { type: 'button', className: 'cp-item', title: c.name, 'aria-pressed': String(c.id === pickedId), 'data-id': c.id }, [
        c.image ? h('img', { className: 'cp-img', src: c.image, alt: '' }) : h('span', { className: 'cp-img cp-none', text: (c.name || '?').charAt(0).toUpperCase() }),
        h('span', { className: 'cp-name', text: c.name || 'Unnamed' })]);
      b.onclick = function () { onPick(c.id); };
      row.appendChild(b);
    });
    return row;
  }
  function markPicker(row, id) { pickedId = id; Array.prototype.forEach.call(row.children, function (n) { n.setAttribute('aria-pressed', String(n.getAttribute('data-id') === id)); }); }

  /* ======================= ITEMS (players: inventory and selling; headmaster: quick tools) ======================= */
  modules.items = (function () {
    var root = $('pane-items'), msg = '', err = false;
    function isDM() { return !!G.creds(); }
    function money(n) { return Number(n || 0).toLocaleString('en-US'); }
    function reset() { clear(root); msg = ''; }
    function badge(t, on) { return h('span', { className: 'bdg' + (on ? ' on' : ''), text: t }); }
    function mine() {
      call('market', { action: 'myitems' }).then(function (r) {
        clear(root); if (!r.ok) { root.appendChild(note(r.j.error || 'Could not open your items.')); return; }
        var total = 0; r.j.items.forEach(function (x) { total += x.qty; });
        var wrap = h('div', { className: 'hb-wrap' }, [h('p', { className: 'mk-tot', text: 'You carry ' + total + ' item' + (total === 1 ? '' : 's') + ' (' + r.j.items.length + ' kind' + (r.j.items.length === 1 ? '' : 's') + ')' }),
          h('p', { className: 'mk-tot' + (r.j.debt ? ' bad' : ''), text: 'Karma: ' + money(r.j.karma) + (r.j.debt ? ' · Debt: -' + money(r.j.debt) : '') })]);
        if (r.j.battle) wrap.appendChild(h('p', { className: 'mk-msg bad', text: 'You are in battle. You cannot use items or the Marketplace until the headmaster ends the battle.' }));
        if (msg) wrap.appendChild(h('p', { className: 'mk-msg' + (err ? ' bad' : ''), text: msg, role: 'status' }));
        if (!r.j.items.length) wrap.appendChild(note('Nothing here yet. The headmaster adds items as you earn them.'));
        var ol = h('ol', { className: 'il-list' });
        function done(r2, fail) { err = !r2.ok; msg = r2.ok ? r2.j.message : (r2.j.error || fail); if (r2.ok && G.reloadChar) G.reloadChar(); mine(); if (r2.ok && r2.j.changes && r2.j.changes.length) G.showResult(r2.j.item || 'Item', r2.j.changes); }
        r.j.items.forEach(function (x) {
          var lk = !!x.locked;
          var ub = h('button', { type: 'button', className: 'btn sq primary' });
          function useGo(stat) { call('market', { action: 'use', name: x.name, stat: stat || '' }).then(function (r3) { done(r3, 'Could not use it.'); }); }
          if (x.statUp && x.statUp.mode === 'choose') ub.onclick = function () { G.pickStat(x, useGo); }; else G.two(ub, 'Use', function () { useGo(); });
          ub.textContent = 'Use'; ub.disabled = !x.usable || lk || !!r.j.battle;
          var tb = h('button', { type: 'button', className: 'btn sq', text: 'Trade' }); tb.disabled = lk;
          tb.onclick = function () { var s = document.querySelector('#it-trade select[aria-label="Item to give"]'); if (s) { s.value = x.name; if (s.onchange) s.onchange(); } var t = $('it-trade'); if (t) t.scrollIntoView({ block: 'center' }); };
          var q = h('input', { type: 'number', min: 1, max: x.qty, value: 1, className: 'ni', 'aria-label': 'How many to sell' }), sb = h('button', { type: 'button', className: 'btn sq' });
          G.two(sb, 'Sell', function () { call('market', { action: 'sell', name: x.name, qty: q.value }).then(function (r2) { done(r2, 'Could not sell.'); }); }); sb.textContent = 'Sell'; sb.disabled = !x.sellable || lk || !!r.j.battle;
          var kb = h('button', { type: 'button', className: 'btn sq', text: lk ? 'Unlock' : 'Lock', 'aria-pressed': String(lk), title: 'A locked item cannot be used, sold or traded by accident' });
          kb.onclick = function () { call('market', { action: 'lock', name: x.name, locked: !lk }).then(function (r4) { done(r4, 'Could not change the lock.'); }); };
          ol.appendChild(h('li', { className: lk ? 'locked' : '' }, [
            h('div', { className: 'il-line' }, [h('b', { text: x.name }), h('span', { className: 'mono', text: '×' + x.qty }), lk ? badge('Locked', true) : null, x.sellable ? badge('Sells for ' + money(x.worth) + ' each', true) : null]),
            x.desc ? h('p', { className: 'pre hb-note', text: x.desc }) : null,
            x.dice && x.dice.length ? h('p', { className: 'mono hb-note', text: 'Rolls when used: ' + x.dice.join(', ') }) : null,
            x.use && x.use.length ? h('p', { className: 'mono hb-note', text: 'Gives: ' + x.use.join(', ') }) : null,
            x.statUp ? h('p', { className: 'mono hb-note', text: x.statUp.mode === 'random' ? 'Raises a random stat (' + x.statUp.stats.map(function (t) { return t.k; }).join(', ') + ') by +' + x.statUp.amt + ' for good.' : 'Raises one stat of your choice by +' + x.statUp.amt + ' for good.' }) : null,
            x.cures && x.cures.length ? h('p', { className: 'mono hb-note', text: 'Cures: ' + x.cures.join(', ') }) : null,
            h('div', { className: 'il-btns' }, [ub, tb, x.sellable && x.qty > 1 ? q : null, sb, kb])]));
        });
        if (r.j.items.length) wrap.appendChild(h('div', { className: 'mk-detail il' }, [h('h3', { className: 'il-h', text: 'List of items' }), ol]));
        wrap.appendChild(tradePanel(r.j));
        root.appendChild(wrap);
      });
    }
    // Give or trade with another soul: send items and/or karma as a gift, or offer a swap they can accept.
    var tf = { mode: 'send', to: '', gname: '', gqty: 1, gkarma: 0, wname: '', wqty: 1, wkarma: 0 }, tmsg = '', terr = false;
    function tradePanel(inv) {
      var box = h('div', { className: 'mk-detail', id: 'it-trade' }), td = null;
      function act(body) {
        call('trade', body).then(function (r) { terr = !r.ok; tmsg = r.ok ? (r.j.message || '') : (r.j.error || 'Something went wrong.'); if (r.ok) { td = r.j; if (G.reloadChar) G.reloadChar(); mine(); return; } drawT(); });
      }
      function num(k, ph) { var i = h('input', { type: 'number', min: 0, className: 'ni', value: tf[k], 'aria-label': ph }); i.oninput = function () { tf[k] = i.value; }; return i; }
      function drawT() {
        clear(box); box.appendChild(h('h4', { text: 'Give or trade with another soul' }));
        if (tmsg) box.appendChild(h('p', { className: 'mk-msg' + (terr ? ' bad' : ''), text: tmsg, role: 'status' }));
        if (!td) { box.appendChild(note('Loading…')); return; }
        var ms = h('select', { 'aria-label': 'Mode' }, [['send', 'Give (a gift, arrives at once)'], ['offer', 'Trade (they must accept)']].map(function (o) { return h('option', { value: o[0], text: o[1], selected: tf.mode === o[0] }); })); ms.onchange = function () { tf.mode = ms.value; drawT(); };
        var to = h('select', { 'aria-label': 'To' }, [h('option', { value: '', text: 'Choose a soul…' })].concat(td.members.map(function (m) { return h('option', { value: m.id, text: m.name, selected: m.id === tf.to }); }))); to.onchange = function () { tf.to = to.value; };
        var gi = h('select', { 'aria-label': 'Item to give' }, [h('option', { value: '', text: '— no item —' })].concat(inv.items.map(function (x) { return h('option', { value: x.name, text: x.name + ' (x' + x.qty + ')', selected: x.name === tf.gname }); }))); gi.onchange = function () { tf.gname = gi.value; };
        box.appendChild(h('div', { className: 'it-trade' }, [
          h('div', { className: 'ef' }, [ms, to]),
          h('div', { className: 'it-act' }, [h('b', { text: 'You give' }), h('div', { className: 'ef' }, [gi, 'x', num('gqty', 'Amount'), '+', num('gkarma', 'Karma'), 'karma'])]),
        ]));
        if (tf.mode === 'offer') {
          var wn = h('input', { value: tf.wname, maxLength: 100, placeholder: 'Item you want (type its exact name)', 'aria-label': 'Item you want' }); wn.oninput = function () { tf.wname = wn.value; };
          box.appendChild(h('div', { className: 'it-act' }, [h('b', { text: 'You want back' }), h('div', { className: 'ef' }, [wn, 'x', num('wqty', 'Amount'), '+', num('wkarma', 'Karma'), 'karma'])]));
        }
        box.appendChild(note('You can give up to ' + money(td.karma) + ' karma. Nothing can go below zero.'));
        var go = h('button', { type: 'button', className: 'btn primary', text: tf.mode === 'send' ? 'Send' : 'Send offer' });
        go.onclick = function () {
          if (!tf.to) { terr = true; tmsg = 'Choose who this is for.'; drawT(); return; }
          act({ action: tf.mode, to: tf.to, give: { name: tf.gname, qty: tf.gqty, karma: tf.gkarma }, want: { name: tf.wname.trim(), qty: tf.wqty, karma: tf.wkarma } });
        };
        box.appendChild(go);
        function nice(s) { return [s.name ? s.qty + ' x ' + s.name : '', s.karma ? money(s.karma) + ' karma' : ''].filter(Boolean).join(' + ') || 'nothing'; }
        if (td.incoming.length) {
          box.appendChild(h('h4', { text: 'Offers to you' }));
          td.incoming.forEach(function (t) {
            var ac = h('button', { type: 'button', className: 'btn primary', text: 'Accept' }); ac.onclick = function () { act({ action: 'accept', id: t.id }); };
            var dc = h('button', { type: 'button', className: 'btn', text: 'Decline' }); dc.onclick = function () { act({ action: 'decline', id: t.id }); };
            box.appendChild(h('div', { className: 'it-offer' }, [h('p', { text: t.from + ' gives ' + nice(t.give) + ' for your ' + nice(t.want) + '.' }), h('div', { className: 'ef' }, [ac, dc])]));
          });
        }
        if (td.outgoing.length) {
          box.appendChild(h('h4', { text: 'Your open offers' }));
          td.outgoing.forEach(function (t) {
            var cn = h('button', { type: 'button', className: 'btn', text: 'Cancel' }); cn.onclick = function () { act({ action: 'cancel', id: t.id }); };
            box.appendChild(h('div', { className: 'it-offer' }, [h('p', { text: 'To ' + t.to + ': you give ' + nice(t.give) + ' for ' + nice(t.want) + '.' }), cn]));
          });
        }
      }
      drawT();
      call('trade', { action: 'list' }).then(function (r) { if (r.ok) { td = r.j; } else { terr = true; tmsg = r.j.error || 'Could not open trading.'; } drawT(); });
      return box;
    }
    function tools() {
      clear(root); var cs = G.chars();
      if (!cs.length) { root.appendChild(note('No saved characters yet.')); return; }
      function pick(label) { return h('select', { 'aria-label': label }, cs.map(function (c) { return h('option', { value: c.id, text: c.name }); })); }
      var who = pick('Character'), to = pick('Give to'), out = h('p', { className: 'mono hb-note', role: 'status' });
      var amt = h('input', { type: 'number', value: 0, className: 'ni', 'aria-label': 'Karma to add' });
      var nm = h('input', { placeholder: 'Item name', 'aria-label': 'Item name' }); nm.setAttribute('list', 'it-names');
      var dl = h('datalist', { id: 'it-names' }, G.worldList.filter(function (e) { return e.kind === 'item'; }).map(function (e) { return h('option', { value: e.name }); }));
      var qty = h('input', { type: 'number', min: 1, value: 1, className: 'ni', 'aria-label': 'Quantity' });
      // Right side: the long list of what the chosen soul carries, with Remove or Trade on each item. Left side: portraits and quick tools.
      var inv = h('div', { className: 'mk-detail il' }), everyone = h('div', { className: 'mk-detail' }), showAll = false, pk;
      pickedChar(cs); who.value = pickedId;
      function drawInv() {
        clear(inv); var c = G.chars().filter(function (x) { return x.id === pickedId; })[0];
        inv.appendChild(h('h3', { className: 'il-h', text: 'List of items' }));
        if (!c) { inv.appendChild(note('Pick a character.')); return; }
        var items = c.items || [], total = 0; items.forEach(function (x) { total += Number(x.qty) || 0; });
        inv.appendChild(h('p', { className: 'mono hb-note', text: c.name + ' · ' + (items.length ? total + ' item' + (total === 1 ? '' : 's') + ' (' + items.length + ' kind' + (items.length === 1 ? '' : 's') + ')' : 'nothing carried yet') + ' · Karma ' + money(parseInt(String(c.karma || '0').replace(/,/g, ''), 10) || 0) + (c.debt ? ' · Debt -' + money(c.debt) : '') }));
        var ol = h('ol', { className: 'il-list' });
        items.forEach(function (x) {
          var q = h('input', { type: 'number', min: 1, max: x.qty, value: 1, className: 'ni', 'aria-label': 'How many' });
          var rm = h('button', { type: 'button', className: 'btn sq', text: 'Remove' });
          G.two(rm, 'Remove', function () { act('hm_takeitem', { id: c.id, name: x.name, qty: q.value }); });
          var tos = h('select', { 'aria-label': 'Give to' }, cs.filter(function (o) { return o.id !== c.id; }).map(function (o) { return h('option', { value: o.id, text: o.name }); }));
          var gv = h('button', { type: 'button', className: 'btn sq', text: 'Give' });
          G.two(gv, 'Give', function () { if (tos.value) act('hm_giveitem', { id: c.id, name: x.name, qty: q.value, to: tos.value }); });
          var panel = h('div', { className: 'ef il-act' }, ['give to', tos, gv]); panel.hidden = true;
          var tg = h('button', { type: 'button', className: 'btn sq', text: 'Trade', 'aria-expanded': 'false' });
          tg.onclick = function () { panel.hidden = !panel.hidden; tg.setAttribute('aria-expanded', String(!panel.hidden)); };
          var lk = !!x.locked, kb = h('button', { type: 'button', className: 'btn sq', text: lk ? 'Unlock' : 'Lock', 'aria-pressed': String(lk), title: 'A locked item cannot be used, sold or traded by its owner' });
          kb.onclick = function () { act('hm_lockitem', { id: c.id, name: x.name, locked: !lk }); };
          // Use it for them (works in battle): applies the item's registry effect, rolls the dice, logs the rolls, removes one.
          var ub = h('button', { type: 'button', className: 'btn sq primary', text: 'Use for them' });
          function useGo(stat) {
            call('market', { action: 'hm_useitem', id: c.id, name: x.name, stat: stat || '' }).then(function (r) {
              if (!r.ok && r.j.needStat && r.j.stats) { G.pickStat({ name: x.name, statUp: { amt: r.j.amt, stats: r.j.stats } }, useGo); return; }
              out.className = 'mono hb-note' + (r.ok ? '' : ' bad'); out.textContent = r.ok ? r.j.message : (r.j.error || 'Failed.');
              if (r.ok) { if (G.reloadChars) G.reloadChars().then(function () { drawInv(); drawEveryone(); }); if (r.j.changes && r.j.changes.length) G.showResult(r.j.item, r.j.changes); }
            });
          }
          G.two(ub, 'Use for them', function () { useGo(); });
          ol.appendChild(h('li', { className: lk ? 'locked' : '' }, [h('div', { className: 'il-line' }, [h('b', { text: x.name }), h('span', { className: 'mono', text: '×' + x.qty }), lk ? badge('Locked', true) : null]), x.desc ? h('p', { className: 'pre hb-note', text: x.desc }) : null,
            h('div', { className: 'il-btns' }, [x.qty > 1 ? q : null, ub, rm, tg, kb]), panel]));
        });
        if (!items.length) inv.appendChild(note('Nothing carried yet.')); else inv.appendChild(ol);
      }
      function drawEveryone() {
        clear(everyone); var tg = h('button', { type: 'button', className: 'btn', text: showAll ? 'Hide everyone’s items' : 'Show everyone’s items' }); tg.onclick = function () { showAll = !showAll; drawEveryone(); };
        everyone.appendChild(tg); if (!showAll) return;
        cs.forEach(function (c) {
          var items = c.items || [];
          everyone.appendChild(h('div', { className: 'ef' }, [h('b', { text: c.name }), h('span', { className: 'mono', text: items.length ? items.map(function (x) { return x.name + ' x' + x.qty; }).join(', ') : 'nothing' })]));
        });
      }
      function choose(id) { markPicker(pk, id); who.value = id; drawInv(); }
      pk = charPicker(cs, choose);
      who.onchange = function () { choose(who.value); }; drawInv(); drawEveryone();
      function act(action, extra) {
        out.className = 'mono hb-note'; out.textContent = 'Working…';
        call('market', Object.assign({ action: action }, extra)).then(function (r) {
          out.textContent = r.ok ? r.j.message : (r.j.error || 'Failed.'); if (!r.ok) out.className = 'mono hb-note bad'; else if (G.reloadChars) G.reloadChars().then(function () { drawInv(); drawEveryone(); });
        });
      }
      function go(action, extra) {
        act(action, Object.assign({ id: who.value, name: nm.value, qty: qty.value }, extra || {}));
      }
      function btn(t, fn, confirm) { var b = h('button', { type: 'button', className: 'btn' + (confirm ? '' : ' primary'), text: t }); if (confirm) G.two(b, t, fn); else b.onclick = fn; return b; }
      var left = h('div', { className: 'dm-left' }, [pk, note('Quick tools: change a character without opening their sheet. Negative karma turns into debt by itself.'), h('div', { className: 'mk-detail' }, [h('p', { className: 'mono red', text: 'Character' }), who]),
        h('div', { className: 'mk-detail' }, [h('p', { className: 'mono red', text: 'Karma' }), h('div', { className: 'ef' }, [amt, btn('Add karma (use a minus to take it)', function () { go('hm_karma', { amount: amt.value }); })])]),
        h('div', { className: 'mk-detail' }, [h('p', { className: 'mono red', text: 'Items' }), h('div', { className: 'ef' }, [nm, dl, 'x', qty]),
          h('div', { className: 'ef' }, [btn('Add item', function () { go('hm_additem'); }), btn('Take item', function () { go('hm_takeitem'); }, true), to, btn('Give item to them', function () { go('hm_giveitem', { to: to.value }); }, true)]),
          note('Add creates the item for the character. Take removes it. Give moves it from the character above to the one beside the Give button.')]), everyone]);
      root.appendChild(h('div', { className: 'hb-wrap dm-split' }, [left, h('div', { className: 'dm-right' }, [out, inv])]));
    }
    return { enter: function () { msg = ''; clear(root).appendChild(note('Opening…')); if (isDM()) { (G.reloadChars ? G.reloadChars() : Promise.resolve()).then(tools); } else { mine(); } }, reset: reset };
  })();

  /* ======================= ROLL FOR AN NPC OR MONSTER ======================= */
  // The same panel players get (stats and saving throws, initiative, skills, free dice), but for a registry NPC or monster.
  // Skills and attacks get a roll button for every dice expression written in their text (like 2d6+3). Every roll is saved to the dice log under the NPC's name.
  var rollQ = Promise.resolve();
  function npcRoller(e, onLog) {
    var D = G.dice, who = e.name + ' (' + (e.type === 'npc' ? 'NPC' : 'Monster') + ')', ORDER = ['STR', 'INT', 'DEX', 'WIS', 'CHA', 'CON'];
    var adv = h('select', { 'aria-label': 'Advantage' }, [['n', 'Normal'], ['a', 'Advantage'], ['d', 'Disadvantage']].map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
    var hist = h('div', { className: 'hist' });
    function log(label, txt, cls) {
      hist.insertBefore(h('p', { className: 'mono ' + (cls || ''), text: label + ': ' + txt }), hist.firstChild); while (hist.children.length > 8) hist.removeChild(hist.lastChild);
      // One at a time, so quick clicks never overwrite each other on the server.
      rollQ = rollQ.then(function () { return call('rolls', { action: 'add', as: who, label: label, txt: txt, cls: cls || '' }); }).then(function () { if (onLog) onLog(); }, function () {});
    }
    function d20(m) {
      var a = D.dice(1, 20)[0], b = adv.value === 'n' ? null : D.dice(1, 20)[0], pk = b === null ? a : (adv.value === 'a' ? Math.max(a, b) : Math.min(a, b));
      return { vals: b === null ? [a] : [a, b], d: 20, txt: (b === null ? '[' + a + ']' : '[' + a + ', ' + b + '] keep ' + pk) + D.sgn(m) + ' = ' + (pk + m), cls: pk === 20 ? 'nat20' : pk === 1 ? 'nat1' : '' };
    }
    function go(label, x, btn, out) { if (btn) btn.disabled = true; if (out) out.textContent = ''; D.tumble(x, who + ': ' + label, function () { if (out) { out.textContent = ' ' + x.txt; out.className = 'mono ' + (x.cls || ''); } log(label, x.txt, x.cls); if (btn) btn.disabled = false; }); }
    function rollBtn(text, label, make) { var res = h('span', { className: 'mono' }), b = h('button', { type: 'button', className: 'btn', text: text }); b.onclick = function () { go(label, make(), b, res); }; return h('div', { className: 'ef' }, [b, res]); }
    // Saving throw bonuses written on the entry ("DEX +5, WIS +3") replace the plain modifier.
    var sv = {}; String(e.saves || '').replace(/\b(STR|DEX|CON|INT|WIS|CHA)\b\s*([+-]\s*\d+)/gi, function (m, k, n) { sv[k.toUpperCase()] = parseInt(n.replace(/\s/g, ''), 10); return m; });
    var stats = e.stats || {};
    var grid = h('div', { className: 'g6' }, ORDER.map(function (k) {
      var score = Number(stats[k]) || 0, m = sv[k] != null ? sv[k] : D.modOf(score), res = h('small', { className: 'mono' }), b = h('button', { type: 'button', className: 'btn', text: 'Roll ' + k + ' save' });
      b.onclick = function () { var x = d20(m); b.disabled = true; res.textContent = ''; D.tumble(x, who + ': ' + k + ' save', function () { res.textContent = x.txt; res.className = 'mono ' + x.cls; log(k + ' save', x.txt, x.cls); b.disabled = false; }); };
      return h('div', { className: 'stbox' }, [h('b', { text: k }), h('span', { className: 'big', text: String(score) }), h('small', { text: 'modifier ' + (m >= 0 ? '+' : '') + m + (sv[k] != null ? ' (listed)' : '') }), b, res]);
    }));
    var init = Number(e.initiative) || 0;
    var sec1 = h('section', { className: 'pv-sec' }, [h('p', { className: 'mono red', text: 'Stats and saving throws' }), h('div', { className: 'ef' }, [h('small', { text: 'd20 rolls:' }), adv]), grid, rollBtn('Roll initiative (' + D.sgn(init).trim() + ')', 'Initiative', function () { return d20(init); })]);

    // Skills and attacks: a button for each dice expression found in the text.
    var DICE = /(\d{1,2})d(\d{1,3})(?:\s*([+-])\s*(\d{1,3}))?/gi;
    function parts(label, text) {
      text = String(text || '').trim(); if (!text) return null;
      var name = (text.split(/[:\u2014\u2013(\n]|\s-\s/)[0] || text).trim().slice(0, 50) || label, box = h('div', { className: 'pv-skill' }, [h('p', { className: 'mono', text: label }), h('h3', { text: name })]), n = 0, m;
      var hit = /([+-]\s*\d+)\s*(?:to hit|hit)/i.exec(text);
      if (hit) { var hb = parseInt(hit[1].replace(/\s/g, ''), 10); box.appendChild(rollBtn('Roll to hit ' + (hb >= 0 ? '+' : '') + hb, name + ' to hit', function () { return d20(hb); })); n++; }
      DICE.lastIndex = 0;
      while ((m = DICE.exec(text))) {
        (function (cnt, die, flat, expr) { n++; box.appendChild(rollBtn('Roll ' + expr, name + ' ' + expr, function () { return D.plain(Math.min(20, cnt), die, flat); })); })(+m[1], +m[2], m[3] ? (m[3] === '-' ? -1 : 1) * +m[4] : 0, m[0].replace(/\s/g, ''));
      }
      if (!n) box.appendChild(h('small', { className: 'mono', text: 'No dice written here. Add dice like 2d6+3 to its text and a roll button appears.' }));
      if (text.length > name.length) box.appendChild(h('p', { className: 'pre hb-note', text: text }));
      return box;
    }
    var skillBoxes = [];
    if (e.basic) skillBoxes.push(parts('Basic skill', e.basic));
    (e.skills || []).forEach(function (t, i) { skillBoxes.push(parts('Skill ' + (i + 1), t)); });
    if (e.ultimate) skillBoxes.push(parts('Ultimate', e.ultimate));
    String(e.attacks || '').split('\n').forEach(function (t, i) { if (t.trim()) skillBoxes.push(parts('Attack ' + (i + 1), t)); });
    var sec2 = h('section', { className: 'pv-sec' }, [h('p', { className: 'mono red', text: 'Skills and attacks' })].concat(skillBoxes.filter(Boolean).length ? skillBoxes.filter(Boolean) : [note('This entry has no skills or attacks yet. Add them in Character details › Registry.')]));

    var cnt = h('input', { type: 'number', value: 1, className: 'ni', 'aria-label': 'Number of dice' }), mod = h('input', { type: 'number', value: 0, className: 'ni', 'aria-label': 'Modifier' });
    var die = h('select', { 'aria-label': 'Die' }, [4, 6, 8, 10, 12, 20, 100].map(function (n) { return h('option', { text: 'd' + n, value: n, selected: n === 20 }); }));
    function free(n, d, m) { var lab = n + 'd' + d + (m ? (m > 0 ? '+' : '') + m : ''); go(lab, (n === 1 && d === 20) ? d20(m) : D.plain(n, d, m)); }
    var rb = h('button', { type: 'button', className: 'btn primary', text: 'Roll' }); rb.onclick = function () { free(Math.max(1, Math.min(20, Math.floor(+cnt.value) || 1)), +die.value, Math.floor(+mod.value) || 0); };
    var quick = h('div', { className: 'ef' }, [4, 6, 8, 10, 12, 20, 100].map(function (n) { var q = h('button', { type: 'button', className: 'btn', text: 'd' + n }); q.onclick = function () { free(1, n, 0); }; return q; }));
    var sec3 = h('section', { className: 'pv-sec' }, [h('p', { className: 'mono red', text: 'Dice' }), quick, h('div', { className: 'ef' }, [cnt, 'x', die, '+', mod, rb]), hist]);
    return h('div', { className: 'pv nr' }, [note('Rolling as ' + e.name + '. Every roll is saved to the dice log under this name, and everyone can see it.'), sec1, sec2, sec3]);
  }

  /* ======================= DICE LOG ======================= */
  modules.dice = (function () {
    var root = $('pane-dice'), timer = null, rev = '', rows = [], sel = null, box = null;
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function draw() {
      if (!box) return;
      var dm = !!G.creds(); clear(box); var f = rows.filter(function (x) { return !sel.value || x.name === sel.value; });
      if (!f.length) { box.appendChild(note('No rolls yet.')); return; }
      var t = h('table', { className: 'dl-tbl' }, [h('tr', {}, [h('th', { text: 'When' }), h('th', { text: 'Soul' }), h('th', { text: 'Roll' }), h('th', { text: 'Result' }), dm ? h('th', { text: '' }) : null])]);
      f.forEach(function (x) {
        var del = null;
        if (dm) { del = h('button', { type: 'button', className: 'link', text: 'Delete', 'aria-label': 'Delete this roll' }); del.onclick = function () { rows = rows.filter(function (y) { return !(y.o === x.o && y.at === x.at); }); draw(); call('rolls', { action: 'del', o: x.o, at: x.at }).then(function () { rev = ''; load(false); }); }; }
        t.appendChild(h('tr', {}, [h('td', { className: 'mono', text: new Date(x.at).toLocaleString() }), h('td', { text: x.name }), h('td', { text: x.label }), h('td', { className: 'mono ' + (x.cls || ''), text: x.txt }), dm ? h('td', {}, [del]) : null]));
      });
      box.appendChild(t);
    }
    // Headmaster only: clear out old rolls so the list never fills up with spam.
    function cleaner() {
      function run(body) { call('rolls', Object.assign({ action: 'clear' }, body)).then(function (r) { out.textContent = r.ok ? 'Deleted ' + r.j.gone + ' roll' + (r.j.gone === 1 ? '' : 's') + '.' : (r.j.error || 'Could not delete.'); rev = ''; load(false); }); }
      var out = h('small', { className: 'mono', role: 'status' }), days = h('input', { type: 'number', min: 0, value: 7, className: 'ni', 'aria-label': 'Days' });
      var b1 = h('button', { type: 'button', className: 'btn', text: 'Delete rolls older than the days beside it' }), b2 = h('button', { type: 'button', className: 'btn', text: 'Delete the soul chosen below' }), b3 = h('button', { type: 'button', className: 'btn', text: 'Delete all rolls' });
      G.two(b1, 'Delete rolls older than the days beside it', function () { run({ mode: 'older', days: days.value }); });
      G.two(b2, 'Delete the soul chosen below', function () { if (!sel.value) { out.textContent = 'Choose a soul in the list below first.'; return; } run({ mode: 'name', name: sel.value }); });
      G.two(b3, 'Delete all rolls', function () { run({ mode: 'all' }); });
      return h('div', { className: 'nr-pick' }, [h('p', { className: 'mono red', text: 'Clean up the dice log' }), h('div', { className: 'ef' }, [days, 'days', b1]), h('div', { className: 'ef' }, [b2, b3]), out, note('You can also delete a single roll with the Delete link on its row.')]);
    }
    function fillNames() {
      var keep = sel.value, names = [];
      rows.forEach(function (x) { if (x.name && names.indexOf(x.name) < 0) names.push(x.name); });
      clear(sel); sel.appendChild(h('option', { value: '', text: 'Everyone' })); names.sort().forEach(function (n) { sel.appendChild(h('option', { value: n, text: n })); });
      sel.value = names.indexOf(keep) >= 0 ? keep : '';
    }
    // Asks the server for rolls; when nothing changed it answers instantly with a one-line "same".
    function load(first) {
      return call('rolls', { action: 'list', rev: first ? '' : rev }).then(function (r) {
        if (first) clear(root);
        if (!r.ok) { if (first) root.appendChild(note(r.j.error || 'Could not open the dice log.')); return; }
        if (r.j.same) return;
        rev = r.j.rev || ''; rows = r.j.rolls || [];
        if (first) {
          var dm = !!G.creds(); sel = h('select', { 'aria-label': 'Filter by character' }); box = h('div', { className: 'dl-wrap' });
          sel.onchange = draw; fillNames();
          root.appendChild(h('div', { className: 'hb-wrap' }, [dm ? cleaner() : null, h('div', { className: 'ef' }, [sel, note(dm ? 'The latest 300 rolls from every soul. New rolls appear by themselves.' : 'Everyone’s latest rolls, newest first. New rolls appear by themselves.')]), box]));
        } else fillNames();
        draw();
      });
    }
    function enter() {
      stop(); rev = ''; clear(root).appendChild(note('Gathering the dice…'));
      load(true).then(function () { timer = setInterval(function () { if (!document.hidden) load(false); }, 3000); });
    }
    return { enter: enter, leave: stop, refresh: function () { return load(false); }, wake: function () { if (box && timer) load(false); }, reset: function () { stop(); box = null; rows = []; rev = ''; clear(root); } };
  })();

  /* ======================= EFFECTS (headmaster) ======================= */
  // Put a skill's buff or debuff (or one you type in) on chosen souls, see who is carrying what, and end it when you want.
  modules.fx = (function () {
    var root = $('pane-fx'), data = null, msg = '', err = false, caster = '', skill = '', source = '', fx = [], pickFx = '', stEdit = null, targets = {}, kind = 'char', npcQ = '', npcSel = '', npcHost = h('div', { className: 'dm-sheet' });
    function reset() { data = null; clear(root); caster = skill = source = ''; fx = []; pickFx = ''; stEdit = null; targets = {}; msg = ''; kind = 'char'; npcQ = ''; npcSel = ''; clear(npcHost); }
    function enter() {
      var fresh = G.reloadChars ? G.reloadChars() : Promise.resolve();
      Promise.all([fresh, call('effects', { action: 'list' })]).then(function (rs) {
        var r = rs[1];
        if (!r.ok) { clear(root).appendChild(note(r.j.error || 'Could not open the effects.')); return; }
        data = r.j; draw();
      });
    }
    function act(body) { call('effects', body).then(function (r) { err = !r.ok; msg = r.ok ? (r.j.message || '') : (r.j.error || 'Something went wrong.'); if (r.ok) { data = r.j; data.chars.forEach(function (d) { var f = G.chars().filter(function (x) { return x.id === d.id; })[0]; if (f) f.buffs = d.buffs; }); } draw(); }); }
    // Live: when any sheet changes on the server, redraw only the sheet on the right (never the forms on the left).
    var syncShow = null; G.onSync = function () { if (syncShow && root.offsetParent) syncShow(); };
    function draw() {
      clear(root); var wrap = h('div', { className: 'dm-col' });
      wrap.appendChild(note('Buffs and debuffs change a soul’s stats on their sheet by themselves (the modifiers, saves and damage bonuses recalculate). The base stats are never touched, so ending an effect puts everything back.'));
      if (msg) wrap.appendChild(h('p', { className: 'mk-msg' + (err ? ' bad' : ''), text: msg, role: 'status' }));

      /* ----- battle: while in battle a soul's items wait for you ----- */
      var bp = h('div', { className: 'mk-detail' }, [h('h4', { text: 'Battle' }), note('Tap a soul to mark them In battle. While in battle they cannot use items or the Marketplace. Tap again, or press End battle for everyone, when it is over.')]);
      var bchips = h('div', { className: 'fx-chips' }, data.chars.map(function (c) {
        var x = h('button', { type: 'button', className: 'fx-chip', 'aria-pressed': String(!!c.inBattle), text: c.name + (c.inBattle ? ' · in battle' : '') }); x.onclick = function () { act({ action: 'battle', targets: [c.id], on: !c.inBattle }); }; return x;
      }));
      var allIn = h('button', { type: 'button', className: 'btn', text: 'Everyone in battle' }), allOut = h('button', { type: 'button', className: 'btn', text: 'End battle for everyone' });
      allIn.onclick = function () { act({ action: 'battle', targets: data.chars.map(function (c) { return c.id; }), on: true }); }; allOut.onclick = function () { act({ action: 'battle', targets: data.chars.map(function (c) { return c.id; }), on: false }); };
      bp.appendChild(bchips); bp.appendChild(h('div', { className: 'ef' }, [allIn, allOut])); wrap.appendChild(bp);

      /* ----- active effects, grouped by the cast that made them ----- */
      var groups = {}, order = [];
      data.chars.forEach(function (c) { c.buffs.forEach(function (b) { var g = b.group || b.id; if (!groups[g]) { groups[g] = { id: g, source: b.source, at: b.at, fx: [], souls: [] }; order.push(g); } var G0 = groups[g]; if (!G0.fx.some(function (x) { return x.stat === b.stat && x.amt === b.amt && x.perm === b.perm; })) G0.fx.push(b); G0.souls.push({ c: c, b: b }); }); });
      var act1 = h('div', { className: 'mk-detail' }, [h('h4', { text: 'Active effects' })]);
      if (!order.length) act1.appendChild(note('No one is carrying an effect right now.'));
      order.sort(function (a, b) { return groups[a].at < groups[b].at ? 1 : -1; }).forEach(function (g) {
        var gr = groups[g], temp = gr.fx.some(function (x) { return !x.perm; });
        var endAll = h('button', { type: 'button', className: 'btn' + (temp ? ' primary' : '') });
        G.two(endAll, temp ? 'End for everyone' : 'Remove for everyone', function () { act({ action: 'end', group: gr.id }); }); endAll.textContent = temp ? 'End for everyone' : 'Remove for everyone';
        var chips = h('div', { className: 'fx-chips' }, gr.souls.map(function (s) {
          var x = h('button', { type: 'button', className: 'fx-chip', title: 'End this on ' + s.c.name + ' only', text: s.c.name + ' ✕' }); x.onclick = function () { act({ action: 'end', id: s.c.id, bid: s.b.id }); }; return x;
        }).filter(function (x, i, a) { return true; }));
        act1.appendChild(h('div', { className: 'fx-row' + (temp ? ' temp' : '') }, [h('div', { className: 'ef' }, [h('b', { text: gr.source }), h('span', { className: 'bdg' + (temp ? ' on' : ''), text: temp ? 'Until you end it' : 'Permanent' }), endAll]), h('p', { className: 'mono', text: gr.fx.map(function (x) { return fxText(x); }).join(' · ') }), chips]));
      });
      wrap.appendChild(act1);

      /* ----- apply ----- */
      var lib = data.statuses || [], chosen = lib.filter(function (x) { return x.id === pickFx; })[0];
      if (!chosen) pickFx = '';
      var ap = h('div', { className: 'mk-detail' }, [h('h4', { text: 'Apply an effect' })]);
      var ps = h('select', { 'aria-label': 'Which effect' }, [h('option', { value: '', text: 'A custom effect (type it in)', selected: !pickFx })].concat(lib.length ? [h('optgroup', { label: 'Fixed effects' }, lib.map(function (x) { return h('option', { value: x.id, text: x.name + (x.kind === 'buff' ? ' (buff)' : ''), selected: x.id === pickFx }); }))] : []));
      ps.onchange = function () { pickFx = ps.value; draw(); };
      ap.appendChild(ps);
      if (chosen) {
        ap.appendChild(note(chosen.desc || 'No description.'));
        ap.appendChild(note(chosen.fx.length ? 'Changes: ' + chosen.fx.map(fxText).join(' · ') : 'A status only: no stat changes. An item that cures it removes it automatically.'));
      } else {
        var sn = h('input', { value: source, maxLength: 100, placeholder: 'Name of the effect (shown to the souls)', 'aria-label': 'Effect name' }); sn.oninput = function () { source = sn.value; };
        ap.appendChild(h('label', { className: 'fl' }, [h('span', { text: 'Name' }), sn]));
        ap.appendChild(G.fxEditor(fx, draw));
      }
      ap.appendChild(h('p', { className: 'mono red', text: 'Apply to' }));
      var all = h('button', { type: 'button', className: 'link', text: 'All' }), none = h('button', { type: 'button', className: 'link', text: 'None' });
      all.onclick = function () { data.chars.forEach(function (c) { targets[c.id] = true; }); draw(); }; none.onclick = function () { targets = {}; draw(); };
      ap.appendChild(h('div', { className: 'ef' }, [all, none]));
      ap.appendChild(h('div', { className: 'fx-targets' }, data.chars.map(function (c) { var i = h('input', { type: 'checkbox', checked: !!targets[c.id] }); i.onchange = function () { targets[c.id] = i.checked; }; return h('label', { className: 'chk' }, [i, h('span', { text: c.name })]); })));
      var go = h('button', { type: 'button', className: 'btn primary', text: 'Apply' });
      go.onclick = function () {
        var ids = data.chars.filter(function (c) { return targets[c.id]; }).map(function (c) { return c.id; });
        if (!ids.length) { err = true; msg = 'Tick at least one soul to apply it to.'; draw(); return; }
        act(pickFx ? { action: 'apply', targets: ids, statusId: pickFx } : { action: 'apply', targets: ids, source: source, fx: fx });
      };
      ap.appendChild(go);
      wrap.appendChild(ap);

      /* ----- fixed effects library ----- */
      var fl = h('div', { className: 'mk-detail' }, [h('h4', { text: 'Fixed effects' }), note('Effects you use again and again (poison, stun, corruption…). Apply one in a click above. An item that cures it takes it off by itself, so you never have to remove it by hand.')]);
      lib.forEach(function (x) {
        var ed = h('button', { type: 'button', className: 'btn', text: 'Edit' }), del = h('button', { type: 'button', className: 'btn' });
        ed.onclick = function () { stEdit = JSON.parse(JSON.stringify(x)); draw(); };
        G.two(del, 'Delete', function () { act({ action: 'sdelete', id: x.id }); }); del.textContent = 'Delete';
        fl.appendChild(h('div', { className: 'fx-row' }, [h('div', { className: 'ef' }, [h('b', { text: x.name }), h('span', { className: 'bdg' + (x.kind === 'debuff' ? ' on' : ''), text: x.kind === 'debuff' ? 'Debuff' : 'Buff' }), ed, del]), h('p', { className: 'mono', text: (x.desc || '') + (x.fx.length ? (x.desc ? ' · ' : '') + x.fx.map(fxText).join(' · ') : '') })]));
      });
      if (stEdit) {
        var nm = h('input', { value: stEdit.name || '', maxLength: 60, placeholder: 'Name (e.g. Poison)', 'aria-label': 'Fixed effect name' }); nm.oninput = function () { stEdit.name = nm.value; };
        var kd = h('select', { 'aria-label': 'Buff or debuff' }, [['debuff', 'Debuff'], ['buff', 'Buff']].map(function (o) { return h('option', { value: o[0], text: o[1], selected: (stEdit.kind || 'debuff') === o[0] }); })); kd.onchange = function () { stEdit.kind = kd.value; };
        var ds = h('input', { value: stEdit.desc || '', maxLength: 200, placeholder: 'What it does (shown to the souls)', 'aria-label': 'Description' }); ds.oninput = function () { stEdit.desc = ds.value; };
        var sv = h('button', { type: 'button', className: 'btn primary', text: 'Save fixed effect' }), cn = h('button', { type: 'button', className: 'btn', text: 'Cancel' });
        sv.onclick = function () { var st = stEdit; stEdit = null; act({ action: 'ssave', status: st }); }; cn.onclick = function () { stEdit = null; draw(); };
        stEdit.fx = stEdit.fx || [];
        fl.appendChild(h('div', { className: 'fx-row temp' }, [h('div', { className: 'ef' }, [nm, kd]), h('label', { className: 'fl' }, [h('span', { text: 'Description' }), ds]), h('div', { className: 'fl' }, [h('span', { text: 'Stat changes it causes (optional). Leave empty for a status like Poison or Stun that only needs to be tracked and cured.' }), G.fxEditor(stEdit.fx, draw)]), h('div', { className: 'ef' }, [sv, cn])]));
      } else {
        var nw = h('button', { type: 'button', className: 'btn', text: '+ New fixed effect' }); nw.onclick = function () { stEdit = { id: '', name: '', kind: 'debuff', desc: '', fx: [] }; draw(); };
        fl.appendChild(nw);
      }
      wrap.appendChild(fl);
      // Portraits on the left pick whose sheet shows on the right (read-only), so skills, stats and effects are one glance away.
      function fullList() { return data.chars.map(function (d) { return G.chars().filter(function (x) { return x.id === d.id; })[0]; }).filter(Boolean); }
      var cs = fullList();
      var host = h('div', { className: 'dm-sheet' }), pk;
      function show() { clear(host); var c = fullList().filter(function (x) { return x.id === pickedId; })[0]; if (!c) { host.appendChild(note('No saved characters yet.')); return; } G.sheetInto(c, host); }
      pickedChar(cs); pk = charPicker(cs, function (id) { markPicker(pk, id); show(); }); show(); syncShow = show;
      // NPCs and monsters: a searchable list of names (no pictures); the right side shows their stats with rolls for their saves, skills and attacks.
      var tog = h('div', { className: 'mp-mini' }, [['char', 'Characters'], ['npc', 'NPCs'], ['shadow', 'Monsters']].map(function (o) {
        var b = h('button', { type: 'button', text: o[1], 'aria-pressed': String(kind === o[0]) }); b.onclick = function () { kind = o[0]; draw(); }; return b;
      }));
      function npcSummary(e) {
        var v = [['HP', e.hp], ['Armor', e.armor], ['Speed', e.speed !== '' && e.speed != null ? e.speed + ' ft' : ''], ['Size', e.size], ['Level / CR', e.level]].filter(function (x) { return x[1] !== '' && x[1] != null; });
        var sum = [h('h3', { text: e.name }), h('p', { className: 'mono red', text: (e.type === 'npc' ? 'NPC' : 'Monster') + (e.listed === false ? ' · hidden from players' : '') + (e.statsOpen === false ? ' · stats sealed' : '') })];
        sum.push(h('div', { className: 'mp-vit' }, v.map(function (x) { return h('div', {}, [h('span', { className: 'mono', text: x[0] }), h('b', { text: String(x[1]) })]); })));
        return h('div', { className: 'mk-detail' }, sum);
      }
      function showNpc() {
        clear(npcHost); var e = G.reg().filter(function (x) { return x.id === npcSel && x.type === kind; })[0];
        if (!e) { npcHost.appendChild(note('Pick a name on the left to see its stats and roll for it.')); return; }
        npcHost.appendChild(npcSummary(e));
        npcHost.appendChild(npcRoller(e, function () { if (modules.dice && modules.dice.wake) modules.dice.wake(); }));
      }
      var npcPane = null;
      if (kind !== 'char') {
        var reg = G.reg().filter(function (e) { return e.type === kind; }), q = h('input', { type: 'search', value: npcQ, placeholder: 'Search ' + (kind === 'npc' ? 'NPCs' : 'monsters') + '…', 'aria-label': 'Search' }), nl = h('div', { className: 'fx-nlist' });
        var fill = function () {
          clear(nl); var f = reg.filter(function (e) { return !npcQ || e.name.toLowerCase().indexOf(npcQ.toLowerCase()) >= 0; });
          if (!f.length) nl.appendChild(note(reg.length ? 'Nothing found.' : 'None yet. Add them in Character details › Registry.'));
          f.forEach(function (e) { var b = h('button', { type: 'button', className: 'fx-nbtn', text: e.name, 'aria-pressed': String(e.id === npcSel) }); b.onclick = function () { npcSel = e.id; fill(); showNpc(); }; nl.appendChild(b); });
        };
        q.oninput = function () { npcQ = q.value; fill(); }; fill(); showNpc(); npcPane = h('div', { className: 'fx-npc' }, [q, nl]);
      }
      root.appendChild(h('div', { className: 'hb-wrap dm-split' }, [h('div', { className: 'dm-left' }, [tog, kind === 'char' ? pk : npcPane, wrap]), h('div', { className: 'dm-right' }, [kind === 'char' ? host : npcHost])]));
    }
    return { enter: function () { msg = ''; enter(); }, reset: reset };
  })();

  /* ---------- the unread ping: a pill under the top bar (every tab) and a dot on the Chat tab ----------
     The unread messages live on the server, so the ping is still there after logging out and back in.
     It goes away when the message is opened, or with the X (until something new arrives). */
  var ping = { on: false, n: 0 }, pingT = null, banner = null, chatBtn = nav.querySelector('button[data-pane="chat"]');
  function buildBanner() {
    if (banner) return;
    var bar = document.querySelector('#adm .adm-bar'); if (!bar) return;
    var go = h('button', { type: 'button', className: 'chat-ping-go' }), x = h('button', { type: 'button', className: 'chat-ping-x', 'aria-label': 'Dismiss', text: '×' });
    banner = h('div', { className: 'chat-ping', hidden: true, role: 'status' }, [go, x]); banner.go = go;
    go.onclick = function () { modules.chat.focusUnread = true; pane('chat'); };
    x.onclick = function () { ping.on = false; drawPing(); call('chat', { action: 'dismiss' }); };
    bar.parentNode.insertBefore(banner, bar.nextSibling);
  }
  function drawPing() {
    buildBanner(); if (!banner) return;
    banner.hidden = !ping.on; banner.go.textContent = ping.n > 1 ? 'You have ' + ping.n + ' unread messages' : 'You have unread message';
    if (chatBtn) chatBtn.classList.toggle('has-ping', ping.on);
  }
  function setPing(on, n) { ping.on = !!on; ping.n = n || 0; drawPing(); }
  function pollPing() { if (!authBody()) return; call('chat', { action: 'ping' }).then(function (r) { if (r.ok) setPing(r.j.ping, r.j.n); }); }
  function startPing() { stopPing(); pollPing(); pingT = setInterval(function () { if (!document.hidden) pollPing(); }, 6000); }
  function stopPing() { clearInterval(pingT); pingT = null; setPing(false, 0); }

  /* ======================= CHAT ======================= */
  // Rooms (OOC, RP), private messages, group chats and NPC chats.
  modules.chat = (function () {
    var root = $('pane-chat'), ui = {}, built = false, me = null, members = [], byId = {}, contactIds = [], unread = {}, threads = [], groups = [], npcs = [], hiddenIds = [];
    var cur = { kind: 'ooc' }, mode = 'chat', lastKey = '', timer = null, mtimer = null, recent = [], recentNpc = [], editing = false, seen = {}, pending = [], info = null, mod = null;
    function isDM() { return !!G.creds(); }
    function reset() { built = false; clear(root); stop(); me = null; members = []; byId = {}; contactIds = []; unread = {}; threads = []; groups = []; npcs = []; hiddenIds = []; recent = []; recentNpc = []; cur = { kind: 'ooc' }; mode = 'chat'; lastKey = ''; seen = {}; pending = []; info = null; editing = false; }
    function stop() { clearInterval(timer); clearInterval(mtimer); timer = mtimer = null; }
    function body(extra) {
      var b = cur.kind === 'ooc' || cur.kind === 'rp' ? { channel: cur.kind } : cur.kind === 'pm' ? { with: cur.id } : cur.kind === 'gc' ? { gid: cur.id } : isDM() ? { npc: cur.id, with: cur.pid } : { npc: cur.id };
      return Object.assign(b, extra || {});
    }
    function keyOf(c) { return c.kind === 'pm' ? c.id : c.kind === 'gc' ? 'gc:' + c.id : c.kind === 'npc' ? 'npc:' + c.id + (isDM() ? ':' + c.pid : '') : ''; }
    function same(a, b) { return a.kind === b.kind && a.id === b.id && a.pid === b.pid; }
    function npcById(id) { var r = null; npcs.forEach(function (n) { if (n.id === id) r = n; }); if (!r && info && info.npc && info.npc.id === id) r = info.npc; return r; }
    function groupById(id) { var r = null; groups.forEach(function (g) { if (g.id === id) r = g; }); return r; }
    function nameOf(id) { return (byId[id] && byId[id].name) || '?'; }

    function enter() {
      if (!built) { clear(root).appendChild(note('Opening the chat…')); }
      call('chat', { action: 'members' }).then(function (r) {
        if (!r.ok) { clear(root).appendChild(note(r.j.error || 'Could not open the chat.')); return; }
        take(r.j); if (!built) { build(); }
        if (mod.focusUnread) { mod.focusUnread = false; var u = firstUnread(); if (u) cur = u; mode = 'chat'; }
        drawSide(); open(cur);
        stop(); timer = setInterval(function () { if (!document.hidden) fetchNew(); }, 2500); mtimer = setInterval(function () { if (!document.hidden) refreshMembers(); }, 12000);
      });
    }
    function take(j) {
      me = j.me; members = j.members; contactIds = j.contactIds || []; unread = j.unread || {}; threads = j.threads || []; groups = j.groups || []; npcs = j.npcs || []; hiddenIds = j.hidden || hiddenIds;
      byId = {}; members.forEach(function (m) { byId[m.id] = m; });
      if (info && info.people) Object.keys(info.people).forEach(function (id) { if (!byId[id]) byId[id] = info.people[id]; });
      if (j.ping !== undefined) setPing(j.ping, j.n);
    }
    function sig() { return JSON.stringify([unread, members.length, threads, groups, npcs.map(function (n) { return n.id + n.name; }), hiddenIds]); }
    function refreshMembers() { call('chat', { action: 'members' }).then(function (r) { if (!r.ok) return; var was = sig(); take(r.j); if (was !== sig() && !editing && mode !== 'manage') { drawSide(); if (mode === 'chat') setHead(); } }); }
    // The conversation the ping points at.
    function firstUnread() {
      var out = null;
      Object.keys(unread).forEach(function (k) {
        if (out) return; var p = k.split(':');
        if (p.length === 1 && byId[k] && contactIds.indexOf(k) >= 0) out = { kind: 'pm', id: k };
        else if (p[0] === 'gc' && groupById(p[1])) out = { kind: 'gc', id: p[1] };
        else if (p[0] === 'npc' && npcById(p[1])) out = isDM() ? (p[2] && byId[p[2]] ? { kind: 'npc', id: p[1], pid: p[2] } : null) : { kind: 'npc', id: p[1], pid: me };
      });
      return out;
    }

    function build() {
      clear(root); built = true;
      ui.side = h('div', { className: 'cht-side' }); ui.log = h('div', { className: 'cht-log', 'aria-live': 'polite' }); ui.head = h('h3', { className: 'cht-title' });
      ui.sub = h('p', { className: 'mono hb-note cht-sub', hidden: true });
      ui.gbtn = h('button', { type: 'button', className: 'btn sq cht-gbtn', text: 'Group settings', hidden: true }); ui.gbtn.onclick = function () { ui.gset.hidden = !ui.gset.hidden; if (!ui.gset.hidden) drawGset(); };
      ui.gset = h('div', { className: 'cht-gset', hidden: true });
      ui.in = h('input', { type: 'text', maxLength: 500, placeholder: 'Type…', 'aria-label': 'Message' });
      ui.file = h('input', { type: 'file', accept: 'image/*', hidden: true });
      ui.imgBtn = h('button', { type: 'button', className: 'btn', text: '+ image' }); ui.imgBtn.onclick = function () { ui.file.click(); };
      ui.send = h('button', { type: 'button', className: 'btn primary', text: 'Send' });
      ui.err = h('p', { className: 'mono hb-note' }); ui.pend = null;
      ui.file.onchange = function () {
        var f = ui.file.files && ui.file.files[0]; if (!f) return; ui.err.textContent = 'Preparing image…';
        shrink(f, 720, 170000, function (d) { if (!d) { ui.err.textContent = 'Could not use that image.'; return; } ui.pend = d; ui.imgBtn.textContent = 'Image ready ✓'; ui.err.textContent = ''; });
        ui.file.value = '';
      };
      ui.send.onclick = send; ui.in.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
      ui.cmp = h('div', { className: 'cht-compose' }, [ui.imgBtn, ui.in, ui.send, ui.file]);
      ui.wnote = h('p', { className: 'mono hb-note cht-watch', hidden: true, text: 'Read only. You can see this chat, but you are not in it.' });
      ui.top = h('div', { className: 'cht-top' }, [h('div', { className: 'cht-toprow' }, [ui.head, ui.gbtn]), ui.sub, ui.gset]);
      ui.main = h('div', { className: 'cht-main' }, [ui.top, ui.log, h('div', { className: 'cht-bottom' }, [ui.cmp, ui.wnote]), ui.err, note('Players appear by their first name. Chat logs are deleted every month.')]);
      root.appendChild(h('div', { className: 'hb-wrap cht' }, [ui.side, ui.main]));
      mod.ui = ui;
    }
    function avatar(m, cls) { return thumb(m && m.avatar, (m && m.name || '?').charAt(0).toUpperCase(), 'av ' + (cls || '')); }

    /* ----- the left column ----- */
    function sideBtn(label, count, active, fn, tag) {
      var b = h('button', { type: 'button', className: 'cht-btn', 'aria-pressed': String(!!active) }, [h('span', { text: label }), tag ? h('span', { className: 'cht-tag mono', text: tag }) : null, count ? h('span', { className: 'cht-new', text: '+' + count + ' new message' + (count > 1 ? 's' : '') }) : null]);
      b.onclick = fn; return b;
    }
    function pmList() {
      var ids = [];
      function add(id) { if (id && id !== me && ids.indexOf(id) < 0 && byId[id] && contactIds.indexOf(id) >= 0) ids.push(id); }
      Object.keys(unread).forEach(function (k) { if (k.indexOf(':') < 0) add(k); });
      threads.forEach(function (t) { if (t.indexOf('u:') === 0) add(t.slice(2)); });
      recent.forEach(add); return ids;
    }
    function npcItems() {
      var out = [], dup = {};
      function add(nid, pid) { var k = nid + '|' + pid; if (dup[k] || !npcById(nid) || (isDM() && !byId[pid])) return; dup[k] = 1; out.push({ nid: nid, pid: pid }); }
      Object.keys(unread).forEach(function (k) { var p = k.split(':'); if (p[0] !== 'npc') return; if (isDM() && p.length === 3) add(p[1], p[2]); else if (!isDM() && p.length === 2) add(p[1], me); });
      threads.forEach(function (t) { var p = t.split(':'); if (p[0] !== 'n') return; if (isDM() && p.length === 3) add(p[1], p[2]); else if (!isDM() && p.length === 2) add(p[1], me); });
      recentNpc.forEach(function (x) { add(x.nid, x.pid); });
      return out;
    }
    function drawSide() {
      if (!ui.side) return;
      clear(ui.side);
      var meM = byId[me] || { name: isDM() ? 'Headmaster' : '?' };
      if (isDM()) meM = byId.hm || meM;
      ui.side.appendChild(h('div', { className: 'cht-me' }, [avatar(meM, 'lg'), h('b', { text: meM.name }), h('small', { className: 'mono', text: isDM() ? 'Headmaster' : 'You' })]));
      if (isDM()) {
        var ed = h('button', { type: 'button', className: 'link', text: editing ? 'Close profile editor' : 'Edit my profile' }); ed.onclick = function () { editing = !editing; drawSide(); }; ui.side.appendChild(ed);
        if (editing) ui.side.appendChild(profileEditor(meM));
      } else ui.side.appendChild(note('Your name and icon come from your character.'));
      var on = function (kind, id, pid) { return mode === 'chat' && cur.kind === kind && cur.id === id && cur.pid === pid; };

      ui.side.appendChild(h('p', { className: 'mono red cht-h', text: 'Chat logs' }));
      [['ooc', 'OOC'], ['rp', 'RP chat']].forEach(function (c) { ui.side.appendChild(sideBtn(c[1], 0, on(c[0], undefined, undefined), function () { open({ kind: c[0] }); })); });

      ui.side.appendChild(h('p', { className: 'mono red cht-h', text: 'Private messages' }));
      ui.side.appendChild(sideBtn('+ New message', 0, mode === 'pick', function () { showPicker(); }, '')).classList.add('new');
      pmList().forEach(function (id) { ui.side.appendChild(sideBtn(byId[id].name, unread[id] || 0, on('pm', id, undefined), function () { open({ kind: 'pm', id: id }); })); });
      if (!isDM()) npcItems().forEach(function (it) { ui.side.appendChild(sideBtn(npcById(it.nid).name, unread['npc:' + it.nid] || 0, on('npc', it.nid, it.pid), function () { open({ kind: 'npc', id: it.nid, pid: it.pid }); }, 'NPC')); });

      ui.side.appendChild(h('p', { className: 'mono red cht-h', text: 'Group chats' }));
      ui.side.appendChild(sideBtn('+ New group', 0, mode === 'gcnew', function () { showGcNew(); })).classList.add('new');
      groups.forEach(function (g) { ui.side.appendChild(sideBtn(g.name, unread['gc:' + g.id] || 0, on('gc', g.id, undefined), function () { open({ kind: 'gc', id: g.id }); }, g.watch ? 'watching' : '')); });

      if (isDM()) {
        ui.side.appendChild(h('p', { className: 'mono red cht-h', text: 'NPC chats' }));
        ui.side.appendChild(sideBtn('+ Message as NPC', 0, mode === 'npcpick', function () { showNpcPicker(); })).classList.add('new');
        npcItems().forEach(function (it) { ui.side.appendChild(sideBtn(npcById(it.nid).name + ' → ' + nameOf(it.pid), unread['npc:' + it.nid + ':' + it.pid] || 0, on('npc', it.nid, it.pid), function () { open({ kind: 'npc', id: it.nid, pid: it.pid }); })); });
        ui.side.appendChild(h('p', { className: 'mono red cht-h', text: 'Headmaster tools' }));
        ui.side.appendChild(sideBtn('Contacts & NPCs', 0, mode === 'manage', function () { showManage(); }));
      }
    }
    function profileEditor(m) {
      var c = { image: m.avatar || '' }, crop = G.cropper(c), nm = h('input', { value: m.name === '?' ? '' : m.name, maxLength: 30, 'aria-label': 'Display name' });
      var sv = h('button', { type: 'button', className: 'btn primary', text: 'Save profile' }), st = h('small', { className: 'mono' });
      sv.onclick = function () {
        var b = { action: 'setprofile', name: nm.value }; if (/^data:/.test(c.image) || c.image === '') b.image = c.image;
        call('chat', b).then(function (r) { st.textContent = r.ok ? 'Saved.' : (r.j.error || 'Could not save.'); if (r.ok) { editing = false; enter(); } });
      };
      return h('div', { className: 'ed cht-prof' }, [h('label', { className: 'fl' }, [h('span', { text: 'Display name' }), nm]), crop, sv, st]);
    }

    /* ----- the middle: heading, group settings, log ----- */
    function setHead() {
      var t = '', sub = '';
      if (mode === 'pick') t = 'Who do you want to message?'; else if (mode === 'gcnew') t = 'New group chat'; else if (mode === 'npcpick') t = 'Message as an NPC'; else if (mode === 'manage') t = 'Contacts & NPCs';
      else if (cur.kind === 'ooc') t = 'OOC'; else if (cur.kind === 'rp') t = 'RP chat';
      else if (cur.kind === 'pm') t = nameOf(cur.id);
      else if (cur.kind === 'gc') { var g = groupById(cur.id); t = g ? g.name : 'Group chat'; if (g && g.watch) sub = 'You are reading this group without being in it. Players cannot see that you are here.'; }
      else if (cur.kind === 'npc') { var n = npcById(cur.id); t = isDM() ? (n ? n.name : 'NPC') + ' ↔ ' + nameOf(cur.pid) : (n ? n.name : 'NPC'); if (isDM()) sub = 'You are writing as ' + (n ? n.name : 'the NPC') + '. ' + nameOf(cur.pid) + ' sees you as the NPC.'; }
      ui.head.textContent = t; ui.sub.textContent = sub; ui.sub.hidden = !sub;
      ui.gbtn.hidden = !(mode === 'chat' && cur.kind === 'gc');
      ui.in.placeholder = cur.kind === 'npc' && isDM() && npcById(cur.id) ? 'Reply as ' + npcById(cur.id).name + '…' : 'Type…';
    }
    function setCan(can) { ui.cmp.hidden = !can || mode !== 'chat'; ui.wnote.hidden = can || mode !== 'chat'; }
    function showMode(m) { mode = m; lastKey = ''; seen = {}; pending = []; info = null; clear(ui.log); ui.gset.hidden = true; ui.cmp.hidden = true; ui.wnote.hidden = true; setHead(); drawSide(); }
    function open(c) {
      cur = c; mode = 'chat'; lastKey = ''; seen = {}; pending = []; info = null; clear(ui.log); clear(ui.gset); ui.gset.hidden = true;
      delete unread[keyOf(c)]; setCan(true); setHead(); drawSide(); fetchNew(true);
    }
    function fetchNew(first) {
      if (mode !== 'chat' || !built) return;
      var mine = JSON.stringify(cur);
      call('chat', body(lastKey ? { action: 'history', after: lastKey } : { action: 'history' })).then(function (r) {
        if (!r.ok) { if (first && mine === JSON.stringify(cur) && mode === 'chat') { clear(ui.log); ui.log.appendChild(note(r.j.error || 'Could not open this chat.')); setCan(false); } return; }
        if (mine !== JSON.stringify(cur) || mode !== 'chat') return;
        var j = r.j;
        if (j.people) { info = info || {}; info.people = Object.assign(info.people || {}, j.people); Object.keys(j.people).forEach(function (id) { if (!byId[id]) byId[id] = j.people[id]; }); }
        if (j.gc) { info = info || {}; var was = JSON.stringify(groupById(j.gc.id)); info.gc = j.gc; var i = groups.map(function (g) { return g.id; }).indexOf(j.gc.id); if (i >= 0) groups[i] = j.gc; else groups.push(j.gc); setHead(); if (was !== JSON.stringify(j.gc) && !ui.gset.hidden && !ui.gset.contains(document.activeElement)) drawGset(); }
        if (j.npc) { info = info || {}; info.npc = j.npc; setHead(); }
        setCan(j.canSend !== false);
        var msgs = j.msgs || []; if (!msgs.length) { if (first && !ui.log.children.length) ui.log.appendChild(h('p', { className: 'mono hb-note cht-empty', text: j.canSend === false ? 'Nothing written yet.' : 'No messages yet. Say something.' })); }
        else {
          var empty = ui.log.querySelector('.cht-empty'); if (empty) empty.remove();
          var near = ui.log.scrollHeight - ui.log.scrollTop - ui.log.clientHeight < 80 || first;
          msgs.forEach(function (m) {
            lastKey = m.k;
            if (seen[m.k]) return;
            if (isMine(m)) { // our own message came back: drop the "sending" copy of it
              var pi = -1; pending.forEach(function (p, n) { if (pi < 0 && p.text === (m.text || '') && !!p.image === !!m.img) pi = n; });
              if (pi >= 0) { pending[pi].el.remove(); pending.splice(pi, 1); }
            }
            seen[m.k] = 1; ui.log.appendChild(bubble(m));
          });
          if (near) ui.log.scrollTop = ui.log.scrollHeight;
        }
        if (first) setTimeout(pollPing, 700); // opening the conversation cleared its unread count on the server
      });
    }
    function isMine(m) { return m.from === me || (cur.kind === 'npc' && isDM() && String(m.from).indexOf('npc:') === 0); }
    // Who a message looks like it is from: a nickname inside a group, the NPC when the headmaster speaks as one.
    function sender(from) {
      if (String(from).indexOf('npc:') === 0) return npcById(from.slice(4)) || { name: 'NPC', avatar: '' };
      var p = byId[from] || { name: '?', avatar: '' };
      if (cur.kind === 'gc' && info && info.gc && info.gc.nick && info.gc.nick[from]) return { name: info.gc.nick[from], avatar: p.avatar };
      return p;
    }
    function bubble(m) {
      var mine = isMine(m), p = sender(m.from);
      var txt = h('div', { className: 'cht-txt' }, [mine ? null : h('small', { className: 'mono', text: p.name }), m.text ? h('p', { text: m.text }) : null, m.img ? h('img', { className: 'cht-img', src: FN + 'chat?mimg=' + encodeURIComponent(m.img), alt: 'Shared image', loading: 'lazy' }) : null]);
      return h('div', { className: 'cht-msg' + (mine ? ' mine' : '') }, mine ? [txt, avatar(p, 'sm')] : [avatar(p, 'sm'), txt]);
    }
    // The message shows up at once, a little faded with "Sending…", and settles when the server confirms it.
    function send() {
      if (mode !== 'chat' || ui.cmp.hidden) return;
      var text = ui.in.value.trim(), image = ui.pend; if (!text && !image) return;
      ui.in.value = ''; ui.pend = null; ui.imgBtn.textContent = '+ image'; ui.err.textContent = '';
      var p = cur.kind === 'npc' && isDM() ? (npcById(cur.id) || { name: '?' }) : sender(me), state = h('small', { className: 'mono cht-state', text: 'Sending…' }), at = JSON.stringify(cur);
      var txt = h('div', { className: 'cht-txt' }, [text ? h('p', { text: text }) : null, image ? h('img', { className: 'cht-img', src: image, alt: 'Image being sent' }) : null, state]);
      var el = h('div', { className: 'cht-msg mine pending' }, [txt, avatar(p, 'sm')]);
      var rec = { text: text, image: image, el: el }; pending.push(rec);
      var empty = ui.log.querySelector('.cht-empty'); if (empty) empty.remove();
      ui.log.appendChild(el); ui.log.scrollTop = ui.log.scrollHeight; ui.in.focus();
      var reqBody = body({ action: 'send', text: text, image: image || undefined });
      function go() {
        el.classList.remove('failed'); state.textContent = 'Sending…';
        call('chat', reqBody).then(function (r) {
          if (!r.ok) { el.classList.add('failed'); state.textContent = (r.j.error || 'Not sent') + ' · tap to retry'; el.onclick = function () { el.onclick = null; go(); }; return; }
          seen[r.j.k] = 1;
          var i = pending.indexOf(rec);
          if (i >= 0) { pending.splice(i, 1); el.classList.remove('pending'); state.remove(); } // the server confirmed it: it simply becomes a normal message
          if (cur.kind === 'pm' && recent.indexOf(cur.id) < 0) recent.push(cur.id);
        });
      }
      go();
    }

    /* ----- group settings (name, your name inside the group, people) ----- */
    function drawGset() {
      var g = info && info.gc; clear(ui.gset); if (!g) return;
      var peopleNames = g.members.map(function (id) { var nn = g.nick && g.nick[id]; return (nn || nameOf(id)) + (g.watch && nn ? ' (' + nameOf(id) + ')' : ''); });
      if (g.watch) { ui.gset.appendChild(h('p', { className: 'mono hb-note', text: 'In this group: ' + peopleNames.join(', ') })); return; }
      var gn = h('input', { value: g.name, maxLength: 40, 'aria-label': 'Group name' }), gs = h('button', { type: 'button', className: 'btn sq', text: 'Save' }), st = h('small', { className: 'mono' });
      gs.onclick = function () { call('chat', { action: 'gcrename', gid: g.id, name: gn.value }).then(function (r) { st.textContent = r.ok ? 'Saved.' : (r.j.error || 'Could not save.'); if (r.ok) { applyGc(r.j.gc); } }); };
      var nn = h('input', { value: (g.nick && g.nick[me]) || '', maxLength: 30, placeholder: nameOf(me), 'aria-label': 'Your name in this group' }), ns = h('button', { type: 'button', className: 'btn sq', text: 'Save' });
      ns.onclick = function () { call('chat', { action: 'gcnick', gid: g.id, nick: nn.value }).then(function (r) { st.textContent = r.ok ? 'Saved. New messages use that name.' : (r.j.error || 'Could not save.'); if (r.ok) applyGc(r.j.gc); }); };
      var addable = contactIds.filter(function (id) { return id !== me && g.members.indexOf(id) < 0 && byId[id]; });
      var sel = h('select', { 'aria-label': 'Add someone' }, [h('option', { value: '', text: 'Add someone…' })].concat(addable.map(function (id) { return h('option', { value: id, text: nameOf(id) }); })));
      var ad = h('button', { type: 'button', className: 'btn sq', text: 'Add' });
      ad.onclick = function () { if (!sel.value) return; call('chat', { action: 'gcadd', gid: g.id, ids: [sel.value] }).then(function (r) { st.textContent = r.ok ? 'Added.' : (r.j.error || 'Could not add.'); if (r.ok) { applyGc(r.j.gc); drawGset(); } }); };
      var lv = h('button', { type: 'button', className: 'link', text: 'Leave this group' });
      G.two(lv, 'Leave this group', function () { call('chat', { action: 'gcleave', gid: g.id }).then(function (r) { if (!r.ok) { st.textContent = r.j.error || 'Could not leave.'; return; } groups = groups.filter(function (x) { return x.id !== g.id; }); open({ kind: 'ooc' }); }); });
      ui.gset.appendChild(h('div', { className: 'cht-grow' }, [h('label', { className: 'fl' }, [h('span', { text: 'Group name' }), h('div', { className: 'cht-inl' }, [gn, gs])]), h('label', { className: 'fl' }, [h('span', { text: 'Your name in this group' }), h('div', { className: 'cht-inl' }, [nn, ns])]), h('div', { className: 'fl' }, [h('span', { text: 'Add people' }), h('div', { className: 'cht-inl' }, [sel, ad])])]));
      ui.gset.appendChild(h('p', { className: 'mono hb-note', text: 'In this group: ' + peopleNames.join(', ') }));
      ui.gset.appendChild(h('div', { className: 'cht-inl' }, [lv, st]));
    }
    function applyGc(g) { if (!g) return; info = info || {}; info.gc = g; var i = groups.map(function (x) { return x.id; }).indexOf(g.id); if (i >= 0) groups[i] = g; setHead(); drawSide(); }

    /* ----- pickers and tools ----- */
    function pickRow(card, tag, fn) {
      var b = h('button', { type: 'button', className: 'cht-pick' }, [avatar(card), h('b', { text: card.name }), tag ? h('span', { className: 'cht-tag mono', text: tag }) : null]); b.onclick = fn; return b;
    }
    // The lists of people and NPCs can be a few seconds old: fetch them again when a picker opens and redraw it if something changed.
    function freshThen(m, again) {
      var was = JSON.stringify([contactIds, npcs.map(function (n) { return n.id; })]);
      call('chat', { action: 'members' }).then(function (r) {
        if (!r.ok) return; take(r.j); if (mode !== m) return;
        if (was !== JSON.stringify([contactIds, npcs.map(function (n) { return n.id; })])) { var typed = ui.log.querySelector('.cht-new-gc input'); if (!(typed && typed.value)) again(); }
        drawSide();
      });
    }
    function showPicker(fresh) {
      showMode('pick'); if (!fresh) freshThen('pick', function () { showPicker(true); });
      var others = contactIds.filter(function (id) { return id !== me && byId[id]; });
      others.forEach(function (id) { ui.log.appendChild(pickRow(byId[id], '', function () { if (recent.indexOf(id) < 0) recent.push(id); open({ kind: 'pm', id: id }); })); });
      if (!isDM()) npcs.forEach(function (n) { ui.log.appendChild(pickRow(n, 'NPC', function () { if (!recentNpc.some(function (x) { return x.nid === n.id; })) recentNpc.push({ nid: n.id, pid: me }); open({ kind: 'npc', id: n.id, pid: me }); })); });
      if (!others.length && !npcs.length) ui.log.appendChild(note('Nobody else is here yet.'));
    }
    function showNpcPicker(fresh) {
      showMode('npcpick'); if (!fresh) freshThen('npcpick', function () { showNpcPicker(true); });
      if (!npcs.length) { ui.log.appendChild(note('No NPC can be contacted yet. Open "Contacts & NPCs" and switch one on.')); return; }
      ui.log.appendChild(h('p', { className: 'mono red', text: 'Which NPC are you speaking as?' }));
      npcs.forEach(function (n) {
        ui.log.appendChild(pickRow(n, 'NPC', function () {
          showMode('npcpick'); ui.head.textContent = 'Who is ' + n.name + ' writing to?';
          members.filter(function (m) { return m.id !== 'hm'; }).forEach(function (m) {
            ui.log.appendChild(pickRow(m, '', function () { if (!recentNpc.some(function (x) { return x.nid === n.id && x.pid === m.id; })) recentNpc.push({ nid: n.id, pid: m.id }); open({ kind: 'npc', id: n.id, pid: m.id }); }));
          });
        }));
      });
    }
    function showGcNew(fresh) {
      showMode('gcnew'); if (!fresh) freshThen('gcnew', function () { showGcNew(true); });
      var nm = h('input', { maxLength: 40, placeholder: 'Group name', 'aria-label': 'Group name' }), checks = {}, st = h('p', { className: 'mono hb-note' });
      var others = contactIds.filter(function (id) { return id !== me && byId[id]; });
      var list = h('div', { className: 'cht-checks' }, others.map(function (id) {
        var cb = h('input', { type: 'checkbox' }); checks[id] = cb;
        return h('label', { className: 'cht-chk' }, [cb, avatar(byId[id], 'sm'), h('span', { text: byId[id].name })]);
      }));
      var go = h('button', { type: 'button', className: 'btn primary', text: 'Create group' });
      go.onclick = function () {
        var ids = others.filter(function (id) { return checks[id].checked; });
        if (!ids.length && !isDM()) { st.textContent = 'Pick at least one person.'; return; }
        go.disabled = true; st.textContent = 'Creating…';
        call('chat', { action: 'gccreate', name: nm.value, ids: ids }).then(function (r) {
          go.disabled = false; if (!r.ok) { st.textContent = r.j.error || 'Could not create the group.'; return; }
          groups.push(r.j.gc); open({ kind: 'gc', id: r.j.gc.id });
        });
      };
      ui.log.appendChild(h('div', { className: 'cht-new-gc' }, [h('label', { className: 'fl' }, [h('span', { text: 'Name' }), nm]), h('p', { className: 'mono red', text: 'Who is in it?' }), others.length ? list : note('Nobody to add yet.'), go, st]));
      if (isDM()) ui.log.appendChild(note('You are added to groups you make. Players can see you there. You can also read every group without being in it.'));
    }
    // Headmaster: hide players from everyone else's contacts, and decide which NPCs can be contacted.
    function showManage() {
      showMode('manage');
      var st = h('p', { className: 'mono hb-note' });
      var players = members.filter(function (m) { return m.id !== 'hm'; });
      var hid = h('div', { className: 'cht-checks' }, players.map(function (m) {
        var cb = h('input', { type: 'checkbox', checked: hiddenIds.indexOf(m.id) >= 0 });
        cb.onchange = function () { call('chat', { action: 'sethidden', id: m.id, hidden: cb.checked }).then(function (r) { if (r.ok) { hiddenIds = r.j.hidden || []; st.textContent = (cb.checked ? m.name + ' is hidden from the other players.' : m.name + ' can be seen again.'); } else { cb.checked = !cb.checked; st.textContent = r.j.error || 'Could not save.'; } }); };
        return h('label', { className: 'cht-chk' }, [cb, avatar(m, 'sm'), h('span', { text: m.name }), h('small', { className: 'mono', text: 'hidden' })]);
      }));
      ui.log.appendChild(h('section', { className: 'cht-sec' }, [h('p', { className: 'mono red', text: 'Hide players from contacts' }), note('A hidden player does not appear in anyone else\'s contacts, cannot be messaged or added to groups by players, and can only write to you and to NPCs. Use it for players who have not entered the story yet.'), players.length ? hid : note('No players yet.')]));
      var box = h('div', { className: 'cht-npcs' }, [note('Loading NPCs…')]);
      ui.log.appendChild(h('section', { className: 'cht-sec' }, [h('p', { className: 'mono red', text: 'NPCs players can contact' }), note('Switch an NPC on to let players write to it privately. You answer as that NPC from "NPC chats".'), box, st]));
      call('chat', { action: 'npcmanage' }).then(function (r) {
        if (mode !== 'manage') return; clear(box);
        if (!r.ok) { box.appendChild(note(r.j.error || 'Could not load the NPCs.')); return; }
        if (!r.j.npcs.length) box.appendChild(note('There are no NPCs in the registry yet.'));
        r.j.npcs.forEach(function (n) { box.appendChild(npcRow(n, players, st)); });
      });
    }
    function npcRow(n, players, st) {
      var on = h('input', { type: 'checkbox', checked: n.on }), all = h('input', { type: 'checkbox', checked: n.all }), pc = {};
      var who = h('div', { className: 'cht-checks' }, players.map(function (m) { var cb = h('input', { type: 'checkbox', checked: n.to.indexOf(m.id) >= 0 }); pc[m.id] = cb; return h('label', { className: 'cht-chk' }, [cb, h('span', { text: m.name })]); }));
      var opts = h('div', { className: 'cht-npc-opts' }, [h('label', { className: 'cht-chk' }, [all, h('span', { text: 'Everyone (except hidden players)' })]), who]);
      var save = h('button', { type: 'button', className: 'btn sq', text: 'Save' }), msg = h('small', { className: 'mono' });
      function sync() { opts.hidden = !on.checked; who.hidden = all.checked; }
      on.onchange = sync; all.onchange = sync; sync();
      save.onclick = function () {
        var to = players.filter(function (m) { return pc[m.id].checked; }).map(function (m) { return m.id; });
        call('chat', { action: 'npcset', npc: n.id, on: on.checked, all: all.checked, to: to }).then(function (r) { msg.textContent = r.ok ? 'Saved.' : (r.j.error || 'Could not save.'); if (r.ok) refreshMembers(); });
      };
      return h('div', { className: 'cht-npc' }, [h('div', { className: 'cht-npc-top' }, [avatar(n), h('b', { text: n.name }), h('label', { className: 'cht-chk' }, [on, h('span', { text: 'Contactable' })]), save, msg]), opts]);
    }
    mod = { enter: enter, leave: stop, reset: reset, wake: function () { if (built) fetchNew(); } };
    return mod;
  })();

  /* ======================= NOTEBOOK ======================= */
  // Everyone keeps their own notebook: chapters they write themselves (important details, plans, clues). Only the owner can read it.
  modules.note = (function () {
    var root = $('pane-note'), list = [], cur = null, ui = {}, saveT = null, dirty = false, token = 0;
    function reset() { flush(); list = []; cur = null; clear(root); }
    function enter() {
      clear(root).appendChild(h('div', { className: 'hb-wrap' }, [note('Opening your notebook…')]));
      call('notebook', { action: 'list' }).then(function (r) {
        if (!r.ok) { clear(root).appendChild(h('div', { className: 'hb-wrap' }, [note(r.j.error || 'Could not open your notebook.')])); return; }
        list = r.j.chapters || []; if (!list.some(function (c) { return c.id === cur; })) cur = list[0] ? list[0].id : null; build();
      });
    }
    function build() {
      clear(root);
      ui.toc = h('ol', { className: 'toc' }); ui.page = h('article', { className: 'book-page', tabindex: '-1', 'aria-live': 'polite' });
      var add = h('button', { type: 'button', className: 'btn primary', text: '+ New chapter' }); add.onclick = newChapter;
      root.appendChild(h('div', { className: 'hb-wrap' }, [h('div', { className: 'book' }, [h('nav', { className: 'book-toc', 'aria-label': 'Your chapters' }, [h('p', { className: 'mono red', text: 'Your notebook' }), add, ui.toc]), ui.page])]));
      drawToc(); drawPage();
    }
    function cc() { return list.filter(function (c) { return c.id === cur; })[0]; }
    function drawToc() {
      clear(ui.toc);
      list.forEach(function (c) {
        var b = h('button', { type: 'button', className: 'toc-btn' }, [h('span', { text: c.title || 'Untitled' })]); if (c.id === cur) b.setAttribute('aria-current', 'page');
        b.onclick = function () { flush(); cur = c.id; drawToc(); drawPage(); };
        ui.toc.appendChild(h('li', {}, [b]));
      });
    }
    function newChapter() {
      flush();
      call('notebook', { action: 'save', chapter: { title: 'Untitled chapter', body: '' } }).then(function (r) {
        if (!r.ok) { ui.page.textContent = r.j.error || 'Could not add a chapter.'; return; }
        list = r.j.chapters; cur = r.j.chapter.id; drawToc(); drawPage(true);
      });
    }
    function flush() { if (dirty) save(true); }
    function save(quiet) {
      var c = cc(); if (!c) return;
      clearTimeout(saveT); dirty = false; if (ui.status) ui.status.textContent = 'Saving…';
      call('notebook', { action: 'save', chapter: { id: c.id, title: c.title, body: c.body } }).then(function (r) {
        if (ui.status) ui.status.textContent = r.ok ? 'Saved.' : (r.j.error || 'Could not save. Try again.');
        if (!r.ok) dirty = true;
      });
    }
    function drawPage(focus) {
      clear(ui.page); var c = cc();
      if (!c) { ui.page.appendChild(h('div', {}, [h('h3', { className: 'ch-title', text: 'Your notebook' }), note('This is yours. Write down anything important: details, plans, clues, things you do not want to forget. Add a chapter to begin.')])); return; }
      var title = h('input', { className: 'nb-title', value: c.title || '', maxLength: 100, placeholder: 'Chapter title', 'aria-label': 'Chapter title' });
      var body = h('textarea', { className: 'nb-body', rows: 16, placeholder: 'Write here…', 'aria-label': 'Chapter text' }); body.value = c.body || '';
      ui.status = h('small', { className: 'mono hb-note', role: 'status' });
      function touch() { dirty = true; ui.status.textContent = 'Typing…'; clearTimeout(saveT); saveT = setTimeout(function () { save(); }, 900); }
      title.oninput = function () { c.title = title.value; touch(); drawToc(); }; body.oninput = function () { c.body = body.value; touch(); };
      var sv = h('button', { type: 'button', className: 'btn primary', text: 'Save now' }); sv.onclick = function () { save(); };
      function mv(dir) { flush(); call('notebook', { action: 'move', id: c.id, dir: dir }).then(function (r) { if (r.ok) { list = r.j.chapters; drawToc(); } }); }
      var up = h('button', { type: 'button', className: 'btn', text: '↑ Move up' }), dn = h('button', { type: 'button', className: 'btn', text: '↓ Move down' }); up.onclick = function () { mv('up'); }; dn.onclick = function () { mv('down'); };
      var del = h('button', { type: 'button', className: 'btn', text: 'Delete chapter' });
      G.two(del, 'Delete chapter', function () { dirty = false; clearTimeout(saveT); call('notebook', { action: 'delete', id: c.id }).then(function (r) { if (r.ok) { list = r.j.chapters; cur = list[0] ? list[0].id : null; drawToc(); drawPage(); } }); });
      ui.page.appendChild(h('div', { className: 'nb-edit' }, [title, body, h('div', { className: 'ef' }, [sv, up, dn, del]), ui.status]));
      if (focus) { title.focus(); title.select && title.select(); }
    }
    return { enter: enter, leave: flush, reset: reset, wake: function () {} };
  })();

  /* ======================= WORLD (Locations and Items) ======================= */
  G.worldList = [];
  G.worldLoad = function () {
    return call('world', { action: 'wlist' }).then(function (r) { if (r.ok) { G.worldList.length = 0; (r.j.entries || []).forEach(function (e) { G.worldList.push(e); }); } return r; });
  };
  G.worldNew = function () {
    G.worldList.unshift({ id: 'new', isNew: true, kind: 'item', name: '', desc: '', category: '', price: 0, image: '', hasImage: false });
    G.setCur('new'); G.render();
  };
  G.worldEditor = function (src) {
    var c = JSON.parse(JSON.stringify(src)), st = h('p', { className: 'mono' }), box = h('div', { className: 'ed' }), crop = G.cropper(c);
    function txt(label, k, rows, max) { var i = h(rows ? 'textarea' : 'input', { value: c[k] == null ? '' : c[k] }); if (rows) i.rows = rows; if (max) i.maxLength = max; i.oninput = function () { c[k] = i.value; }; return h('label', { className: 'fl' }, [h('span', { text: label }), i]); }
    function draw() {
      clear(box);
      var ks = h('select', {}, [['item', 'Item'], ['location', 'Location']].map(function (o) { return h('option', { value: o[0], text: o[1], selected: c.kind === o[0] }); }));
      ks.onchange = function () { c.kind = ks.value; draw(); };
      box.appendChild(h('div', { className: 'g2' }, [h('label', { className: 'fl' }, [h('span', { text: 'Type' }), ks]), txt('Name', 'name', 0, 100)]));
      box.appendChild(h('div', { className: 'g2' }, [txt('Category (optional)', 'category', 0, 60), c.kind === 'item' ? (function () { var i = h('input', { type: 'number', min: 0, value: c.price || 0, className: 'ni' }); i.oninput = function () { c.price = Math.max(0, Math.floor(+i.value) || 0); }; return h('label', { className: 'fl' }, [h('span', { text: 'Default price (karma)' }), i]); })() : null]));
      if (c.kind === 'item') {
        var chk = function (label, k) { var i = h('input', { type: 'checkbox', checked: !!c[k] }); i.onchange = function () { c[k] = i.checked; if (k === 'usable') draw(); }; return h('label', { className: 'chk' }, [i, h('span', { text: label })]); };
        box.appendChild(h('div', { className: 'ef' }, [chk('Players can sell this back (90% of its price)', 'sellable'), chk('Players can use this item', 'usable')]));
        var tk = h('select', { 'aria-label': 'Ticket type' }, [['', 'Not a ticket'], ['gacha', 'Gacha ticket (pays for one gacha pull)'], ['discount', 'Discount ticket (percent off the next shop purchase, not the gacha)']].map(function (o) { return h('option', { value: o[0], text: o[1], selected: (c.ticket || '') === o[0] }); }));
        tk.onchange = function () { c.ticket = tk.value; if (c.ticket === 'discount' && !c.pct) c.pct = 30; draw(); };
        var tkRow = [h('label', { className: 'fl' }, [h('span', { text: 'Ticket' }), tk])];
        if (c.ticket === 'discount') { var pc = h('input', { type: 'number', min: 1, max: 90, value: c.pct || 30, className: 'ni', 'aria-label': 'Percent off' }); pc.oninput = function () { c.pct = Math.max(1, Math.min(90, Math.floor(+pc.value) || 30)); }; tkRow.push(h('label', { className: 'fl' }, [h('span', { text: 'Percent off' }), pc])); }
        box.appendChild(h('div', { className: 'g2' }, tkRow));
        if (c.ticket === 'discount') box.appendChild(note('Players use it from their inventory. It takes the percent off their next shop purchase, then it is used up. It never applies to the gacha.'));
        if (c.ticket === 'gacha') box.appendChild(note('One ticket pays for one pull (ten for a ten-pull). Players choose it at the gacha machine. Locked tickets cannot be used.'));
        if (c.usable && !c._st) { c._st = 1; G.loadStatuses().then(function () { if (box.isConnected) draw(); }); }
        if (c.usable) { c.use = c.use || []; box.appendChild(h('div', { className: 'fl' }, [h('span', { text: 'When a soul uses it (optional): add HP, raise a stat, or give a buff. One copy is used up each time. Temporary effects stay until you end them in the Effects tab.' }), G.fxEditor(c.use, draw)])); c.effects = c.effects || []; box.appendChild(h('div', { className: 'fl' }, [h('span', { text: 'Dice it rolls when used (optional), like a skill: for example Heal 1d4. Heal and Damage really change the soul’s HP (it never goes above max or below 0). The roll is also shown in the Dice log.' }), G.diceEditor(c.effects, draw)]));
          // Raise a stat for good, and cure fixed effects.
          c.statUp = c.statUp || { mode: 'none', amt: 1, stats: [] }; c.cleanse = c.cleanse || { all: false, ids: [] };
          var um = h('select', { 'aria-label': 'Permanent stat raise' }, [['none', 'Does not raise a stat'], ['random', 'Raises a random stat'], ['choose', 'Raises a stat the player chooses']].map(function (o) { return h('option', { value: o[0], text: o[1], selected: c.statUp.mode === o[0] }); }));
          um.onchange = function () { c.statUp.mode = um.value; draw(); };
          var ur = [h('span', { text: 'Raise a stat permanently (optional). The base stat changes for good, and the player is shown exactly what went up.' }), um];
          if (c.statUp.mode !== 'none') {
            var ua = h('input', { type: 'number', min: 1, max: 20, value: c.statUp.amt || 1, className: 'ni', 'aria-label': 'How much' }); ua.oninput = function () { c.statUp.amt = Math.max(1, Math.min(20, Math.floor(+ua.value) || 1)); };
            ur.push(h('div', { className: 'ef' }, [h('span', { text: 'Raises by' }), ua].concat(['STR', 'INT', 'DEX', 'WIS', 'CHA', 'CON'].map(function (k) { var i = h('input', { type: 'checkbox', checked: c.statUp.stats.indexOf(k) >= 0 }); i.onchange = function () { var j = c.statUp.stats.indexOf(k); if (i.checked && j < 0) c.statUp.stats.push(k); if (!i.checked && j >= 0) c.statUp.stats.splice(j, 1); }; return h('label', { className: 'chk' }, [i, h('span', { text: k })]); }))));
            ur.push(note('Tick the stats it can raise. Tick none and any of the six can be raised.'));
          }
          box.appendChild(h('div', { className: 'fl' }, ur));
          var cr = [h('span', { text: 'Cures (optional). When used, it removes these fixed effects from the soul by itself. Make them in the Effects tab. If the soul has none of them, the item is not used up.' })];
          var any = h('input', { type: 'checkbox', checked: !!c.cleanse.all }); any.onchange = function () { c.cleanse.all = any.checked; };
          cr.push(h('div', { className: 'ef' }, [h('label', { className: 'chk' }, [any, h('span', { text: 'Any debuff' })])].concat(G.statuses.map(function (st) { var i = h('input', { type: 'checkbox', checked: c.cleanse.ids.indexOf(st.id) >= 0 }); i.onchange = function () { var j = c.cleanse.ids.indexOf(st.id); if (i.checked && j < 0) c.cleanse.ids.push(st.id); if (!i.checked && j >= 0) c.cleanse.ids.splice(j, 1); }; return h('label', { className: 'chk' }, [i, h('span', { text: st.name })]); }))));
          box.appendChild(h('div', { className: 'fl' }, cr)); }
      }
      var hid = h('input', { type: 'checkbox', checked: !!c.hidden }); hid.onchange = function () { c.hidden = hid.checked; };
      box.appendChild(h('label', { className: 'chk' }, [hid, h('span', { text: 'Hide from the public registry (it can still be sold, given and used)' })]));
      box.appendChild(crop);
      box.appendChild(txt('Description (everyone can read this)', 'desc', 5, 2000));
      var save = h('button', { type: 'button', className: 'btn primary', text: 'Save' });
      save.onclick = function () {
        save.disabled = true; st.textContent = 'Saving…';
        var e = { kind: c.kind, name: c.name, desc: c.desc, category: c.category, price: c.price, sellable: !!c.sellable, usable: !!c.usable, hidden: !!c.hidden, ticket: c.kind === 'item' ? (c.ticket || '') : '', pct: c.pct || 30, use: c.usable ? (c.use || []) : [], effects: c.usable ? (c.effects || []) : [], statUp: c.usable && c.statUp ? c.statUp : { mode: 'none', amt: 1, stats: [] }, cleanse: c.usable && c.cleanse ? c.cleanse : { all: false, ids: [] } };
        if (!c.isNew) e.id = c.id; if (/^data:/.test(c.image || '') || c.image === '') e.image = c.image;
        call('world', { action: 'wsave', entry: e }).then(function (r) {
          save.disabled = false; if (!r.ok) { st.textContent = r.j.error || 'Save failed'; return; }
          var n = r.j.entry, i = G.worldList.findIndex(function (x) { return x.id === c.id || x.id === n.id; });
          if (i >= 0) G.worldList[i] = n; else G.worldList.push(n);
          G.worldList.sort(function (a, b) { return a.name.localeCompare(b.name); });
          c.id = n.id; c.isNew = false; G.setCur(n.id); G.render(); st.textContent = 'Saved.';
        });
      };
      var del = h('button', { type: 'button', className: 'btn', text: 'Delete' });
      G.two(del, 'Delete', function () {
        function gone() { var i = G.worldList.findIndex(function (x) { return x.id === c.id; }); if (i >= 0) G.worldList.splice(i, 1); G.setCur(null); G.render(); }
        if (c.isNew) { gone(); return; }
        call('world', { action: 'wdelete', id: c.id }).then(function (r) { if (r.ok) gone(); else st.textContent = r.j.error || 'Delete failed'; });
      });
      box.appendChild(h('div', { className: 'btns' }, [save, del])); box.appendChild(st);
      if (c.kind === 'item') box.appendChild(note('Items in this list are the only things the Marketplace can sell.'));
    }
    draw(); return [box];
  };

  // Public page (the gate's fourth card).
  (function () {
    var sec = $('world'), openBtn = $('open-world'), closeBtn = $('world-close'), grid = $('w-grid'), det = $('w-det'), list = $('w-list'), q = $('w-search'), main = $('w-main');
    if (!sec || !openBtn) return;
    var entries = [], kind = 'location', loaded = false, tabs = document.querySelectorAll('.wd-tab');
    function money(n) { return Number(n || 0).toLocaleString('en-US'); }
    function render() {
      clear(grid);
      var s = q.value.trim().toLowerCase(), of = entries.filter(function (e) { return e.kind === kind; });
      var rows = of.filter(function (e) { return !s || e.name.toLowerCase().indexOf(s) >= 0 || (e.category || '').toLowerCase().indexOf(s) >= 0; });
      if (!rows.length) { grid.appendChild(note(of.length ? 'Nothing by that name.' : 'Nothing has been registered here yet.')); return; }
      rows.forEach(function (e) {
        var b = h('button', { type: 'button', className: 'reg-card' }, [thumb(e.image, e.name.charAt(0).toUpperCase(), 'reg-img'), h('b', { text: e.name }), e.category ? h('small', { className: 'reg-tag', text: e.category }) : null, h('small', { text: 'Details' })]);
        b.onclick = function () { open(e); }; grid.appendChild(b);
      });
    }
    function open(e) {
      list.hidden = true; det.hidden = false; clear(det);
      var back = h('button', { type: 'button', className: 'btn reg-back', text: 'Back to the list' }); back.onclick = function () { det.hidden = true; list.hidden = false; };
      det.appendChild(back);
      det.appendChild(h('div', { className: 'reg-who' }, [thumb(e.image, e.name.charAt(0).toUpperCase(), 'reg-img'), h('h3', { text: e.name }), e.category ? h('small', { className: 'mono reg-tag', text: e.category }) : null]));
      var col = h('div', { className: 'reg-col' });
      col.appendChild(h('div', { className: 'reg-sec' }, [h('h4', { text: e.kind === 'item' ? 'About this item' : 'About this place' }), h('p', { className: e.desc ? '' : 'dim', text: e.desc || '—' })]));
      if (e.kind === 'item' && e.price) col.appendChild(h('div', { className: 'reg-sec' }, [h('h4', { text: 'Usual price' }), h('p', { text: money(e.price) + ' karma' })]));
      det.appendChild(col); main.focus({ preventScroll: true });
    }
    function load() {
      clear(grid).appendChild(note('Opening the registry…'));
      raw('world', {}).then(function (r) { if (!r.ok) { clear(grid).appendChild(note(r.j.error || 'Could not open the registry.')); return; } entries = r.j.entries || []; loaded = true; render(); });
    }
    function openW() { sec.hidden = false; openBtn.setAttribute('aria-expanded', 'true'); if (!loaded) load(); sec.scrollIntoView({ block: 'start' }); main.focus({ preventScroll: true }); }
    function closeW() { sec.hidden = true; openBtn.setAttribute('aria-expanded', 'false'); var g = $('gate'); if (g) g.scrollIntoView({ block: 'start' }); openBtn.focus({ preventScroll: true }); }
    Array.prototype.forEach.call(tabs, function (t) { t.addEventListener('click', function () { kind = t.getAttribute('data-t'); Array.prototype.forEach.call(tabs, function (x) { x.setAttribute('aria-pressed', String(x === t)); }); det.hidden = true; list.hidden = false; render(); }); });
    q.addEventListener('input', render); openBtn.addEventListener('click', openW); closeBtn.addEventListener('click', closeW);
    if (location.hash === '#world') openW();
    window.addEventListener('hashchange', function () { if (location.hash === '#world') openW(); });
  })();
})();
