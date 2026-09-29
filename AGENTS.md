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
4. Run the test suite before committing. All 13 must pass.
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

Zero-dependency Node scripts, no build step:

```bash
node test/snapshot.mjs          # regression baseline (pure-logic modules)
node test/snapshot.mjs --update # accept an intentional behaviour change
node test/evaluate-mood.mjs     # sentiment accuracy report
```

The other `test/*.mjs` files are diagnostics and simulations; run them all
before a commit. They are not in a runner because there is no `package.json`
— that is deliberate, per the project's no-dependency rule.

**The test suite does not cover the browser entry point.** Nothing imports
`main.js`, `ui.js`, `player.js`, `voices.js`, `ambient.js`, `reverb.js`,
`context.js`, `punctuation.js`, `mp3encode.js`, `persona.js` or `dom.js`,
because they need a DOM and an AudioContext. A broken import in any of them
ships green. **Always open the app in a browser after changing one of them.**

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
same performance. `js/utils/rng.js` is the shared seeded stream; if you
add randomness, decide deliberately whether it belongs on that stream
(affects the piece) or on an isolated one (must not), and say so in a
comment.

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
