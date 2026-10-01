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

**Exactly two tests need the loader flag:**

```bash
node --import ./test/harness/register.mjs test/player-parity.mjs         # 106/106
node --import ./test/harness/register.mjs test/timeline-formula-test.mjs
```

Everything else in `test/*.mjs` runs as plain `node test/<name>.mjs`.

The `--import` hook registers `harness/trace-loader.mjs`, which wraps
`harmony.js` to record melodic decisions without modifying production
code. Only the two tests that read `globalThis.__TRACE__` need it.

Verified by running the whole suite both ways: these two are the only
tests whose result differs, and both FAIL without the flag rather than
passing quietly. `determinism-test`, `sync-test`, `dynamics-test` and
`loudness-formula-test` also run the real `play()`, but they install the
harness themselves — `loudness-formula-test` calls `installFakeClock()` and
`installStubs()` directly instead of going through `run-play.mjs`, and
`determinism-test`/`sync-test`/`dynamics-test` do the same — so the flag is
redundant for them, not required. Passing them the flag changes nothing
(assertion counts identical both ways).

The trap worth knowing: `loudness-formula-test` cannot pass vacuously. Its
first assertion is `gains.length === toks.length`, so a `play()` that
sounded nothing fails immediately rather than skipping the comparisons.
The same is true of `timeline-formula-test` — but only with the flag,
without it the trace is empty and the test reports `play=0 formula=12`.

There is no aggregate runner because a `package.json` would violate the
no-dependency rule; loop over `test/*.mjs` and pass `--import` for the two
above.

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
