// Chapter 1 visual novel player. The script (text, timings) comes from the server with the chapter.
// Voice: one Japanese recording, played piece by piece. Sound: a quiet ominous drone starts when the picture appears.
(function () {
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  // The card shown inside the book page.
  window.GEH_vnCard = function (vn) {
    var card = el('div', 'vn-card');
    card.appendChild(el('p', 'mono red', 'Visual novel'));
    var go = el('button', 'btn primary', 'Begin Chapter 1'); go.type = 'button';
    go.addEventListener('click', function () { play(vn, go); });
    card.appendChild(go);
    return card;
  };

  function play(vn, opener) {
    var AC = window.AudioContext || window.webkitAudioContext, ctx = null, voiceBuf = null, omBuf = null;
    var root = el('div', 'vn'); root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Chapter 1, visual novel');
    var stage = el('div', 'vn-stage'), img = new Image(); img.alt = vn.imageAlt || ''; img.decoding = 'async'; img.src = vn.image;
    stage.appendChild(img); root.appendChild(stage); root.appendChild(el('div', 'vn-vig'));
    var wrap = el('div', 'vn-textwrap'), text = el('div', 'vn-text'); wrap.appendChild(text); root.appendChild(wrap);
    root.appendChild(el('div', 'vn-more'));
    var sr = el('p', 'sr-only'); sr.setAttribute('aria-live', 'polite'); root.appendChild(sr);
    root.appendChild(el('div', 'vn-paused', 'Paused'));

    var ui = el('div', 'vn-ui');
    function btn(label, fn, pressed) { var b = el('button', '', label); b.type = 'button'; if (pressed != null) b.setAttribute('aria-pressed', String(pressed)); b.addEventListener('click', function (e) { e.stopPropagation(); fn(b); b.blur(); }); ui.appendChild(b); return b; }
    var bBack = btn('\u2039 Back', function () { go(S.i - 1); });
    var bPause = btn('Pause', function () { setPaused(!S.paused); });
    var bAuto = btn('Auto on', function (b) { S.auto = !S.auto; b.textContent = S.auto ? 'Auto on' : 'Auto off'; b.setAttribute('aria-pressed', String(S.auto)); }, true);
    var bSound = btn('Voice on', function (b) { S.voice = !S.voice; b.textContent = S.voice ? 'Voice on' : 'Voice off'; b.setAttribute('aria-pressed', String(S.voice)); if (voiceOut) voiceOut.gain.setTargetAtTime(S.voice ? 1 : 0, ctx.currentTime, 0.05); }, true);
    btn('\u2715 Close', close);
    root.appendChild(ui);

    var start = el('div', 'vn-start show');
    start.appendChild(el('p', 'mono', 'Gehenna\u2019s Gate \u00b7 Storyline'));
    start.appendChild(el('h2', '', 'Chapter 1'));
    var begin = el('button', 'go', 'Loading\u2026'); begin.type = 'button'; begin.disabled = true; start.appendChild(begin);
    root.appendChild(start);
    var end = el('div', 'vn-end');
    end.appendChild(el('p', 'mono', 'End of Chapter 1'));
    var row = el('div', 'vn-row'), bRe = el('button', '', 'Play again'), bCl = el('button', '', 'Back to the book');
    bRe.type = bCl.type = 'button'; row.appendChild(bRe); row.appendChild(bCl); end.appendChild(row); root.appendChild(end);

    var prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    document.body.appendChild(root); begin.focus();

    var S = { i: -1, t: 0, dur: 0, typeDur: 0, total: 0, paused: false, auto: true, voice: true, running: false, ready: false, last: 0, raf: 0, started: false };
    var voiceOut = null, clip = null, drone = null, imgOn = false, closed = false;
    var imgIdx = 0; vn.pages.forEach(function (p, n) { if (p.image && !imgIdx) imgIdx = n; });

    // ---- audio
    function decode(url) {
      return fetch(url).then(function (r) { if (!r.ok) throw new Error(); return r.arrayBuffer(); })
        .then(function (b) { return new Promise(function (res, rej) { ctx.decodeAudioData(b, res, rej); }); });
    }
    if (AC) {
      ctx = new AC(); voiceOut = ctx.createGain(); voiceOut.connect(ctx.destination);
    }
    var loads = [
      ctx ? decode(vn.voice).then(function (b) { voiceBuf = b; }).catch(function () {}) : Promise.resolve(),
      ctx ? decode(vn.ominous).then(function (b) { omBuf = b; }).catch(function () {}) : Promise.resolve(),
      new Promise(function (res) { if (img.complete) res(); else { img.onload = img.onerror = function () { res(); }; } })
    ];
    Promise.all(loads).then(function () {
      if (closed) return;
      begin.disabled = false; begin.textContent = voiceBuf ? 'Begin' : 'Begin without sound'; begin.focus();
    });
    begin.addEventListener('click', function (e) {
      e.stopPropagation();
      if (ctx && ctx.state === 'suspended') ctx.resume();
      start.classList.remove('show'); S.started = true; S.running = true; go(0);
      S.last = performance.now(); S.raf = requestAnimationFrame(loop);
    });
    function playClip(p) {
      stopClip(0.06);
      if (!ctx || !voiceBuf) return;
      var a = Math.max(0, p.t[0] - 0.12), b = Math.min(voiceBuf.duration, p.t[1] + 0.15), len = b - a, now = ctx.currentTime;
      var src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = voiceBuf; g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(1, now + 0.03);
      g.gain.setValueAtTime(1, now + len - 0.12); g.gain.linearRampToValueAtTime(0, now + len);
      src.connect(g); g.connect(voiceOut); src.start(now, a, len); clip = { src: src, g: g };
    }
    function stopClip(f) {
      if (!clip) return; var c = clip; clip = null;
      try { var n = ctx.currentTime; c.g.gain.cancelScheduledValues(n); c.g.gain.setValueAtTime(c.g.gain.value, n); c.g.gain.linearRampToValueAtTime(0, n + f); c.src.stop(n + f + 0.02); } catch (e) {}
    }
    function startDrone() {
      if (drone || !ctx || !omBuf) return;
      var src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = omBuf; g.gain.value = 0.9; src.connect(g); g.connect(ctx.destination); src.start(); drone = { src: src, g: g };
    }
    function stopDrone(f) {
      if (!drone) return; var d = drone; drone = null;
      try { var n = ctx.currentTime; d.g.gain.cancelScheduledValues(n); d.g.gain.setValueAtTime(d.g.gain.value, n); d.g.gain.linearRampToValueAtTime(0, n + f); d.src.stop(n + f + 0.05); } catch (e) {}
    }

    // ---- pages
    function esc(i) { return Math.max(0, Math.min(vn.pages.length - 1, i)); }
    function go(i) {
      if (i < 0) i = 0;
      if (i >= vn.pages.length) { finish(); return; }
      var p = vn.pages[i], chars = p.lines.join('').length, clipLen = p.t[1] - p.t[0] + 0.27, read = 1.2 + chars / 15;
      S.i = i; S.t = 0; S.ready = false; S.total = chars;
      S.typeDur = reduce ? 0 : Math.min(Math.max(clipLen * 0.8, 0.9), Math.max(0.9, chars / 18));
      S.dur = Math.max(clipLen + 0.35, read) + 0.9 + (p.after || 0);
      root.classList.remove('ready', 'shake', 'ending'); end.classList.remove('show');
      // the picture and the sound
      var wantImg = i >= imgIdx;
      if (wantImg && !imgOn) { imgOn = true; root.classList.remove('img-off'); root.classList.add('img-on'); startDrone(); }
      if (!wantImg && imgOn) { imgOn = false; root.classList.remove('img-on'); root.classList.add('img-off'); stopDrone(1.5); }
      if (p.kind === 'shout' && !reduce) { void root.offsetWidth; root.classList.add('shake'); }
      // the text
      wrap.classList.remove('in');
      var swap = function () {
        if (closed || S.i !== i) return;
        text.className = 'vn-text' + (p.kind ? ' k-' + p.kind : ''); text.textContent = '';
        p.lines.forEach(function (l) { var s = el('span', 'ln'); s.dataset.full = l; text.appendChild(s); });
        sr.textContent = p.lines.join(' '); render(0); wrap.classList.add('in');
        playClip(p); S.t = 0;
      };
      if (S.paused) setPaused(false);
      setTimeout(swap, i === 0 ? 700 : 260);
      S.t = -1; // short breath before the page starts
      bBack.disabled = i === 0;
    }
    function render(n) {
      var left = n, lines = text.children;
      for (var k = 0; k < lines.length; k++) { var f = lines[k].dataset.full; lines[k].textContent = left >= f.length ? f : f.slice(0, Math.max(0, left)); left -= f.length; }
    }
    function typing() { return S.t >= 0 && S.total > 0 && S.typeDur > 0 && S.t < S.typeDur; }
    function tick() {
      if (S.t < 0) return;
      var p = vn.pages[S.i];
      render(S.typeDur ? Math.floor(Math.min(1, S.t / S.typeDur) * S.total) : S.total);
      var done = !typing();
      if (done && !S.ready) { S.ready = true; root.classList.add('ready'); }
      if (p.after && S.t > S.dur - p.after + 0.3) text.classList.add('hide');
      if (S.auto && S.t >= S.dur) go(S.i + 1);
    }
    function loop(ts) {
      var dt = Math.min((ts - S.last) / 1000, 0.1); S.last = ts;
      if (S.running && !S.paused) { S.t += dt; if (S.t >= 0) tick(); }
      S.raf = requestAnimationFrame(loop);
    }
    function advance() {
      if (!S.started || !S.running) return;
      if (S.t < 0) return;
      if (typing()) { S.t = S.typeDur; tick(); return; }
      go(S.i + 1);
    }
    function setPaused(v) {
      if (!S.started) return; S.paused = v; root.classList.toggle('paused', v); bPause.textContent = v ? 'Play' : 'Pause'; bPause.setAttribute('aria-pressed', String(v));
      if (ctx) { if (v) ctx.suspend(); else ctx.resume(); }
    }
    function finish() {
      S.running = false; root.classList.remove('ready'); wrap.classList.remove('in'); stopClip(0.3);
      if (imgOn) { imgOn = false; root.classList.remove('img-on'); root.classList.add('img-off'); }
      stopDrone(4);
      setTimeout(function () { if (!closed) { end.classList.add('show'); bCl.focus(); } }, 2600);
    }
    function close() {
      if (closed) return; closed = true; cancelAnimationFrame(S.raf);
      document.removeEventListener('keydown', onKey, true); document.removeEventListener('visibilitychange', onVis);
      stopClip(0.1); stopDrone(0.4);
      setTimeout(function () { try { if (ctx) ctx.close(); } catch (e) {} }, 600);
      root.remove(); document.body.style.overflow = prevOverflow; if (opener && opener.focus) opener.focus();
    }
    bCl.addEventListener('click', function (e) { e.stopPropagation(); close(); });
    bRe.addEventListener('click', function (e) { e.stopPropagation(); end.classList.remove('show'); imgOn = false; root.classList.remove('img-on', 'img-off'); stopDrone(0.2); S.running = true; go(0); });
    root.addEventListener('click', function () { if (!end.classList.contains('show')) advance(); });
    function onKey(e) {
      if (!S.started) { if (e.key === 'Escape') { e.preventDefault(); close(); } return; }
      if (e.target && /^(BUTTON)$/.test(e.target.tagName) && (e.key === ' ' || e.key === 'Enter')) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); if (!end.classList.contains('show')) advance(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); if (S.running) go(S.i - 1); }
      else if (e.key === 'p' || e.key === 'P') setPaused(!S.paused);
    }
    function onVis() { if (document.hidden && S.started && S.running && !S.paused) setPaused(true); }
    document.addEventListener('keydown', onKey, true); document.addEventListener('visibilitychange', onVis);
  }
})();
