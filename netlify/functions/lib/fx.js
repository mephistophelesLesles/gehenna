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
function addBuffs(c, source, fx, group) {
  c.buffs = Array.isArray(c.buffs) ? c.buffs : [];
  let n = 0;
  fx.forEach((e) => {
    if (c.buffs.length >= 40) return;
    c.buffs.push({ id: crypto.randomUUID(), group, source: S(source, 100), kind: e.kind, stat: e.stat, amt: signed(e), perm: !!e.perm, note: e.note, at: new Date().toISOString() });
    n++;
  });
  return n;
}
module.exports = { FXSTATS, cleanFx, addBuffs, label, signed };
