// Using an item: the checks, the changes, and the queue the headmaster approves from while a soul is in battle.
// Shared by market.js (a player uses an item) and effects.js (the headmaster allows a waiting request).
const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');
const { addBuffs, label: fxLabel, rollDice, ST, maxHp, curHp, modFromScore, cures } = require('./fx');

// Would using this item do anything right now? Returns { error, needStat } or { ok: true }. Nothing is changed.
function checkUse(c, e, have, stat) {
  if (!have || !e) return { error: 'You do not have that item.' };
  const fx = Array.isArray(e.use) ? e.use : [], dice = Array.isArray(e.effects) ? e.effects : [];
  const up = e.statUp && e.statUp.mode !== 'none' ? e.statUp : null, cl = e.cleanse && (e.cleanse.all || (e.cleanse.ids || []).length) ? e.cleanse : null;
  const allowed = up ? (up.stats && up.stats.length ? up.stats : ST) : [];
  const hit = (Array.isArray(c.buffs) ? c.buffs : []).filter((x) => cures(cl, x));
  if (!fx.length && !dice.length && !up && !cl) return { error: e.name + ' has no effect set up yet, so it was not used. Ask the headmaster.' };
  if (up && up.mode === 'choose' && !allowed.includes(String(stat || ''))) return { error: 'Choose which stat to raise.', needStat: true };
  if (dice.length && dice.every((d) => d.type === 'Heal') && !fx.length && !up && !cl && curHp(c) >= maxHp(c)) return { error: 'You are already at full HP, so ' + e.name + ' was not used.' };
  if (cl && !fx.length && !dice.length && !up && !hit.length) return { error: 'You are not under anything ' + e.name + ' can cure, so it was not used.' };
  return { ok: true };
}
// Does the item's effect and uses up one copy. Changes c in memory (the caller saves it). Returns { changes, rolled }.
function applyUse(c, e, have, stat) {
  const fx = Array.isArray(e.use) ? e.use : [], dice = Array.isArray(e.effects) ? e.effects : [];
  const up = e.statUp && e.statUp.mode !== 'none' ? e.statUp : null, cl = e.cleanse && (e.cleanse.all || (e.cleanse.ids || []).length) ? e.cleanse : null;
  const allowed = up ? (up.stats && up.stats.length ? up.stats : ST) : [];
  c.buffs = Array.isArray(c.buffs) ? c.buffs : []; c.stats = c.stats || {};
  const hit = c.buffs.filter((x) => cures(cl, x)), changes = [];
  // Heal and damage change HP for real. The roll is made here and written into the dice log.
  const rolled = rollDice(dice, c, e.name);
  rolled.forEach((r) => {
    if (r.type === 'Heal' || r.type === 'Damage') {
      const before = curHp(c), mx = maxHp(c), after = r.type === 'Heal' ? Math.min(mx, before + r.total) : Math.max(0, before - r.total);
      c.hpNow = after;
      changes.push({ kind: r.type === 'Heal' ? 'heal' : 'damage', text: (r.type === 'Heal' ? 'Healed ' : 'Took ') + Math.abs(after - before) + ' HP' + (r.type === 'Heal' && r.total > after - before ? ' (rolled ' + r.total + ', capped at full HP)' : ''), from: before, to: after, max: mx, roll: r.txt });
    } else changes.push({ kind: 'info', text: r.label + ': ' + r.txt });
  });
  if (up) {
    const k = up.mode === 'random' ? allowed[crypto.randomInt(0, allowed.length)] : String(stat), s0 = c.stats[k] = c.stats[k] || { score: 0, mod: 0 };
    const before = Number(s0.score) || 0, after = Math.min(99, before + up.amt);
    s0.score = after; s0.mod = modFromScore(after);
    changes.push({ kind: 'stat', stat: k, amt: after - before, from: before, to: after, random: up.mode === 'random', text: k + ' +' + (after - before) + ' permanently' });
  }
  if (fx.length && addBuffs(c, e.name, fx, crypto.randomUUID())) fx.forEach((x) => changes.push({ kind: 'buff', text: fxLabel(x), bad: x.kind === 'debuff' }));
  if (hit.length) {
    c.buffs = c.buffs.filter((x) => !cures(cl, x));
    changes.push({ kind: 'cleanse', text: 'Cured: ' + hit.map((x) => x.source || x.note || x.stat).filter((n, i, a) => a.indexOf(n) === i).join(', ') });
  } else if (cl) changes.push({ kind: 'info', text: 'Nothing to cure right now.' });
  have.qty -= 1; c.items = c.items.filter((x) => x.qty > 0);
  return { changes, rolled };
}
async function logRolls(c, rolled) {
  if (!rolled.length) return;
  const rs = getStore('gehenna-rolls'), list = (await rs.get(c.id, { type: 'json' })) || [];
  rolled.forEach((r) => list.unshift({ at: new Date().toISOString(), name: c.name, label: r.label, txt: r.txt, cls: '' }));
  await rs.setJSON(c.id, list.slice(0, 60)); await rs.set('_rev', Date.now() + '-' + Math.random().toString(36).slice(2, 6));
}
const doneMsg = (e, changes) => 'You used ' + e.name + '. ' + changes.map((x) => x.text).join('. ') + '.';

// Requests waiting for the headmaster (one per soul). A decided request stays until the player has seen the answer.
const qStore = () => getStore('gehenna-useq');
async function getQ(st) { const q = await st.get('q', { type: 'json' }); return Array.isArray(q) ? q : []; }
module.exports = { checkUse, applyUse, logRolls, doneMsg, qStore, getQ };
