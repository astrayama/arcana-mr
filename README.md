# Carta Luna

A mixed-reality tarot reading for Meta Quest 3, built for the Quest Browser with
WebXR and Meta's [Immersive Web SDK](https://iwsdk.dev).

**Try it:** open <https://cartaluna-mr.vercel.app> in the Quest Browser.

Put on the headset and a tarot deck appears on your real table. Pick a spread
(or build your own, up to 12 cards), shuffle the deck in your hands, draw the
cards yourself, turn them over, and read what each one reflects back to you.

Carta Luna is a tool for self-reflection, not fortune telling. Every card comes
with a short read and a question to sit with. Nothing here predicts the future.

## Progress

Built one checkpoint at a time. Checkpoints marked "headset test" are verified
in the IWSDK emulator first, then on a real Quest 3.

| # | Checkpoint | Status |
| --- | --- | --- |
| 0 | Recon and defaults confirmed | Done |
| 1 | Scaffold (IWSDK, TypeScript, mixed reality) | Built, awaiting headset test |
| 2 | Architecture skeleton (config, reading state machine, deck and theme loaders) | Done |
| 3 | Card data (78 cards, upright and reversed, with validator) | Done: all 78 written |
| 4 | Art pack (public-domain 1909 Rider-Waite-Smith) | Done |
| 5 | Table placement | Built, awaiting headset test |
| 6 | Menu, spreads, shuffle, draw | Done: seven spreads plus your own, welcoming main menu, settings, credits |
| 7 | Flipping with hands and controllers | Built, awaiting headset test |
| 8 | Meaning panels | Done: focus layout (labels by each card, one full panel), since it holds up to 12 cards |
| 9 | Dark and gold theme, card backs | Built, awaiting headset sign-off |
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
4. Tap **Begin**, then allow the spatial data prompt so Carta Luna can find your
   table. For the best fit, run Space Setup in the headset settings first.

### Testing switches

Add these to the page URL while testing:

| Parameter | What it does |
| --- | --- |
| `?deck=rws-1909` | Use a specific deck folder. Unknown names fall back to the default with a console warning. |
| `?theme=dark-gold` | Use a specific theme folder, with the same fallback. |
| `?placement=fallback` | Skip table detection and use the floating fallback mat. Denying the spatial data prompt does the same on the headset. |
| `?view=fairy-circle`, `?view=cloud-sea`, `?view=night-sanctum`, or `?view=room` | Start in one of the VR surroundings, or in your own room through passthrough. `?view=vr` picks the first VR one. These don't change your saved choice. |
| `?draw=cups-queen:R,major-17-the-star` | Dev server only: deal these cards (`:R` = reversed). Ignored in production builds. |

## How a reading works

The whole flow is one state machine, `src/state/readingMachine.ts`, kept
separate from rendering:

`PLACING` → `IDLE` → `READY` → `SHUFFLING` → `DRAWING` → `AWAITING_FLIPS` → `REVEALED` → `IDLE`

1. **Placing.** Carta Luna looks for your table: a Space Setup table first, then
   the nearest flat surface at table height that fits the mat, then a floating
   mat in front of you. Reach out and grab the mat to move it, point at it and
   hold the trigger (or pinch) to slide it, or use the panel's arrows. It
   settles onto the table when you let go. Confirming anchors the mat to the
   room.
2. **Choosing.** The main menu stands beyond the mat: **Begin a reading**,
   **Make your own**, **Settings**, **How it works**, **Move the mat**, and
   **Credits**. The first time, a gentle "New here?" points to How it works.
   Pick a spread and the mat grows to fit it (away from you and to the sides,
   up to about 80 x 70 cm; past that, cards shrink a little, never below real
   card size). Faint outlines mark each spot, with its name set into the
   cloth.
3. **Shuffling.** Tap the deck, or lift it and give it a shake: the riffle
   happens right there in your hand. Shuffling is required before the first
   card. The deck order comes from a Fisher-Yates shuffle driven by
   `crypto.getRandomValues`, and each card can land reversed (50% by default,
   set in `src/config.ts`). A reading never repeats a card.
4. **Drawing.** Cards come off the top of the deck in order, spot by spot.
   The spot waiting for the next card glows softly.
   Pinch the top card to take it into your fingers, or tap the deck to send it
   straight to its spot face down. Between draws you can lift the deck and
   shake it again to shuffle whatever is left; cards already drawn stay put.
5. **Turning cards over.** Turn your hand over while holding a card and the
   card turns with it. Let go and it glides to its spot, face up or face down
   the way you left it. You can also tap a card to turn it face up. Cards can
   be turned in any order, and turned back down again; a face-down card hides
   its meaning until it is turned up.
6. **Reflecting.** Each face-up card gets a small label in front of it
   (position and name). The meaning panel beyond the mat shows what the
   position asks, whether the card is upright or reversed, three keywords, a
   short read, and a question to reflect on. Previous and Next step through
   the face-up cards.
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

### Spreads

| Spread | Cards |
| --- | --- |
| Single Card | 1 |
| Past, Present, Future | 3 |
| Mind, Body, Spirit | 3 |
| Crossroads | 5 |
| Horseshoe | 7 |
| Celtic Cross | 10, with the crossing card laid sideways |
| Twelve Houses | 12, around the deck |

**Make your own** builds a spread in the headset without typing: choose how
many cards (1 to 12) and a shape (row, rows, arc, ring, cross), then tap each
spot and pick its name from 48 reflective names in four groups. The mat shows
the spread as you build it. Up to 8 spreads are saved on the headset, under
**Yours** in the spread picker.

### Settings

- **Cards:** the card back (the deck's own 1909 roses and lilies, or one of
  six original designs: Celestial, Botanical, Sacred geometry, Minimal, Neon
  circuit, Winter) and the deck. Every back is the same turned upside down,
  so a reversed card can't be spotted from its back.
- **Around you:** VR surroundings (the night sky sanctum, until you choose
  otherwise; a sunset cloud sea; or a fairy circle in a forest) or your own
  room through passthrough.
- **Your data:** what's kept on the headset, and a button to clear it.

Adding your own decks, backs, and surroundings from the headset comes in a
later update; the formats are ready in [docs/formats.md](docs/formats.md).

### Reading together

Two people, each in their own Quest, anywhere, can share one reading. Each
sets the mat on their own table; the cards, and the deck or a card while
someone holds it, move on both.

1. The reader opens **Read together > Open a room** and picks how to read:
   - **I'll read, you watch:** the reader does everything, the guest watches.
   - **You shuffle, I'll lay out:** the guest lifts the deck and shakes it to
     shuffle; the reader draws and turns the cards.
2. The reader tells the guest the six-digit code.
3. The guest opens **Read together > Join a reading** and taps it in.

Either can join or rejoin at any point and catches up straight away. If the
guest leaves, the reading on their table stays and becomes theirs. Reading
together needs the relay address set at build time (`VITE_RELAY_URL`); without
it the button is hidden. How it's kept private is under [Privacy](#privacy).

## Project structure

```
src/
  index.ts                 entry: World.create + system registration
  config.ts                tunable defaults (reversal chance, sizes, layout, UI scale)
  app/context.ts           loads cards, picks deck + theme, owns the state machine and settings
  state/readingMachine.ts  the reading flow
  spreads/                 built-in spreads (one JSON file each), shapes and builder model
  settings/, storage/      settings kept on the headset, and the store for packs you add later
  lib/shuffle.ts           crypto-backed shuffle and draw
  placement/tableMath.ts   table finding and mat placement math
  systems/                 ECS systems: placement, reading flow, flipping, meanings, ambience
  components/              ECS components
  ui/                      UIKitML panel templates, filled from the active theme
  visuals/                 mat, card, and deck meshes; spreadLayout.ts fits a spread to the mat
  interaction/             hand gestures (pinch, fist) and "what is this hand about to touch"
  environments/            VR surroundings: generators, plus one folder per environment
  backs/<id>/              card back designs (back.json + back.webp)
  data/cards.json          78 cards: keywords, reads, and reflection prompts
  data/cards.schema.ts     card types and validation rules
  decks/<id>/              art packs (deck.json + images)
  themes/<id>/             themes (theme.json + assets)
scripts/                   validators and asset builders
docs/formats.md            deck, back, surroundings, and spread formats
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
   - `lighting`: the soft light gradient on the cards and cloth
3. Run `npm run validate:themes`, then try it with `?theme=<your-theme-id>`.

Panels are UIKitML templates in `src/ui/` with `{{colors.accent}}`-style
tokens, so every panel picks up a new theme automatically. A future in-headset
theme picker only needs to re-render the panels with another theme.

## Add a spread

A spread is one JSON file in `src/spreads/`: a name, a one-line summary, and
up to 12 positions, each with a label, what it asks, and where it goes in
card cells. See [docs/formats.md](docs/formats.md#spread). Run
`npm run validate:spreads` to check it fits the table without overlaps.

## Add a card back

A card back is a folder in `src/backs/` with `back.json` and `back.webp`. The
six original backs are drawn by `npm run backs` (`scripts/make-backs.ts`),
which draws half of each design and turns a copy upside down, so every back
is symmetric. `npm run validate:backs` checks that.

## Add surroundings

Each VR environment is a folder in `src/environments/` with an
`environment.json` and its textures. `kind` picks a generator:
`night-sanctum` (sky, stars, moon, floor and stone textures, fireflies) or
`cloud-sea` (sunset sky, sun, cloud colors and drift speed, terrace stone and
railing, birds). Textures shared between environments live in
`src/environments/shared/`. Run `npm run validate:environments`.

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
| `npm test` | Unit tests: shuffle fairness, state machine, placement math, shake and fist detection, spread layout and shapes, the builder, settings, registries, packs from the headset, URL overrides |
| `npm run validate` | Card, deck, theme, surroundings, card back, and spread validation |
| `npm run backs` | Redraw the six original card backs |
| `npm run deck:rws-1909` | Rebuild the public-domain deck from Wikimedia Commons |
| `npm run theme:dark-gold` | Regenerate the dark-gold cloth texture |
| `npm run theme:sanctum` | Re-download the sanctum's CC0 stone textures from Poly Haven |

## Deploy

Two parts: the relay for reading together (Cloudflare), then the site
(Vercel). The site works without the relay; it just hides Read together.

### 1. The relay (Cloudflare Workers, free plan)

1. In the Cloudflare dashboard, under **Workers & Pages**, choose your
   `workers.dev` subdomain. It appears in the relay's public address, so pick
   something that isn't your name.
2. Sign in from this folder (opens the browser):
   ```bash
   cd relay && npm install && npx wrangler login
   ```
3. Check `ALLOWED_ORIGINS` in [`relay/wrangler.toml`](relay/wrangler.toml)
   lists the site's address, then deploy:
   ```bash
   npm run deploy
   ```
   The relay is then at `wss://arcana-relay.<subdomain>.workers.dev`.

To try it locally instead, run `npm run dev` in `relay/` and put
`VITE_RELAY_URL=ws://localhost:8787` in `.env.local` (never committed). A
headset on the Wi-Fi can't reach that `ws://` address from the https page, so
for headset tests use the deployed relay.

### 2. The site (Vercel)

The app is a static site. [`vercel.json`](vercel.json) installs with
`npm ci --ignore-scripts` (some development tools download binaries the site
doesn't need), builds with `npm run build`, and serves `dist`.

1. Set the relay address for production builds:
   ```bash
   npx vercel env add VITE_RELAY_URL production
   ```
   and enter `wss://arcana-relay.<subdomain>.workers.dev`.
2. Deploy:
   ```bash
   npx vercel deploy --prod
   ```
3. Open the address on a Quest. WebXR needs HTTPS, which Vercel provides.
   Under the project's **Settings > Deployment Protection**, the production
   address should be public, or a guest's headset will hit a sign-in page.

Or import the repository in the Vercel dashboard and set the same variable;
every push to `main` then deploys.

## Privacy

Carta Luna collects nothing. It has no accounts, analytics, cookies, or
tracking, and it loads only its own files; controller and hand models are
served from this site rather than a public CDN. The only time it talks to
anything else is when you choose to read together (below).

A few things stay on the headset, and only there:

- **Spatial data.** With your permission, the Quest Browser shares detected
  planes and furniture so the mat can find your table. This is used in the
  moment and never stored or sent anywhere.
- **One anchor ID.** IWSDK keeps the mat steady with a spatial anchor and saves
  its ID in the browser's local storage (`iwsdk_scene_anchor_uuid`) so it can
  be reused next time.
- **Your settings** (`arcana.settings.v1`): deck, card back, surroundings, and
  whether you've seen How it works.
- **Spreads you make** (`arcana.spreads.v1`): their shapes and position names.

Readings themselves are never saved. **Settings > Your data > Clear saved
data** removes the settings and your spreads.

### Reading together

When two people read together, their headsets exchange messages through a
small relay (a Cloudflare Worker in [`relay/`](relay/)). The relay passes
messages from one headset to the other and stores nothing: no logs of what
was sent, no database.

- **The room code never leaves the headset.** Each headset turns the six-digit
  code into an encryption key and a separate room ID (PBKDF2, SHA-256). Only
  the room ID is sent to the relay.
- **Messages are encrypted** with AES-GCM before they leave the headset. They
  carry the reading (spread, cards, which are face up) and where a held card
  or the deck is on the mat, which follows the hand holding it. Nothing else
  about your room, your voice, or your hands is sent.
- **What the relay can see:** the derived room ID, the two headsets' IP
  addresses, when messages are sent and how big they are, and the encrypted
  bytes.
- **The limit of a six-digit code.** A code has a million possibilities, so the
  encryption keeps readings out of the relay's sight, but someone who
  recorded the encrypted traffic could try every code offline and read it.
  Treat a shared reading like a phone call, not a vault. A room exists only
  while the host has it open, and a room takes only one guest.

## License

The code is MIT licensed. The card meanings and reflection prompts, and any
original deck art, are not. See [LICENSE](LICENSE) for the details, and
[CREDITS.md](CREDITS.md) for the sources and licenses of the art, fonts, and
models.
