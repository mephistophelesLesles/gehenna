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

  /* ---------- section tabs ---------- */
  var nav = $('adm-nav'), PANES = ['char', 'items', 'map', 'market', 'chat', 'note', 'dice'], current = 'char', lastMode = '';
  var modules = {};
  function pane(name) {
    if (modules[current] && modules[current].leave) modules[current].leave();
    current = name;
    PANES.forEach(function (p) { var e = $('pane-' + p); if (e) e.hidden = p !== name; });
    Array.prototype.forEach.call(nav.querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-pane') === name)); });
    if (modules[name] && modules[name].enter) modules[name].enter();
    var a = $('adm'); if (a) a.scrollTop = 0;
  }
  Array.prototype.forEach.call(nav.querySelectorAll('button'), function (b) { b.addEventListener('click', function () { pane(b.getAttribute('data-pane')); }); });
  G.onMode = function (m) {
    nav.hidden = m === 'login';
    if (m === 'login') { if (modules[current] && modules[current].leave) modules[current].leave(); Object.keys(modules).forEach(function (k) { if (modules[k].reset) modules[k].reset(); }); current = 'char'; lastMode = m; return; }
    if (m !== lastMode) { lastMode = m; pane('char'); }
  };
  $('adm-refresh').addEventListener('click', function () { if (current !== 'char' && modules[current] && modules[current].enter) modules[current].enter(true); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && modules[current] && modules[current].wake) modules[current].wake(); });

  /* ======================= MAP ======================= */
  modules.map = (function () {
    var root = $('pane-map'), built = false, lobbies = [], curId = null, lob = null, timer = null, saveT = null, selTok = null, tab = 'shadow', q = '', snap = true;
    var ui = {};
    function isDM() { return !!G.creds(); }
    function reset() { built = false; lobbies = []; curId = null; lob = null; selTok = null; clear(root); stop(); }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function start() { stop(); if (!isDM()) timer = setInterval(function () { if (!document.hidden) poll(); }, 5000); }

    function build() {
      clear(root); built = true;
      ui.tabs = h('div', { className: 'mp-tabs', role: 'tablist' });
      ui.status = h('span', { className: 'mono hb-note' });
      ui.box = h('div', { className: 'mp-box' + (isDM() ? ' edit' : '') });
      ui.msg = h('p', { className: 'mono hb-note' });
      ui.side = h('div', { className: 'mp-side' });
      root.appendChild(h('div', { className: 'hb-wrap' }, [
        h('div', { className: 'mp-head' }, [ui.tabs, ui.status]),
        h('div', { className: 'mp-body' }, [h('div', { className: 'mp-stage' }, [ui.box, ui.msg]), isDM() ? ui.side : null]),
      ]));
      if (window.ResizeObserver) new ResizeObserver(fit).observe(ui.box); else window.addEventListener('resize', fit);
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
        ui.msg.textContent = isDM() ? '' : 'The map updates by itself when the headmaster changes it.';
        lob = r.j.lobby; drawBox(); if (isDM()) drawSide();
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
    function fit() { if (!lob || !ui.grid) return; var w = ui.box.clientWidth, c = w * lob.cell / 100; ui.grid.style.backgroundSize = c + 'px ' + c + 'px'; }
    function place(t, el) { el.style.left = (t.x * 100) + '%'; el.style.top = (t.y * 100) + '%'; el.style.width = (lob.cell * 0.9) + '%'; }
    function drawBox() {
      clear(ui.box); ui.grid = null;
      if (!lob) { ui.box.appendChild(h('div', { className: 'mp-empty' }, [h('p', { className: 'mono', text: curId ? 'Opening the map…' : (isDM() ? 'Add a lobby to begin.' : 'Nothing to show yet.') })])); return; }
      if (lob.image) ui.box.appendChild(h('img', { className: 'mp-img', src: lob.image, alt: '', draggable: false }));
      ui.img = ui.box.querySelector('.mp-img'); styleImg();
      ui.grid = h('div', { className: 'mp-grid' }); ui.box.appendChild(ui.grid);
      lob.tokens.forEach(function (t) { ui.box.appendChild(tokenEl(t)); });
      if (!lob.image && isDM()) ui.box.appendChild(h('p', { className: 'mp-hint mono', text: 'Upload a map image on the right.' }));
      fit();
    }
    function styleImg() { if (!ui.img) return; ui.img.style.width = (lob.imgScale * 100) + '%'; ui.img.style.left = (lob.imgX * 100) + '%'; ui.img.style.top = (lob.imgY * 100) + '%'; }
    function tokenEl(t) {
      var e = h('div', { className: 'mp-tok' + (t.id === selTok ? ' sel' : ''), title: t.label }, [thumb(t.img, (t.label || '?').charAt(0).toUpperCase(), 'tk'), h('span', { className: 'mp-lab', text: t.label })]);
      place(t, e);
      if (isDM()) e.addEventListener('pointerdown', function (ev) { dragToken(ev, t, e); });
      return e;
    }
    function dragToken(ev, t, e) {
      ev.preventDefault(); ev.stopPropagation(); e.setPointerCapture(ev.pointerId);
      if (selTok !== t.id) { selTok = t.id; Array.prototype.forEach.call(ui.box.querySelectorAll('.mp-tok'), function (n) { n.classList.remove('sel'); }); e.classList.add('sel'); drawSide(); }
      var move = function (m) { var r = ui.box.getBoundingClientRect(); t.x = Math.max(0, Math.min(1, (m.clientX - r.left) / r.width)); t.y = Math.max(0, Math.min(1, (m.clientY - r.top) / r.height)); place(t, e); };
      var up = function () {
        e.removeEventListener('pointermove', move); e.removeEventListener('pointerup', up); e.removeEventListener('pointercancel', up);
        if (snap) { var r = ui.box.getBoundingClientRect(), cx = lob.cell / 100, cy = cx * r.width / r.height; t.x = Math.min(1, (Math.floor(t.x / cx) + 0.5) * cx); t.y = Math.min(1, (Math.floor(t.y / cy) + 0.5) * cy); place(t, e); }
        save();
      };
      e.addEventListener('pointermove', move); e.addEventListener('pointerup', up); e.addEventListener('pointercancel', up);
    }
    function dragImage(ev) {
      if (!isDM() || !lob || !lob.image || ev.target.closest('.mp-tok')) return;
      ev.preventDefault(); ui.box.setPointerCapture(ev.pointerId);
      var r = ui.box.getBoundingClientRect(), sx = ev.clientX, sy = ev.clientY, ox = lob.imgX, oy = lob.imgY;
      var move = function (m) { lob.imgX = ox + (m.clientX - sx) / r.width; lob.imgY = oy + (m.clientY - sy) / r.height; styleImg(); };
      var up = function () { ui.box.removeEventListener('pointermove', move); ui.box.removeEventListener('pointerup', up); ui.box.removeEventListener('pointercancel', up); save(); };
      ui.box.addEventListener('pointermove', move); ui.box.addEventListener('pointerup', up); ui.box.addEventListener('pointercancel', up);
    }

    /* saving (headmaster) */
    function save(now) {
      if (!lob) return;
      ui.status.textContent = 'Saving…'; clearTimeout(saveT);
      saveT = setTimeout(function () {
        var l = { id: lob.id, name: lob.name, cell: lob.cell, imgScale: lob.imgScale, imgX: lob.imgX, imgY: lob.imgY, members: lob.members, tokens: lob.tokens };
        if (lob._img) l.image = lob.image;
        var id = lob.id;
        call('map', { action: 'save', lobby: l }).then(function (r) {
          if (!r.ok) { ui.status.textContent = r.j.error || 'Save failed'; return; }
          if (lob && lob.id === id) { lob.rev = r.j.lobby.rev; lob._img = false; }
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
      var sn = h('input', { type: 'checkbox', checked: snap }); sn.onchange = function () { snap = sn.checked; };
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
        h('label', { className: 'chk' }, [sn, h('span', { text: 'Snap tokens to the squares' })]),
        note('Drag the map image to move it. Drag a token to move it.'),
      ]));
      ui.side.appendChild(h('div', { className: 'mp-card' }, [h('p', { className: 'mono red', text: 'Souls in this lobby' }), mem, note('Players only see lobbies they are in.')]));
      ui.side.appendChild(tokenCard());
      ui.side.appendChild(h('div', { className: 'mp-card' }, [del]));
    }
    function drawBoxKeepImg() { if (!lob || !ui.grid) return; fit(); Array.prototype.forEach.call(ui.box.querySelectorAll('.mp-tok'), function (n, i) { if (lob.tokens[i]) place(lob.tokens[i], n); }); }

    function tokenCard() {
      var card = h('div', { className: 'mp-card' }), list = h('div', { className: 'mp-list' });
      var tabs = h('div', { className: 'mp-mini' }, [['shadow', 'Monsters'], ['npc', 'NPCs'], ['player', 'Players']].map(function (t) {
        return h('button', { type: 'button', text: t[1], 'aria-pressed': String(tab === t[0]), onclick: function () { tab = t[0]; drawSide(); } });
      }));
      var s = h('input', { type: 'search', placeholder: 'Search ' + (tab === 'shadow' ? 'monsters' : tab === 'npc' ? 'NPCs' : 'players'), value: q, 'aria-label': 'Search tokens' });
      s.oninput = function () { q = s.value; fill(); };
      function source() {
        if (tab === 'player') return G.chars().map(function (c) { return { name: c.name || 'Unnamed', sub: 'Player', img: c.image ? FN + 'chat?avatar=' + c.id + '&v=' + Date.parse(c.updatedAt || 0) : '' }; });
        return G.reg().filter(function (e) { return e.type === tab && e.listed !== false; }).map(function (e) { return { name: e.name, sub: tab === 'npc' ? 'NPC' : 'Monster', img: e.image && !(e.type === 'npc' && e.undisclosed) ? FN + 'registry?img=' + e.id + '&v=' + Date.parse(e.updatedAt || 0) : '' }; });
      }
      function fill() {
        clear(list); var n = 0;
        source().filter(function (e) { return !q || e.name.toLowerCase().indexOf(q.toLowerCase()) >= 0; }).forEach(function (e) {
          n++;
          var add = h('button', { type: 'button', className: 'mp-plus', text: '+', 'aria-label': 'Add ' + e.name + ' to the map' });
          add.onclick = function () {
            var t = { id: 't' + Date.now().toString(36) + Math.floor(Math.random() * 1000), label: e.name.slice(0, 30), img: e.img, x: 0.5, y: 0.5 };
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
        card.appendChild(h('div', { className: 'mp-sel' }, [h('p', { className: 'mono red', text: 'Selected token' }), lab, rmt]));
      }
      return card;
    }
    ui.box = null;
    return { enter: function (r) { if (!built) build(); ui.box.onpointerdown = dragImage; poll(true); start(); }, leave: stop, wake: wake, reset: reset };
  })();

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
        if (!data.cats.some(function (c) { return c.id === cat; }) && cat !== 'debt') cat = data.cats[0] ? data.cats[0].id : 'debt';
        sel = null; line = pickLine(); draw();
      });
    }
    function after(r, okMsg) {
      err = !r.ok; msg = r.ok ? (r.j.message || okMsg || '') : (r.j.error || 'Something went wrong.');
      if (r.ok) { data.karma = r.j.karma; data.debt = r.j.debt; if (G.reloadChar) G.reloadChar(); }
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
      if (!dm) list.appendChild(h('button', { type: 'button', className: 'mk-cat', text: 'Pay debt / Loan', 'aria-pressed': String(cat === 'debt'), onclick: function () { cat = 'debt'; sel = null; msg = ''; draw(); } }));
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
      if (cat === 'debt' && !dm) main.appendChild(debtPanel());
      else if (c) main.appendChild(shelf(c));
      else main.appendChild(note('No categories yet.'));
      root.appendChild(h('div', { className: 'hb-wrap mk' }, [side, main]));
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
    function detail(c, it, kc) {
      var p = it.sale || it.price;
      var box = h('div', { className: 'mk-detail' }, [h('h4', { text: it.name }), it.desc && h('p', { className: 'pre', text: it.desc }), h('p', { className: 'mono red' }, [it.sale ? h('s', { text: money(it.price) }) : null, ' ' + money(p) + ' Karma' + (it.sale ? ' (on sale)' : '')])]);
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
      var la = h('input', { type: 'number', min: 1, placeholder: 'Amount', className: 'ni', 'aria-label': 'Loan amount' });
      var loan = h('button', { type: 'button', className: 'btn primary', text: 'Take a loan' }); loan.onclick = function () { call('market', { action: 'loan', amount: la.value }).then(function (r) { after(r); }); };
      return h('div', { className: 'mk-debt' }, [
        h('div', { className: 'mk-detail' }, [h('h4', { text: 'Pay debt' }), note('Debt is never paid automatically. Choose how much. If you do not have that much karma, the payment is cancelled.'), h('div', { className: 'ef' }, [amt, pay])]),
        h('div', { className: 'mk-detail' }, [h('h4', { text: 'Loan' }), note('Loans are approved automatically and added to your debt. You cannot borrow while you are in debt, and your debt can never pass 10,000 karma.'), h('div', { className: 'ef' }, [la, loan])]),
      ]);
    }
    return { enter: function () { msg = ''; enter(); }, reset: reset };
  })();

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
        if (msg) wrap.appendChild(h('p', { className: 'mk-msg' + (err ? ' bad' : ''), text: msg, role: 'status' }));
        if (!r.j.items.length) wrap.appendChild(note('Nothing here yet. The headmaster adds items as you earn them.'));
        r.j.items.forEach(function (x) {
          var kids = [h('div', { className: 'ef' }, [h('b', { text: x.name }), h('span', { className: 'mono', text: 'x' + x.qty }), badge(x.usable ? 'Can use' : 'Cannot use', x.usable), x.sellable ? badge('Sells for ' + money(x.worth) + ' each', true) : null])];
          if (x.desc) kids.push(h('p', { className: 'pre', text: x.desc }));
          if (x.sellable) {
            var q = h('input', { type: 'number', min: 1, max: x.qty, value: 1, className: 'ni', 'aria-label': 'How many to sell' }), sb = h('button', { type: 'button', className: 'btn' });
            G.two(sb, 'Sell', function () { call('market', { action: 'sell', name: x.name, qty: q.value }).then(function (r2) { err = !r2.ok; msg = r2.ok ? r2.j.message : (r2.j.error || 'Could not sell.'); if (r2.ok && G.reloadChar) G.reloadChar(); mine(); }); });
            sb.textContent = 'Sell'; kids.push(h('div', { className: 'ef' }, [q, sb]));
          }
          wrap.appendChild(h('div', { className: 'mk-detail' }, kids));
        });
        root.appendChild(wrap);
      });
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
      function go(action, extra) {
        out.className = 'mono hb-note'; out.textContent = 'Working…';
        call('market', Object.assign({ action: action, id: who.value, name: nm.value, qty: qty.value }, extra || {})).then(function (r) {
          out.textContent = r.ok ? r.j.message : (r.j.error || 'Failed.'); if (!r.ok) out.className = 'mono hb-note bad'; else if (G.reloadChars) G.reloadChars();
        });
      }
      function btn(t, fn, confirm) { var b = h('button', { type: 'button', className: 'btn' + (confirm ? '' : ' primary'), text: t }); if (confirm) G.two(b, t, fn); else b.onclick = fn; return b; }
      root.appendChild(h('div', { className: 'hb-wrap' }, [note('Quick tools: change a character without opening their sheet. Negative karma turns into debt by itself.'), h('div', { className: 'mk-detail' }, [h('p', { className: 'mono red', text: 'Character' }), who]),
        h('div', { className: 'mk-detail' }, [h('p', { className: 'mono red', text: 'Karma' }), h('div', { className: 'ef' }, [amt, btn('Add karma (use a minus to take it)', function () { go('hm_karma', { amount: amt.value }); })])]),
        h('div', { className: 'mk-detail' }, [h('p', { className: 'mono red', text: 'Items' }), h('div', { className: 'ef' }, [nm, dl, 'x', qty]),
          h('div', { className: 'ef' }, [btn('Add item', function () { go('hm_additem'); }), btn('Take item', function () { go('hm_takeitem'); }, true), to, btn('Give item to them', function () { go('hm_giveitem', { to: to.value }); }, true)]),
          note('Add creates the item for the character. Take removes it. Give moves it from the character above to the one beside the Give button.')]), out]));
    }
    return { enter: function () { msg = ''; clear(root).appendChild(note('Opening…')); if (isDM()) tools(); else mine(); }, reset: reset };
  })();

  /* ======================= DICE LOG ======================= */
  modules.dice = (function () {
    var root = $('pane-dice');
    function enter() {
      clear(root).appendChild(note('Gathering the dice…'));
      call('rolls', { action: 'list' }).then(function (r) {
        clear(root); if (!r.ok) { root.appendChild(note(r.j.error || 'Could not open the dice log.')); return; }
        var dm = !!G.creds(), rows = r.j.rolls || [], names = [];
        rows.forEach(function (x) { if (x.name && names.indexOf(x.name) < 0) names.push(x.name); });
        var sel = h('select', { 'aria-label': 'Filter by character' }, [h('option', { value: '', text: 'Everyone' })].concat(names.sort().map(function (n) { return h('option', { value: n, text: n }); })));
        var box = h('div', { className: 'dl-wrap' });
        function draw() {
          clear(box); var f = rows.filter(function (x) { return !sel.value || x.name === sel.value; });
          if (!f.length) { box.appendChild(note('No rolls yet.')); return; }
          var t = h('table', { className: 'dl-tbl' }, [h('tr', {}, [h('th', { text: 'When' }), dm ? h('th', { text: 'Soul' }) : null, h('th', { text: 'Roll' }), h('th', { text: 'Result' })])]);
          f.forEach(function (x) { t.appendChild(h('tr', {}, [h('td', { className: 'mono', text: new Date(x.at).toLocaleString() }), dm ? h('td', { text: x.name }) : null, h('td', { text: x.label }), h('td', { className: 'mono ' + (x.cls || ''), text: x.txt })])); });
          box.appendChild(t);
        }
        sel.onchange = draw; draw();
        root.appendChild(h('div', { className: 'hb-wrap' }, [dm ? h('div', { className: 'ef' }, [sel, note('The latest 300 rolls from every soul.')]) : note('Your last 60 rolls.'), box]));
      });
    }
    return { enter: enter, reset: function () { clear(root); } };
  })();

  /* ======================= CHAT ======================= */
  modules.chat = (function () {
    var root = $('pane-chat'), ui = {}, built = false, me = null, members = [], byId = {}, unread = {}, ch = 'ooc', who = null, lastKey = '', timer = null, mtimer = null, recent = [], picking = false, editing = false, seen = {}, pending = [];
    function isDM() { return !!G.creds(); }
    function reset() { built = false; clear(root); stop(); me = null; members = []; recent = []; ch = 'ooc'; who = null; lastKey = ''; seen = {}; pending = []; }
    function stop() { clearInterval(timer); clearInterval(mtimer); timer = mtimer = null; }
    function body(extra) { return Object.assign(ch === 'ooc' || ch === 'rp' ? { channel: ch } : { with: who }, extra || {}); }

    function enter() {
      if (!built) { clear(root).appendChild(note('Opening the chat…')); }
      call('chat', { action: 'members' }).then(function (r) {
        if (!r.ok) { clear(root).appendChild(note(r.j.error || 'Could not open the chat.')); return; }
        take(r.j); if (!built) { build(); }
        drawSide(); openChannel(ch, who, true);
        stop(); timer = setInterval(function () { if (!document.hidden) fetchNew(); }, 2500); mtimer = setInterval(function () { if (!document.hidden) refreshMembers(); }, 12000);
      });
    }
    function take(j) {
      me = j.me; members = j.members; unread = j.unread || {}; byId = {}; members.forEach(function (m) { byId[m.id] = m; });
      Object.keys(unread).forEach(function (k) { if (recent.indexOf(k) < 0) recent.push(k); });
    }
    function refreshMembers() { call('chat', { action: 'members' }).then(function (r) { if (!r.ok) return; var was = JSON.stringify(unread) + members.length; take(r.j); if (was !== JSON.stringify(unread) + members.length && !editing) drawSide(); }); }

    function build() {
      clear(root); built = true;
      ui.side = h('div', { className: 'cht-side' }); ui.log = h('div', { className: 'cht-log', 'aria-live': 'polite' }); ui.head = h('h3', { className: 'cht-title' });
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
      ui.main = h('div', { className: 'cht-main' }, [ui.head, ui.log, h('div', { className: 'cht-compose' }, [ui.imgBtn, ui.in, ui.send, ui.file]), ui.err, note('Players appear by their first name. Chat logs are deleted every month.')]);
      root.appendChild(h('div', { className: 'hb-wrap cht' }, [ui.side, ui.main]));
    }
    function avatar(m, cls) { return thumb(m && m.avatar, (m && m.name || '?').charAt(0).toUpperCase(), 'av ' + (cls || '')); }

    function drawSide() {
      if (!ui.side) return;
      clear(ui.side);
      var meM = byId[me] || { name: isDM() ? 'Headmaster' : '?' };
      if (isDM()) meM = byId.hm || meM;
      var prof = h('div', { className: 'cht-me' }, [avatar(meM, 'lg'), h('b', { text: meM.name }), h('small', { className: 'mono', text: isDM() ? 'Headmaster' : 'You' })]);
      ui.side.appendChild(prof);
      if (isDM()) {
        var ed = h('button', { type: 'button', className: 'link', text: editing ? 'Close profile editor' : 'Edit my profile' }); ed.onclick = function () { editing = !editing; drawSide(); }; ui.side.appendChild(ed);
        if (editing) ui.side.appendChild(profileEditor(meM));
      } else ui.side.appendChild(note('Your name and icon come from your character.'));
      ui.side.appendChild(h('p', { className: 'mono red cht-h', text: 'Chat logs' }));
      [['ooc', 'OOC'], ['rp', 'RP chat']].forEach(function (c) { ui.side.appendChild(h('button', { type: 'button', className: 'cht-btn', text: c[1], 'aria-pressed': String(!picking && ch === c[0]), onclick: function () { picking = false; openChannel(c[0], null); } })); });
      ui.side.appendChild(h('p', { className: 'mono red cht-h', text: 'Private messages' }));
      var nw = h('button', { type: 'button', className: 'cht-btn new', text: '+ New message', 'aria-pressed': String(picking) }); nw.onclick = function () { picking = true; showPicker(); drawSide(); }; ui.side.appendChild(nw);
      recent.filter(function (id) { return byId[id]; }).forEach(function (id) {
        var m = byId[id], n = unread[id] || 0;
        var b = h('button', { type: 'button', className: 'cht-btn', 'aria-pressed': String(!picking && ch === 'pm' && who === id) }, [h('span', { text: m.name }), n ? h('span', { className: 'cht-new', text: '+' + n + ' new message' + (n > 1 ? 's' : '') }) : null]);
        b.onclick = function () { picking = false; openChannel('pm', id); }; ui.side.appendChild(b);
      });
    }
    function profileEditor(m) {
      var c = { image: m.avatar || '' }, crop = G.cropper(c), nm = h('input', { value: m.name === '?' ? '' : m.name, maxLength: 30, 'aria-label': 'Display name' });
      var sv = h('button', { type: 'button', className: 'btn primary', text: 'Save profile' }), st = h('small', { className: 'mono' });
      sv.onclick = function () {
        var body = { action: 'setprofile', name: nm.value }; if (/^data:/.test(c.image) || c.image === '') body.image = c.image;
        call('chat', body).then(function (r) { st.textContent = r.ok ? 'Saved.' : (r.j.error || 'Could not save.'); if (r.ok) { editing = false; enter(); } });
      };
      return h('div', { className: 'ed cht-prof' }, [h('label', { className: 'fl' }, [h('span', { text: 'Display name' }), nm]), crop, sv, st]);
    }
    function showPicker() {
      clear(ui.head); ui.head.textContent = 'Who do you want to message?'; clear(ui.log);
      members.filter(function (m) { return m.id !== me; }).forEach(function (m) {
        var b = h('button', { type: 'button', className: 'cht-pick' }, [avatar(m), h('b', { text: m.name })]);
        b.onclick = function () { picking = false; if (recent.indexOf(m.id) < 0) recent.push(m.id); openChannel('pm', m.id); drawSide(); };
        ui.log.appendChild(b);
      });
      if (members.length < 2) ui.log.appendChild(note('Nobody else is here yet.'));
    }
    function openChannel(c, w, keep) {
      ch = c; who = w; lastKey = ''; seen = {}; pending = []; clear(ui.log);
      ui.head.textContent = c === 'ooc' ? 'OOC' : c === 'rp' ? 'RP chat' : (byId[w] ? byId[w].name : 'Private message');
      if (picking) { showPicker(); return; }
      if (c === 'pm') { delete unread[w]; }
      drawSide(); fetchNew(true);
    }
    function fetchNew(first) {
      if (picking || !built) return;
      var mine = ch + '|' + who;
      call('chat', body(lastKey ? { action: 'history', after: lastKey } : { action: 'history' })).then(function (r) {
        if (!r.ok || mine !== ch + '|' + who) return;
        var msgs = r.j.msgs || []; if (!msgs.length) { if (first && !ui.log.children.length) ui.log.appendChild(h('p', { className: 'mono hb-note cht-empty', text: 'No messages yet. Say something.' })); return; }
        var empty = ui.log.querySelector('.cht-empty'); if (empty) empty.remove();
        var near = ui.log.scrollHeight - ui.log.scrollTop - ui.log.clientHeight < 80 || first;
        msgs.forEach(function (m) {
          lastKey = m.k;
          if (seen[m.k]) return;
          if (m.from === me) { // our own message came back: drop the "sending" copy of it
            var pi = -1; pending.forEach(function (p, n) { if (pi < 0 && p.text === (m.text || '') && !!p.image === !!m.img) pi = n; });
            if (pi >= 0) { pending[pi].el.remove(); pending.splice(pi, 1); }
          }
          seen[m.k] = 1; ui.log.appendChild(bubble(m));
        });
        if (near) ui.log.scrollTop = ui.log.scrollHeight;
      });
    }
    function bubble(m) {
      var mine = m.from === me, p = byId[m.from] || { name: '?', avatar: '' };
      var txt = h('div', { className: 'cht-txt' }, [mine ? null : h('small', { className: 'mono', text: p.name }), m.text ? h('p', { text: m.text }) : null, m.img ? h('img', { className: 'cht-img', src: FN + 'chat?mimg=' + encodeURIComponent(m.img), alt: 'Shared image', loading: 'lazy' }) : null]);
      return h('div', { className: 'cht-msg' + (mine ? ' mine' : '') }, mine ? [txt, avatar(p, 'sm')] : [avatar(p, 'sm'), txt]);
    }
    // The message shows up at once, a little faded with "Sending…", and settles when the server confirms it.
    function send() {
      if (ch === 'pm' && !who) return;
      var text = ui.in.value.trim(), image = ui.pend; if (!text && !image) return;
      ui.in.value = ''; ui.pend = null; ui.imgBtn.textContent = '+ image'; ui.err.textContent = '';
      var p = byId[me] || { name: '?', avatar: '' }, state = h('small', { className: 'mono cht-state', text: 'Sending…' });
      var txt = h('div', { className: 'cht-txt' }, [text ? h('p', { text: text }) : null, image ? h('img', { className: 'cht-img', src: image, alt: 'Image being sent' }) : null, state]);
      var el = h('div', { className: 'cht-msg mine pending' }, [txt, avatar(p, 'sm')]);
      var rec = { text: text, image: image, el: el }; pending.push(rec);
      var empty = ui.log.querySelector('.cht-empty'); if (empty) empty.remove();
      ui.log.appendChild(el); ui.log.scrollTop = ui.log.scrollHeight; ui.in.focus();
      function go() {
        el.classList.remove('failed'); state.textContent = 'Sending…';
        call('chat', body({ action: 'send', text: text, image: image || undefined })).then(function (r) {
          if (!r.ok) { el.classList.add('failed'); state.textContent = (r.j.error || 'Not sent') + ' · tap to retry'; el.onclick = function () { el.onclick = null; go(); }; return; }
          seen[r.j.k] = 1;
          var i = pending.indexOf(rec);
          if (i >= 0) { pending.splice(i, 1); el.classList.remove('pending'); state.remove(); } // the server confirmed it: it simply becomes a normal message
        });
      }
      go();
    }
    return { enter: enter, leave: stop, reset: reset, wake: function () { if (built) fetchNew(); } };
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
        var chk = function (label, k) { var i = h('input', { type: 'checkbox', checked: !!c[k] }); i.onchange = function () { c[k] = i.checked; }; return h('label', { className: 'chk' }, [i, h('span', { text: label })]); };
        box.appendChild(h('div', { className: 'ef' }, [chk('Players can sell this back (90% of its price)', 'sellable'), chk('Players can use this item', 'usable')]));
      }
      box.appendChild(crop);
      box.appendChild(txt('Description (everyone can read this)', 'desc', 5, 2000));
      var save = h('button', { type: 'button', className: 'btn primary', text: 'Save' });
      save.onclick = function () {
        save.disabled = true; st.textContent = 'Saving…';
        var e = { kind: c.kind, name: c.name, desc: c.desc, category: c.category, price: c.price, sellable: !!c.sellable, usable: !!c.usable };
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
