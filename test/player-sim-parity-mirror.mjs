// ─── player-sim mirrors player.js ─────────────────────────────────
// player-sim.mjs is a hand-written reimplementation of player.js's decision
// loop. It has drifted before and drifted silently:
//
//   1. isCadence required trailing punctuation in player.js and was fixed
//      there; the sim had its own copy. Parity fell to 17/106 until the sim
//      was fixed to match.
//   2. player.js wrote `compState ? compState.motifActive : true` and the sim
//      wrote `compState.motifActive` with no guard. With COMPOSITION_LAYER_ENABLED
//      true everywhere, compState is never null in EITHER file, so the two
//      agree — by luck. Turn the flag off and they diverge.
//
// Divergence 2 cannot be reached by adding a text to the parity corpus: there
// is no text that makes compState null, because null-ness comes from a module
// flag, not from the text. So the assertion here is structural — it reads both
// files and checks the two carry the same guards — rather than behavioural.
//
// This is a weaker test than a parity failure and it is worth being honest
// about that. It catches the next divergence only if someone edits these
// expressions and forgets to mirror; it cannot tell you the mirrors are
// SEMANTICALLY equivalent, which is the part that actually went wrong.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let failed = 0;
function check(name, ok, detail = '') {
  console.log(` ${ok ? ' ok  ' : 'FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
  if (!ok) failed++;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const player = fs.readFileSync(path.join(root, 'js/player.js'), 'utf8');
const sim = fs.readFileSync(path.join(root, 'test/player-sim.mjs'), 'utf8');

console.log('\nplayer-sim mirrors player.js\n');

// 1. the flags the sim hard-codes must match player.js's
{
  const FLAGS = ['MUSICAL_INTENTION_ENABLED', 'COMPOSITION_LAYER_ENABLED',
                 'REGISTER_BIAS_ENABLED', 'SEMANTIC_STABILITY_ENABLED'];
  const bad = [];
  for (const f of FLAGS) {
    const pv = (player.match(new RegExp(`const ${f} = (\\w+);`)) || [])[1];
    const sv = (sim.match(new RegExp(`const ${f} = (\\w+);`)) || [])[1];
    if (pv === undefined) bad.push(`${f} missing from player.js`);
    else if (sv === undefined) bad.push(`${f} missing from player-sim.mjs`);
    else if (pv !== sv) bad.push(`${f}: player=${pv} sim=${sv}`);
  }
  check('the feature flags agree, value for value', bad.length === 0, bad.join('; '));
}

// 2. every compState access in the sim must be guarded, as in player.js
{
  const bare = sim.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /compState\./.test(l))
    .filter(([, l]) => !l.includes('compState ?'));
  check('no unguarded compState access remains in the sim',
    bare.length === 0, bare.map(([i, l]) => `L${i}: ${l.trim()}`).join(' | '));
}

// 3. and the guarded forms must be the SAME shapes player.js uses
{
  const SHAPES = [
    [/const compState = .*pieceComposition \? .*getStateAt\(progress\) : null;/, 'compState null-guard'],
    [/const motifAllowed = compState \? compState\.motifActive : true;/, 'motifAllowed guard'],
    [/REGISTER_BIAS_ENABLED/, 'registerBias flag'],
  ];
  const bad = SHAPES.filter(([re]) => !re.test(sim)).map(([, n]) => `sim missing ${n}`);
  for (const [re, n] of SHAPES) if (!re.test(player)) bad.push(`player missing ${n}`);
  check('the sim uses the same guard shapes as player.js', bad.length === 0, bad.join('; '));
}

// 4. the isCadence rule that caused the 17/106 divergence
{
  const lastWordCadence = /isLastWord\s*\|\|\s*\(next && next\.type === 'punct'/;
  check('player.js treats the last word as a cadence', lastWordCadence.test(player));
  check('and so does the sim — the divergence that cost 17/106',
    lastWordCadence.test(sim));
}

// 5. and the chord clock gets the mode in both, or the harmony diverges
{
  // the sim names its mood expression differently from player.js — the sim has
  // it in scope, player.js reads a module-level variable — so match the call
  // shape, not the identifier
  const cc = /createChordClock\(hashText\(text\),\s*[A-Za-z_.]+\)/;
  check('player.js passes the mode to createChordClock', cc.test(player));
  check('and so does the sim', cc.test(sim));
}

// 6. say plainly what this cannot check
console.log('       (structural only — it cannot prove the two loops are semantically');
console.log('        equivalent, which is how the null-guard divergence actually arose);');

if (failed) {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
console.log('\nthe sim mirrors the player structurally, not just by coincidence');