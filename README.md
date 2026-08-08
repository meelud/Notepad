# Notepad

A fully self-contained, client-side web app that turns typed text into
generative ambient music by analyzing emotional content in real time.
Supports bilingual input (Persian/English). Built in vanilla JavaScript
with no build step, no npm dependencies, and no backend.

## Non-negotiable framework rules

These have been reaffirmed repeatedly during development — any future
change must respect them:

1. **Fully self-contained.** No backend, no API calls, no server-side
   accounts, no npm dependencies at runtime. The only permitted
   external resource is the existing Google Fonts CDN `<link>` in
   `index.html`.
2. **Never change the character of existing synth voices or the UI
   design** unless explicitly requested. New audio/visual work must be
   additive, or an explicit, deliberate change — not incidental.

## Architecture

```
index.html            entry point, layout, favicon/font links
css/styles.css         all styling

js/
  main.js              boots the app
  ui.js                DOM event wiring (buttons, keyboard shortcuts)
  dom.js                DOM element references
  player.js             playback loop: tokenizes text, derives harmony,
                         plays each word/punctuation, drives timing,
                         volume, panning, cadence, recording
  persona.js            keyword-triggered toast messages (easter eggs)

  music/
    mood.js              bilingual sentiment analysis (the "brain")
    harmony.js            text → musical key/scale/root derivation
    scales.js             musical mode definitions (16 dark→bright tiers)
    negators.js           negation word lists (EN/FA)
    lexicon-en.js          English emotion lexicon
    lexicon-fa-colloquial.js  Persian colloquial emotion lexicon

  audio/
    context.js           AudioContext singleton, iOS silent-switch unlock
    voices.js             22 synthesizer voice functions
    ambient.js             background pad/chord/pulse clock
    reverb.js               shared convolution reverb (mood-driven wetness)
    punctuation.js         punctuation sound effects

  utils/
    text.js               tokenizer (words/punctuation/space, sentence
                           type, paragraph position)
    rng.js                seeded deterministic RNG (same text → same
                           performance every time)

test/
  snapshot.mjs            zero-dependency regression test runner
  __snapshots__.json      stored baseline (auto-generated)
  eval-dataset.mjs        hand-labeled sentiment evaluation set
  evaluate-mood.mjs       measures detectMood() accuracy against it
```

## How a piece of text becomes music

1. `mood.js` scores the text's sentiment (`normScore`) and tension
   (`tenseScore`) using bilingual lexicon phrase-matching, negation
   handling, intensifiers/diminishers, and contrastive-conjunction
   weighting ("but"/"ولی" — what follows matters more than what
   precedes).
2. `harmony.js` maps that sentiment onto one of 16 dark→bright musical
   modes and picks a root frequency, seeded deterministically from the
   text's hash (same text always produces the same key).
3. `player.js` tokenizes the text and, word by word: picks a pitch
   from the current scale, a voice (biased by sentence type AND mood —
   dark text leans toward airier/deeper voices, bright text toward
   bell-like/playful ones), shapes volume with a per-sentence arc and
   end-of-sentence cadence softening, pans it in stereo, and paces
   timing by word length and the text's overall tension.
4. `ambient.js` runs an independent background clock (pads, bass
   pulse, occasional motif notes) with smooth chord voice-leading.
5. `reverb.js` sets the wet/dry mix once per playback based on the
   text's mood — sadder/darker text gets more spacious reverb, bright
   text stays drier.

## Testing

```bash
node test/snapshot.mjs            # regression check (pure-logic modules)
node test/snapshot.mjs --update   # accept an intentional behavior change
node test/evaluate-mood.mjs       # sentiment-detection accuracy report
```

Snapshot tests cover `mood.js`, `text.js`, `scales.js`, `harmony.js` —
anything requiring a real browser (audio, DOM) can't be tested this
way and must be checked manually. Run snapshot tests after any change
to `detectMood`/`tokenize`/`buildScale`/`deriveTextHarmony`, and update
the baseline only when the behavior change is intentional.

## Known limitations (honest, not hidden)

- **No melodic contour.** Each word's pitch is picked independently at
  random from the current scale — no relationship to the previous
  note. This is the single biggest remaining lever for music quality,
  intentionally not yet implemented (raised and paused twice).
- **Sentiment detection is a heuristic, not a trained model.**
  Word/phrase-weight lexicon + hand-written rules. Measured at ~95%
  within-one-bucket agreement against a small hand-labeled evaluation
  set (see `test/evaluate-mood.mjs`) — good, not perfect. Sarcasm and
  genuinely ambiguous phrases (a word registered under two different
  emotion categories, e.g. "شوکه شدم" meaning either a scary or a
  pleasant shock) are known, inherent failure modes of any
  lexicon-based system.
- **Save button hardcodes a `.webm` filename** regardless of the
  browser's actual `MediaRecorder` output format — can mislabel the
  file on browsers that don't produce webm (e.g. Safari).
- **`voices.js` has real code duplication** (near-identical envelope
  patterns repeated across many of the 22 voices) — left alone
  deliberately, since refactoring risks touching sound character.

## Delivery workflow

Claude (the AI assistant used for development) has no direct push
access to this repo. Fixes are delivered as individual files, copied
in manually. **Always run `git status`/`git diff` before committing —
this exact manual process previously caused a real bug** (`ambient.js`
was accidentally overwritten with `reverb.js`'s content, silently
breaking the entire app's module imports until caught).
