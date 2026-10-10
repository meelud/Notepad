// js/music/melody-metrics.js on sequences whose statistics are known by construction.
import { melodyStats, intervalsOf } from '../js/music/melody-metrics.js';
let bad = 0;
const ok = (c, m) => { if (!c) { bad++; console.log(' FAIL ', m); } };
const near = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, `${m}: got ${a}, want ${b} ±${tol}`);

ok(JSON.stringify(intervalsOf([60, 62, 59, 59])) === '[2,-3,0]', 'intervalsOf');

// 1. a rising chromatic run: every interval is a step up, inertia total, nothing else
{
  const s = melodyStats([Array.from({ length: 13 }, (_, i) => 60 + i)]);
  near(s.sizes.step, 100, 1e-9, 'rising run: all steps'); near(s.downShare.step, 0, 1e-9, 'rising run: none down');
  near(s.afterStep.same, 100, 1e-9, 'rising run: inertia 100%'); ok(s.afterLeap.n === 0 && Number.isNaN(s.afterLeap.reverse), 'no leaps -> no leap statistics');
  near(s.rangeMean, 12, 1e-9, 'range 12');
}
// 2. an alternating leap: every leap is followed by a reversal
{
  const s = melodyStats([[60, 64, 60, 64, 60, 64]]);
  near(s.sizes.third, 100, 1e-9, 'alternating thirds'); near(s.afterLeap.reverse, 100, 1e-9, 'every leap reverses');
  near(s.downShare.third, 40, 1e-9, '2 of 5 thirds go down');
}
// 3. a pedal tone: all unisons, all drone
{
  const s = melodyStats([[62, 62, 62, 62, 62]]);
  near(s.sizes.unison, 100, 1e-9, 'unisons'); near(s.droneShare, 100, 1e-9, 'all notes in a drone run');
}
// 4. direction asymmetry by size class: large leaps always up, small steps always down
{
  const s = melodyStats([[60, 67, 65, 72, 70, 77, 75]]);          // +7 -2 +7 -2 +7 -2
  near(s.downShare.large, 0, 1e-9, 'large leaps all up'); near(s.downShare.step, 100, 1e-9, 'steps all down');
  near(s.afterLeap.reverse, 100, 1e-9, 'each leap is followed by the step back');
}
// 5. regression to the mean: a leap AWAY from the mean pitch is not "toward"
{
  const s = melodyStats([[66, 60, 66, 72, 66]]);                  // mean 66; leaps 66->60 away, 60->66 toward, 66->72 away, 72->66 toward
  near(s.leapTowardMean, 50, 1e-9, 'half the leaps land nearer the mean');
}
// 6. pattern diversity: a strictly periodic melody repeats its 3-interval patterns, a spread-out one does not
{
  const periodic = Array.from({ length: 20 }, (_, i) => 60 + [0, 2, 4, 2][i % 4]);
  const varied = [60, 62, 65, 61, 66, 64, 69, 63, 70, 67, 72, 62, 71, 66, 74, 65, 73, 68, 76, 64];
  ok(melodyStats([periodic]).patternDiversity < 0.4, `periodic melody has low diversity (${melodyStats([periodic]).patternDiversity})`);
  ok(melodyStats([varied]).patternDiversity > 0.9, `varied melody has high diversity (${melodyStats([varied]).patternDiversity})`);
}
// 7. aggregation weights intervals, not melodies; melodies shorter than 2 notes are ignored
{
  const s = melodyStats([[60, 62], [60], [], [60, 60, 60, 60, 60, 60]]);
  ok(s.melodies === 2 && s.intervals === 6, `2 usable melodies, 6 intervals (got ${s.melodies}, ${s.intervals})`);
  near(s.sizes.step, 100 / 6, 1e-9, 'one step out of six intervals');
}
if (bad) { console.log(`${bad} failure(s)`); process.exit(1); }
console.log('melody-metrics: every statistic matches its constructed answer');
