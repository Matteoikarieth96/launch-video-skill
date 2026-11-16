# video.json: the storyboard

One file describes the whole video. `python3 engine/build.py` checks it and prints every problem with its place
(`scenes[3].camera: ...`). Times are in **beats** (at 105 BPM a beat is 0.571 s, 8 beats = 4.6 s), so every cut and
every title lands on the music. The fictional example in `examples/demo/video.json` uses every scene type.

## Top level

| key | what | default |
|---|---|---|
| `name` | file name of the videos: lowercase, digits, dashes | `launch-video` |
| `language` | language of the words (decimal comma for it, de, fr, es, pt, nl) | `en` |
| `product` | `{ "name", "logo", "logoDark" }`: logos are files in `assets/` | |
| `maker` | `{ "name", "logo", "logoDark" }`: who made it (logo and end scenes) | |
| `site` | `{ "url", "label", "themeAttribute" }`: `url` is `https://...` or `file:<folder>` (a local site inside the video folder); `label` is what the address bar shows; `themeAttribute` (like `data-theme`) is set to `light`/`dark` on `<html>` for sites that do not follow the system setting | |
| `formats` | `["16x9", "9x16"]`, one or both | both |
| `themes` | `["light", "dark"]`, one or both | `["light"]` |
| `colors` | per theme, any of: `bg card surface ink muted soft faint accent accent2 accentBg onAccent phoneBody` as `#rrggbb` | a neutral palette, blue accent |
| `font` | `{ "family": "system" }` or a Google Font: `{ "family": "Inter", "google": true }` | system |
| `music` | `{ "mood": "calm" | "bright" | "minimal" | "none", "bpm": 60-160, "key": "D" }` | calm, 105, D |

## pages: what gets captured

```json
{ "id": "home", "path": "/", "boxes": { "start": "text:a|Get started", "search": "#q" },
  "typing": { "selector": "#q", "text": "parks", "submit": true }, "hide": ["#cookie-banner"], "wait": 1500 }
```
- `path` is added to `site.url`. `mobile: true` captures at 390 px wide (for `phone` scenes); desktop is 1280 px.
  `width`, `dsf` (pixel density, 2 desktop / 3 mobile), `maxHeight` (5000 px), `wait` (ms after load) can be set.
- `boxes`: elements to point at, by CSS selector or `text:TAG|Starts with` (the first TAG whose text starts so).
- `typing`: the field to type into. The capture types it for real (and presses Enter once with `submit`, so the
  result page is captured too); the video then types it letter by letter over the same pixels and cross-fades to
  the result. Only for search or filter fields.
- `hide`: selectors to hide (cookie banners, chat bubbles, "install the app" bars). `css`: extra CSS, no `<`.
- `crop: [left, right]`: show only that horizontal part of the page (in CSS px), e.g. to skip a side menu.
- `image: "assets/shot.png"`: use your own tall screenshot instead of capturing (apps behind a login, native apps).

## scenes

Every scene: `show`, `beats` (2 to 64, default 8) and an optional title: `lead` (small, bold, up to 80 chars),
`big` (the accent words, up to 60 chars, `\n` breaks the line), `sub` (a quiet line, up to 160 chars), `link`
(accent text with an arrow), `alt: true` (CamelCase words in two accent colours), `brand: true` (the product logo
and name above the title). The big word lands one beat in, on a music hit.

| show | extra keys | what it does |
|---|---|---|
| `text` | `big` required | a statement on its own, large |
| `page` | `page`, `camera`, `typing: {at}`, `highlight: {box, at}` | the page in a browser window; the camera moves through `[beat, y, zoom, x]` keys (y in page px from the top; zoom 1 fits the width; x optional, the left edge); `typing.at` is the beat it starts typing; `highlight` rings a box and pulses it like a click |
| `phone` | `page` (a mobile one), `from`, `to` | the mobile page scrolling from `from` to `to` px inside a phone |
| `image` | `src`, `frame: card | none` | your picture with a slow zoom |
| `numbers` | `items: [{value, decimals, prefix, suffix, label}]` (1-6), `image` | counters on cards, one per beat or so; with `image` the picture takes the title's place |
| `cards` | `items: [{icon, title, text}]` (1-4), `note` | feature cards with an icon: chart doc money search map lock bolt check star globe phone code people heart clock leaf |
| `code` | `repo`, `lines` (up to 12 of 60 chars) | a code card: the repository types itself, colours like `#0f7a5c` get a swatch |
| `logo` | `src: maker | product | assets/x.svg`, `caption` | a logo reveal ("presents") |
| `end` | `url`, `repo`, `by`, `logo`, `credit` | the end card; put it last and give it 10 to 12 beats |

## Craft

- **One idea per scene**, said in words: muted autoplay on X and LinkedIn means the titles alone must tell it.
- **Order** that works for launches: the problem (text) > the product (page, `brand`) > it in use (typing or a
  highlight) > on the phone > proof (numbers, cards) > how to get it (code, end). 8 to 12 scenes, 45 to 60 s.
- **Camera**: start still for 3 to 4 beats while the title lands, then move. Scroll 400 to 900 px per scene, never
  more than one screen per 2 beats. Zoom 1.2 to 1.5 for a detail (a search field, a chart); give x so the detail
  is in view. The camera stops at the bottom of the page by itself.
- **Typing** at beat 1.5 or 2, after the title; keep the text short (3 to 15 letters).
- **Numbers** only real ones, with the unit in `prefix`/`suffix` and a 2 to 4 word label.
- **Big words** 1 to 3 words. When one is long (a product name), break it with `\n`.
- **9:16** shows the title on top and the product below; a scene works in both formats with the same words, but
  check the sheets of both: a sub line that fits on 2 lines in 16:9 may need 3 in 9:16 (the engine shrinks it and
  warns if it still does not fit).
- **Length**: build.py prints the total; 30 to 75 s for Reels and Shorts.
