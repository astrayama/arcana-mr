# Arcana pack formats

Arcana's decks, card backs, surroundings, and spreads are all plain folders
of files. The built-in ones live in `src/`; ones you add yourself will be
kept on your headset only (in the browser's IndexedDB), never uploaded
anywhere. Adding your own from inside the headset comes in a later update;
this is the format it will use, and it's the same one the built-in folders
use today.

Every pack you add gets an id starting with `device:` (for example
`device:my-deck`), so it can never replace a built-in one. Packs are checked
with the same validators as the built-ins before they appear in Settings.

## Deck

```
my-deck/
  deck.json
  back.webp
  faces/major-00-the-fool.webp
  faces/major-01-the-magician.webp
  ...
```

`deck.json`:

```json
{
  "id": "my-deck",
  "name": "My Deck",
  "license": "Who may use these images, and how",
  "source": "Who drew them, or where they came from",
  "aspectRatio": 0.58,
  "back": "back.webp",
  "faces": { "major-00-the-fool": "faces/major-00-the-fool.webp" }
}
```

- `aspectRatio` is width / height of the card images (0.3 to 1).
- All images should be the same size, about 600 px wide, as WebP, PNG, or JPEG.
- Card ids are listed in `src/data/cards.json`. A deck can be unfinished:
  only cards with a face are drawn.

## Card back

```
my-back/
  back.json
  back.webp
```

```json
{
  "id": "my-back",
  "name": "My back",
  "description": "One line shown in Settings",
  "license": "Who may use this image, and how",
  "source": "Who made it",
  "aspectRatio": 0.58
}
```

The image is cropped to fill each deck's card shape. Keep the design the
same when turned upside down, so a reversed card can't be spotted from its
back (`npm run validate:backs` checks this for built-in backs).

## Surroundings

```
my-place/
  environment.json
  assets/...
```

`environment.json` picks a generator with `kind` and tunes it. The kinds
available now are `night-sanctum` (a stone platform under a starry sky) and
`cloud-sea` (a terrace above clouds at sunset); see
`src/environments/night-sanctum/environment.json` and
`src/environments/cloud-sea/environment.json` for every setting.

```json
{
  "id": "my-place",
  "label": "Label in Settings",
  "kind": "night-sanctum",
  "order": 3,
  "fog": { "color": "#0b0a16", "density": 0.1 }
}
```

Texture paths are relative to the folder. Built-in surroundings may share
textures from `src/environments/shared/`; packs you add keep their files
inside the pack.

Planned: a `panorama` kind for a 360-degree image (equirectangular, 2:1),
so a photo or painting can surround the reading.

## Spread

Built-in spreads are single JSON files in `src/spreads/`:

```json
{
  "id": "my-spread",
  "name": "My Spread",
  "summary": "One line for the spread picker.",
  "order": 8,
  "positions": [
    { "label": "Past", "meaning": "What has shaped this moment.", "x": -1, "y": 0 },
    { "label": "Present", "meaning": "Where you stand right now.", "x": 0, "y": 0 },
    { "label": "Challenge", "meaning": "What crosses you.", "x": 0, "y": 0, "rotationDeg": 90, "over": 1 }
  ],
  "deck": { "x": -2, "y": 0 }
}
```

- Up to 12 positions. Labels are 18 characters or fewer.
- `x` and `y` are in card cells: `x` to the reader's right, `y` away from
  the reader, as in a diagram. One cell holds a card, its label, and a gap.
- `rotationDeg: 90` lays a card sideways; `over` stacks it on an earlier
  position (the Celtic Cross crossing card).
- `labelSide` (`near`, `far`, `left`, `right`) moves a position's label.
- `deck` places the deck; by default it sits beyond the farthest cards.
- `npm run validate:spreads` checks the file and that the spread fits the
  table without overlaps.

Spreads you build in the headset are saved on the headset as their shape
and position names, and laid out the same way.
