# AGENTS.md

Working notes for AI agents and for the human maintaining this repo.

## Git workflow — how changes get committed

**Do not let changes sit uncommitted.** The user tells you when they have
made changes in this folder; that is the signal to review and commit them.

1. `git status` and `git diff` first. Always. Before every commit.
2. Group the changes into **thematic commits** — one coherent concern per
   commit, not one commit per session. A commit should be reviewable on its
   own and explain *why* the change was made.
3. Commit message format: **English**, Conventional Commits prefix.
   The body explains the reasoning and any trade-off — not a restatement
   of the diff.
   - `fix:` bug fix · `feat:` new behaviour · `refactor:` restructure with
     no behaviour change · `chore:` housekeeping · `test:` tests
   - Keep the subject line under ~70 characters, imperative mood.
   - End with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
4. Run the test suite before committing. All 17 must pass.
5. **Commit, then ask before pushing.** The user reviews commits before
   they go to GitHub.

### Never do this

- Do not drag-and-drop files into the GitHub web UI. It creates
  `Update foo.js` / `Add files via upload` commits with no useful message
  and immediately makes local and remote diverge. (85 such commits
  accumulated on `main` before 2026-09-30.)
- Do not amend or rebase commits that have already been pushed.
- Do not use `git add -A` blindly. It sweeps in `.DS_Store`, stray images,
  and half-finished work.

## Testing

17 zero-dependency Node scripts, no build step, no `package.json`.
Run them all before a commit.

```bash
node test/snapshot.mjs          # regression baseline (pure-logic modules)
node test/snapshot.mjs --update # accept an intentional behaviour change
node test/evaluate-mood.mjs     # sentiment accuracy report
node test/mode-mapping-test.mjs   # valence x arousal -> mode invariants
node test/arousal-test.mjs        # arousal -> tempo invariants
node test/zwnj-word-test.mjs      # ZWNJ is inside a word, not a word break
node test/arabic-fold-test.mjs    # Arabic yeh/kaf cannot change the music
node test/arousal-lexicon-test.mjs# per-category arousal rule
node test/congruence-eval.mjs     # tuning-set report (in-sample, not a result)
```

**Run the whole suite with one command:**

```bash
node test/run-all.mjs             # one line per test, non-zero exit on any failure
node test/run-all.mjs --verbose   # and the output of whatever failed
node test/run-all.mjs zwnj        # only tests whose name matches
```

`run-all.mjs` passes `--import ./test/harness/register.mjs` to EVERY test.
That is deliberate and safe: verified across the whole suite, the assertion
counts are identical whether or not a test that does not need the flag gets it
(determinism, sync, dynamics and loudness-formula all match), and running one
invocation instead of two removes the chance of running a test in the wrong
mode.

That last point is not hypothetical. `test/sync-test.mjs` was FAILING under the
flag from c470ae5 until 8f1ac0f — 1/12, chordMismatch=13 of 14 bars — while
PASSING 12/12 without it. The cause was in the test: it built its expected
progression with `createChordClock(hashText(text))` and no mode, while
`player.js` passes `pieceMood`, and since c470ae5 the chord-root set depends on
the mode. A hand-written loop that only ran the plain invocation could not see
a failure that only exists in the other one. Do not quote a suite total from
memory or from a loop; quote what run-all.mjs printed.

The `--import` hook registers `harness/trace-loader.mjs`, which wraps
`harmony.js` to record melodic decisions without modifying production code.

`run-all.mjs` exists despite the no-dependency rule because it uses only
`node:child_process` and the standard library. It is not the reason
`package.json` is still absent, and adding one is still not needed.

**The test suite does not cover the browser entry point.** Nothing imports
`main.js`, `ui.js`, `player.js`, `voices.js`, `ambient.js`, `reverb.js`,
`context.js`, `punctuation.js`, `mp3encode.js`, `persona.js` or `dom.js`,
because they need a real DOM and AudioContext. A broken import in any of
them ships green. **Always open the app in a browser after changing one
of them.**

## Architecture

Vanilla ES modules, no bundler, no npm, no backend. A text→music pipeline:

```
editor text
  → music/mood.js         sentiment + tension, bilingual lexicon
  → music/harmony.js      musical key, scale, melodic contour, motif
  → music/rhythm.js       bar/beat clock, word duration, chord progression
  → music/intention.js    clause segmentation, contrast ("but", "ولی")
  → music/composition.js  macro arc across the whole piece
  → player.js             schedules each word against a virtual timeline
  → audio/voices.js       22 synth voices
  → audio/ambient.js      background pads / pulse, shares rhythm.js's clock
  → audio/reverb.js       send-based reverb, mood-driven wetness
```

Determinism is a hard requirement: the same text must always produce the
same performance.

### Randomness: three independent streams

`js/utils/rng.js` exports **three separate seeded streams**, not one
shared stream:

| stream | exports | used by | affects notes? |
|---|---|---|---|
| **melodic** | `rnd`, `pick` | `harmony.js` — note choices, cadence, motif | yes |
| **render** | `rrnd`, `rpick` | `voices.js` timbre, `player.js` volume/pan/timing offsets | no |
| **ambient** | `arnd`, `apick` | `ambient.js` pads, pulse, motif notes | no |

They are separated so that ambient's independent `setTimeout` chain and
per-voice timbre jitter can never shift the melodic stream. Before this
split every draw came from one shared stream, so a change to timbre or a
different timer interleaving changed the melody.

Rules when adding randomness:

- **Decide which stream it belongs to, on purpose, and say which in a
  comment.** A draw that can affect the notes must never be taken from
  inside a timer callback or an audio callback.
- **`rrnd` and `arnd` must never be aliases of `rnd`.** They are separate
  state, each salted differently on seed. If you find yourself wanting to
  write `export const rrnd = rnd` because an import is missing, then
  `rng.js` is incomplete — fix `rng.js`. Do not paper over a missing
  export with an alias; that silently collapses the three streams back
  into one and is exactly the bug this note exists to prevent.

### Timing: musical decisions come from `music/rhythm.js`

Every musical decision must be derived from the virtual timeline in
`music/rhythm.js` — `virtualMs`, the running sum of *planned* durations.
Never derive a decision from `performance.now()`, a wall-clock read, or
ambient's `getBarPhase()`. `performance.now()` is only allowed for
scheduling *when* a sound is heard, never for deciding *what* it is.

This is what makes a piece sound the same on a fast machine and a slow
one, and it is why the words land on the bars the ambient bed is actually
playing.

## Non-negotiable rules

1. **Stay self-contained.** No backend, no API calls, no runtime npm
   dependencies. The only external resource is the Google Fonts `<link>`
   in `index.html`.
2. **Do not change the character of existing synth voices or the UI
   design** unless explicitly asked. New audio/visual work is additive or
   an explicit deliberate change — never incidental.

## Known limitations

See the "Known limitations" section of `README.md`. Be honest about them
rather than hiding them; a limitation that is written down is one nobody
rediscoveres the hard way.

## Measuring the mix (dev only)

Changes to anything audible — voice levels, the ambient bed, reverb, the master
bus — are judged by numbers, not by ear alone. The real `play()` is rendered
offline and measured (peak, true-peak estimate, LUFS, crest, band shares):

```bash
npm install --no-save node-web-audio-api   # once; node_modules/ is gitignored, the app has no dependencies
node tools/mix-report.mjs                  # 8 fixed texts (English + Persian), one table
node tools/mix-report.mjs --compare        # master bus bypassed (A) vs as configured (B)
node tools/render-offline.mjs --text "..." --wav out.wav   # one text, and listen to it
node tools/stem-report.mjs                 # each layer (ambient / voices / punctuation) alone, plus the full mix,
                                           # in LUFS and A-weighted (the ear is ~19 dB less sensitive at 100 Hz)
node tools/measure-wav.mjs piece.wav       # same metrics for ANY wav, e.g. an export from the real browser
```

- `js/audio/mix-metrics.js` is pure and tested (`test/mix-metrics-test.mjs`,
  calibrated against EBU Tech 3341). The offline renderer is not part of the
  test suite because it needs the extra package.
- Re-run the report before AND after a change and quote both tables in the commit
  message. Re-measure and regenerate `VOICE_TRIM_DB` whenever a voice changes.
- The tool emulates `setTargetAtTime` because node-web-audio-api 2.2.0 gets it
  wrong; it self-checks that emulation on every start and refuses to run if off.
- Render at 48 kHz (the default): that is where the offline numbers were checked against a
  real Chrome export (same crest and band shares, ~0.75 dB louder offline). At 44.1 / 96 kHz this
  engine's reverb level drifts by 2-3 dB, so those numbers are not comparable.
- Not covered: browser compressor/resampler differences and real-time jitter. To check the
  offline numbers against a real browser, export a piece from the app, convert it
  (`afconvert -f WAVE -d LEI16 piece.mp3 piece.wav` on macOS) and run measure-wav.mjs on it.
