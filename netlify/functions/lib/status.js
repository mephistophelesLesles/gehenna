// Fixed effects (poison, stun, corruption...): a library the headmaster keeps. Applying one puts a tagged record on the soul,
// so an item that cures it (or any debuff) can find and remove it by itself.
const crypto = require('crypto');
const { S } = require('./auth');
const { cleanFx } = require('./fx');

const PRESETS = [
  ['Poison', 'debuff', 'Poisoned: the soul is losing strength.', []],
  ['Stun', 'debuff', 'Stunned: cannot act normally.', []],
  ['Corruption', 'debuff', 'Corrupted: tainted by something dark.', []],
  ['Burn', 'debuff', 'Burning.', []],
  ['Bleed', 'debuff', 'Bleeding.', []],
  ['Stat Debuff', 'debuff', 'Weakened.', [{ kind: 'debuff', stat: 'STR', amt: 2, perm: false, note: '' }]],
];
const seed = () => PRESETS.map((p) => ({ id: crypto.randomUUID(), name: p[0], kind: p[1], desc: p[2], fx: p[3] }));
function cleanStatuses(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).slice(0, 60).map((x) => {
    x = x || {};
    const id = /^[0-9a-f-]{36}$/i.test(String(x.id || '')) ? String(x.id) : crypto.randomUUID();
    return { id, name: S(x.name, 60).trim(), kind: x.kind === 'buff' ? 'buff' : 'debuff', desc: S(x.desc, 200).trim(), fx: cleanFx(x.fx) };
  }).filter((x) => x.name && !seen.has(x.id) && seen.add(x.id));
}
async function loadStatuses(store) {
  let l = await store.get('list', { type: 'json' });
  if (!Array.isArray(l)) { l = seed(); await store.setJSON('list', l); }
  return l;
}
module.exports = { loadStatuses, cleanStatuses };
