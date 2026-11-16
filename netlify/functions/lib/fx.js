// Buffs and debuffs. A buff is a small record on the character ({stat, amt, perm, source, group}); the base stats are never changed,
// so ending a buff puts everything back exactly. The sheet adds the live buffs on top when it shows the character.
const crypto = require('crypto');
const { S, N } = require('./auth');

const FXSTATS = ['STR', 'INT', 'DEX', 'WIS', 'CHA', 'CON', 'HP', 'Armor', 'Speed', 'Initiative', 'Other'];
// Clean a list of effects written by the headmaster: { kind: 'buff'|'debuff', stat, amt (always positive here), perm, note }.
function cleanFx(list) {
  return (Array.isArray(list) ? list : []).slice(0, 10).map((e) => {
    e = e || {};
    const kind = e.kind === 'debuff' ? 'debuff' : 'buff', stat = FXSTATS.includes(e.stat) ? e.stat : 'Other';
    return { kind, stat, amt: N(Math.abs(Number(e.amt) || 0), 0, 999), perm: !!e.perm, note: S(e.note, 120).trim() };
  }).filter((e) => e.amt > 0 || (e.stat === 'Other' && e.note));
}
const signed = (e) => (e.kind === 'debuff' ? -e.amt : e.amt);
const label = (e) => (e.stat === 'Other' ? e.note : (signed(e) > 0 ? '+' : '-') + e.amt + ' ' + e.stat + (e.note ? ' (' + e.note + ')' : '')) + (e.perm ? ' (permanent)' : ' (until ended)');
// Put the effects on a character. Returns how many were added (a character carries at most 40).
function addBuffs(c, source, fx, group, extra) {
  c.buffs = Array.isArray(c.buffs) ? c.buffs : [];
  let n = 0;
  fx.forEach((e) => {
    if (c.buffs.length >= 40) return;
    c.buffs.push(Object.assign({ id: crypto.randomUUID(), group, source: S(source, 100), kind: e.kind, stat: e.stat, amt: signed(e), perm: !!e.perm, note: e.note, at: new Date().toISOString() }, extra && extra.status ? { status: extra.status } : {}));
    n++;
  });
  return n;
}

// Dice an item rolls when it is used (heal, damage and so on), written like a skill's effects: { type, n, d, flat, stat, note }.
const ST = ['STR', 'INT', 'DEX', 'WIS', 'CHA', 'CON'], TYPES = ['Damage', 'Heal', 'Shield', 'Other'];
function cleanDice(list) {
  return (Array.isArray(list) ? list : []).slice(0, 10).map((e) => {
    e = e || {};
    return { type: TYPES.includes(e.type) ? e.type : 'Other', n: N(e.n, 0, 50), d: N(e.d, 0, 1000), flat: N(e.flat, -999, 999), stat: ST.includes(e.stat) ? e.stat : '', note: S(e.note, 120).trim() };
  }).filter((e) => e.n > 0 || e.flat !== 0);
}
// A stat's modifier as it is right now (saved score plus live buffs). Same formula as the sheet: floor((score - 8) / 2), never below 0.
function effMod(c, k) {
  let sc = Number(((c.stats || {})[k] || {}).score) || 0;
  (Array.isArray(c.buffs) ? c.buffs : []).forEach((b) => { if (b.stat === k) sc += Number(b.amt) || 0; });
  return Math.max(0, Math.floor((Math.max(0, sc) - 8) / 2));
}
const diceName = (e) => e.type + ' ' + e.n + 'd' + e.d + (e.stat ? ' + ' + e.stat : '') + (e.flat ? (e.flat > 0 ? ' + ' : ' - ') + Math.abs(e.flat) : '') + (e.note ? ' (' + e.note + ')' : '');
// Rolls each effect on the server, so nobody can fake it. Returns [{label, txt}].
function rollDice(list, c, source) {
  return (Array.isArray(list) ? list : []).map((e) => {
    const m = (e.stat ? effMod(c, e.stat) : 0) + (Number(e.flat) || 0), vals = [];
    let t = m; for (let i = 0; i < e.n; i++) { const v = crypto.randomInt(1, Math.max(1, e.d) + 1); vals.push(v); t += v; }
    return { type: e.type, total: Math.max(0, t), label: source + ' ' + diceName(e), txt: '[' + vals.join(', ') + ']' + (m ? (m > 0 ? ' + ' : ' - ') + Math.abs(m) : '') + ' = ' + t };
  });
}
// HP as the sheet shows it: saved max plus live HP buffs; current HP stays at full until someone changes it.
const maxHp = (c) => Math.max(0, (Number(c.hp) || 0) + (Array.isArray(c.buffs) ? c.buffs : []).reduce((a, x) => a + (x.stat === 'HP' ? Number(x.amt) || 0 : 0), 0));
const curHp = (c) => (c.hpNow == null ? maxHp(c) : Math.max(0, Math.min(Number(c.hpNow) || 0, maxHp(c))));
const modFromScore = (sc) => Math.max(0, Math.floor(((Number(sc) || 0) - 8) / 2));

// What an item does beyond buffs and dice: raise a stat for good (at random, or one the player picks), and cure fixed effects.
function cleanStatUp(o) {
  o = o || {};
  const mode = ['random', 'choose'].includes(o.mode) ? o.mode : 'none';
  return { mode, amt: N(o.amt == null ? 1 : o.amt, 1, 20), stats: (Array.isArray(o.stats) ? o.stats : []).filter((k, i, a) => ST.includes(k) && a.indexOf(k) === i) };
}
function cleanCleanse(o) {
  o = o || {};
  return { all: !!o.all, ids: (Array.isArray(o.ids) ? o.ids : []).map((x) => String(x)).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 40) };
}
// Which of a character's effects does this cure list remove?
const cures = (cl, b) => !!cl && ((cl.all && (b.kind === 'debuff' || Number(b.amt) < 0)) || (b.status && (cl.ids || []).includes(b.status)));
module.exports = { ST, maxHp, curHp, modFromScore, cleanStatUp, cleanCleanse, cures, FXSTATS, cleanFx, addBuffs, label, signed, cleanDice, diceName, rollDice, effMod };
