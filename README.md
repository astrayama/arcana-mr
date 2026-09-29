# Arcana MR

A mixed-reality tarot reading for Meta Quest 3, built for the Quest Browser with
WebXR and Meta's [Immersive Web SDK](https://iwsdk.dev).

Put on the headset and a tarot deck appears on your real table. Pick a reading,
shuffle the deck in your hands, draw the cards yourself, turn them over, and
read what each one reflects back to you.

Arcana MR is a tool for self-reflection, not fortune telling. Every card comes
with a short read and a question to sit with. Nothing here predicts the future.

## Progress

Built one checkpoint at a time. Checkpoints marked "headset test" are verified
in the IWSDK emulator first, then on a real Quest 3.

| # | Checkpoint | Status |
| --- | --- | --- |
| 0 | Recon and defaults confirmed | Done |
| 1 | Scaffold (IWSDK, TypeScript, mixed reality) | Built, awaiting headset test |
| 2 | Architecture skeleton (config, reading state machine, deck and theme loaders) | Done |
| 3 | Card data (78 cards, upright and reversed, with validator) | In progress: voice review of 5 samples |
| 4 | Art pack (public-domain 1909 Rider-Waite-Smith) | Done |
| 5 | Table placement | Built, awaiting headset test |
| 6 | Menu, shuffle, deal | Done |
| 7 | Flipping with hands and controllers | Built, awaiting headset test |
| 8 | Meaning panels | In progress: two layouts proposed, awaiting a pick |
| 9 | Dark and gold theme | Built, awaiting headset sign-off |
| 10 | QA and performance | In progress: emulator checks pass, headset frame-rate check pending |
| 11 | Deploy | Not started |

## Run it

Requires Node 20.19 or newer.

```sh
npm install
npm run dev
```

`npm run dev` starts a local HTTPS server on port 8081 and opens a managed
browser with IWER, the IWSDK desktop XR emulator, in a synthetic living room
that has tables. Click **Begin** (or **Enter XR**) to start the mixed-reality
session on your desktop.

### On a Quest headset

1. Put the headset and your computer on the same Wi-Fi network.
2. Run `npx @iwsdk/cli dev status` and copy the `network` URL
   (for example `https://192.168.1.20:8081/`).
3. Open that URL in the Quest Browser and accept the certificate warning. The
   dev server uses a self-signed local certificate.
4. Tap **Begin**, then allow the spatial data prompt so Arcana can find your
   table. For the best fit, run Space Setup in the headset settings first.

### Testing switches

Add these to the page URL while testing:

| Parameter | What it does |
| --- | --- |
| `?deck=rws-1909` | Use a specific deck folder. Unknown names fall back to the default with a console warning. |
| `?theme=dark-gold` | Use a specific theme folder, with the same fallback. |
| `?placement=fallback` | Skip table detection and use the floating fallback mat. Denying the spatial data prompt does the same on the headset. |
| `?view=cloud-sea` or `?view=night-sanctum` | Start in one of the theme's VR surroundings instead of passthrough. `?view=vr` picks the theme's first one. |
| `?layout=focus` or `?layout=triptych` | Meaning panel layout for the 3-card spread (under review). |
| `?draw=cups-queen:R,major-17-the-star` | Dev server only: deal these cards (`:R` = reversed). Ignored in production builds. |

## How a reading works

The whole flow is one state machine, `src/state/readingMachine.ts`, kept
separate from rendering:

`PLACING` → `IDLE` → `READY` → `SHUFFLING` → `DRAWING` → `AWAITING_FLIPS` → `REVEALED` → `IDLE`

1. **Placing.** Arcana looks for your table: a Space Setup table first, then
   the nearest flat surface at table height that fits the mat, then a floating
   mat in front of you. Reach out and grab the mat to move it, point at it and
   hold the trigger (or pinch) to slide it, or use the panel's arrows. It
   settles onto the table when you let go. Confirming anchors the mat to the
   room.
2. **Choosing.** The menu on the mat offers a Single Card pull or a 3-Card
   Spread (Past, Present, Future). Faint outlines on the mat mark each spot.
   You can also move the mat from here, and choose what surrounds you: your
   own room through passthrough, or one of the theme's VR surroundings.
3. **Shuffling.** Tap the deck, or lift it and give it a shake: the riffle
   happens right there in your hand. Shuffling is required before the first
   card. The deck order comes from a Fisher-Yates shuffle driven by
   `crypto.getRandomValues`, and each card can land reversed (50% by default,
   set in `src/config.ts`). A reading never repeats a card.
4. **Drawing.** Cards come off the top of the deck in order: Past, then
   Present, then Future. The spot waiting for the next card glows softly.
   Pinch the top card to take it into your fingers, or tap the deck to send it
   straight to its spot face down. Between draws you can lift the deck and
   shake it again to shuffle whatever is left; cards already drawn stay put.
5. **Turning cards over.** Turn your hand over while holding a card and the
   card turns with it. Let go and it glides to its spot, face up or face down
   the way you left it. You can also tap a card to turn it face up. Cards can
   be turned in any order, and turned back down again; a face-down card hides
   its meaning until it is turned up.
6. **Reflecting.** Each face-up card shows its position, whether it is upright
   or reversed, three keywords, a short read, and a question to reflect on.
7. **New reading** sweeps the cards back into the deck and frees their memory.

### Hands and controllers

| | Hands | Controllers |
| --- | --- | --- |
| Take a card (from the deck or the spread) | Pinch | Trigger, up close |
| Lift the deck | Close your hand around it | Grip button |
| Tap from a distance | Point and pinch | Point and pull the trigger |

A held card or deck follows your hand completely, tilt and all. A quick pinch
or grip that barely moves counts as a tap. Up close, a hand's pointing ray
switches off, so reaching for the table never also clicks something behind
it; it comes back when your hand moves away. How tightly the hand has to close
to count as a fist is set in `config.grab` (dev builds log each hand's finger
curl to the dev server so it can be tuned in the headset).

## Project structure

```
src/
  index.ts                 entry: World.create + system registration
  config.ts                tunable defaults (reversal chance, sizes, layout, UI scale)
  app/context.ts           loads cards, picks deck + theme, owns the state machine
  state/readingMachine.ts  the reading flow
  lib/shuffle.ts           crypto-backed shuffle and draw
  placement/tableMath.ts   table finding and mat placement math
  systems/                 ECS systems: placement, reading flow, flipping, meanings, ambience
  components/              ECS components
  ui/                      UIKitML panel templates, filled from the active theme
  visuals/                 mat, card, and deck meshes
  interaction/             hand gestures (pinch, fist) and "what is this hand about to touch"
  environments/            VR surroundings generators (night-sky sanctum, cloud sea)
  data/cards.json          78 cards: keywords, reads, and reflection prompts
  data/cards.schema.ts     card types and validation rules
  decks/<id>/              art packs (deck.json + images)
  themes/<id>/             themes (theme.json + assets)
scripts/                   validators and asset builders
tests/                     unit tests (npm test)
public/input-profiles/     local copies of the controller and hand models
```

## Add a deck

A deck is a folder in `src/decks/`. Adding one needs no code changes.

1. Create `src/decks/<your-deck-id>/`.
2. Add a card back and one image per card. Use the same pixel size for every
   image (about 600 × 1030 px works well), in WebP, PNG, or JPEG.
3. Add `deck.json`:

   ```json
   {
     "id": "<your-deck-id>",
     "name": "Your Deck Name",
     "license": "All rights reserved",
     "source": "Original art",
     "aspectRatio": 0.58,
     "back": "back.webp",
     "faces": {
       "major-00-the-fool": "faces/major-00-the-fool.webp",
       "cups-queen": "faces/cups-queen.webp"
     }
   }
   ```

   `aspectRatio` is image width divided by height. Face keys are the card ids
   in `src/data/cards.json`. A deck can be a work in progress: the app only
   deals cards the active deck has faces for.
4. Run `npm run validate:decks`, then try it with `?deck=<your-deck-id>`.
5. To make it the default, change `defaults.deck` in `src/config.ts`.

Anything committed to this repository is public, so keep unreleased art out of
git until you are ready to share it.

## Add a theme

A theme is a folder in `src/themes/`. Adding one needs no code changes.

1. Copy `src/themes/dark-gold/` to `src/themes/<your-theme-id>/` and set `"id"`
   in `theme.json` to the folder name.
2. Edit `theme.json`:
   - `colors`: panel background, border, text, muted text, accent, text on
     accent, highlight, and the upright and reversed badge colors (`#rrggbb`)
   - `fonts`: a heading and a body font. Use a bundled family (for example
     `playfair-display`, `crimson-text`, `libre-baskerville`, `merriweather`,
     `inter`, `lato`) or ship TTFs in the folder under `"files"`.
   - `mat`: cloth color, trim color, an optional tiling texture, and the gold
     inlay line
   - `cardHighlight`: hover glow color, strength, and lift
   - `ambient`: candles and floating motes, or `null` to turn either off
   - `environments`: up to three VR surroundings offered instead of
     passthrough (`[]` for passthrough only). Each has an `id`, a menu
     `label`, fog, and a `kind` that picks a generator in `src/environments/`:
     `night-sanctum` (sky, stars, moon, floor and stone textures, fireflies)
     or `cloud-sea` (sunset sky, sun, cloud colors and drift speed, terrace
     stone and railing, birds).
   - `lighting`: the soft light gradient on the cards and cloth
3. Run `npm run validate:themes`, then try it with `?theme=<your-theme-id>`.

Panels are UIKitML templates in `src/ui/` with `{{colors.accent}}`-style
tokens, so every panel picks up a new theme automatically. A future in-headset
theme picker only needs to re-render the panels with another theme.

## Card data

All 78 cards live in `src/data/cards.json`, with upright and reversed
keywords, reads, and reflection prompts. `npm run validate` checks:

- 78 cards: 22 majors and 14 of each suit, with unique, predictable ids
- every field present, exactly 3 keywords per orientation
- reads of 2 to 3 sentences, prompts that are single questions
- different upright and reversed prompts
- no em-dashes, no predictive phrasing ("you will"), no "journey" or "delve"
- a face image in the default deck for every card

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with the IWER emulator |
| `npm run build` | Production build into `dist/` |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests: shuffle fairness, state machine, placement math, shake detection, fist detection, spread layout, URL overrides |
| `npm run validate` | Card, deck, and theme validation |
| `npm run deck:rws-1909` | Rebuild the public-domain deck from Wikimedia Commons |
| `npm run theme:dark-gold` | Regenerate the dark-gold cloth texture |
| `npm run theme:sanctum` | Re-download the sanctum's CC0 stone textures from Poly Haven |

## Deploy

The app is a static site. On Vercel, import the repository (framework preset:
Vite), keep the build command `npm run build` and output directory `dist`.
Every push to `main` then deploys. WebXR needs HTTPS, which Vercel provides.

## Privacy

Arcana MR collects nothing. It has no accounts, analytics, cookies, or
tracking, and it loads only its own files; controller and hand models are
served from this site rather than a public CDN.

Two things stay on the headset:

- **Spatial data.** With your permission, the Quest Browser shares detected
  planes and furniture so the mat can find your table. This is used in the
  moment and never stored or sent anywhere.
- **One anchor ID.** IWSDK keeps the mat steady with a spatial anchor and saves
  its ID in the browser's local storage so it can be reused next time.

## License

The code is MIT licensed. The card meanings and reflection prompts, and any
original deck art, are not. See [LICENSE](LICENSE) for the details, and
[CREDITS.md](CREDITS.md) for the sources and licenses of the art, fonts, and
models.
