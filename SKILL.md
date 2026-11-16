---
name: launch-video
description: Make a launch video for an app, a website or any product, in 16:9 (YouTube, X, LinkedIn) and 9:16 (Reels, TikTok, Shorts), light and dark, rendered locally to a master-quality MP4. It always starts with an interview (product, link, goal, platforms, length, language, what to show, music, credits), reads the real site, writes a storyboard for approval, captures the site like a screen recording (pan, zoom, typing into its search, a phone scroll), adds titles, counters, feature cards, a code card and an end card, synthesises music in time with the cuts, shows contact sheets, and renders. Use it whenever someone wants a launch, promo, teaser or demo video of their app, site or open source project, or says "fammi il video di lancio", "video promo del sito", "versione verticale per Instagram", "make a launch video", even without saying "skill". Not for editing camera footage, talking heads, cartoons, whiteboard explainers or AI-generated video.
---

# Launch video

Turns a product (usually a website or web app) into a short, clean launch video: big titles that land on the beat,
the real site panning and zooming inside a browser window, a search being typed, the mobile site scrolling in a
phone, numbers counting up, feature cards, an optional "open source" code card and an end card with the address.
One storyboard (`video.json`) renders both 16:9 and 9:16, light and dark. Everything runs locally: headless Chrome
draws every frame, ffmpeg encodes, the music is synthesised with numpy (no samples, no stock audio, no AI video).

## The rule: questions first, then the video

Never start building before the interview. Even when the request looks complete ("make a launch video for
example.com"), ask first: a launch video lives or dies on the message, and only the owner knows it. Ask in the
user's language, with the question tool when there is one (AskUserQuestion: up to 4 questions per round, each with
2 to 4 options plus a free answer), in two rounds at most. The full question list, the defaults and what each
answer changes are in `references/interview.md`. Read it now.

Then, in order:

## 1. Check the machine (once)

```bash
python3 <skill>/scripts/doctor.py
```
Needs Node 22+, Python 3.9+ with numpy, ffmpeg with libx264, and Chrome or Chromium. Fix anything MISSING with the
hint it prints (ask before installing anything).

## 2. Interview (round 1 and, if needed, round 2)

From `references/interview.md`. Minimum before going on: the product and its link, what the video must make people
do or feel, where it will be posted (decides the formats), length, language, light/dark, what to show, and who
signs it. Anything left open gets the default from that file, and you say which defaults you picked.

## 3. Read the real product (read-only)

Open the site (the built-in browser or a page fetch) and note: the pages worth showing, the search field or main
input and its CSS selector, buttons worth highlighting, whether it follows the system dark mode or uses an
attribute like `data-theme`, cookie banners or chat bubbles to hide, the mobile layout, real numbers on the page,
the repository if it is open source, the logo files. Never sign up, log in, submit a form or click anything with
an effect while exploring. Numbers in the video come only from the site or from the user: never invent one, and
ask when a number is not on the page.

## 4. Storyboard for approval

Make the video folder (ask where if the user did not say; default: a `launch-video/<name>` folder in the current
project, never inside the skill folder):

```bash
python3 <skill>/scripts/new_video.py <folder>             # from the template
python3 <skill>/scripts/new_video.py <folder> --example   # the fictional demo, to see how it all fits
```
Put the logos in `<folder>/assets/` (copy them; SVG or PNG with a transparent background), then write
`video.json` with the scenes (schema and storyboard craft in `references/storyboard.md`; read it before writing).
Run `python3 engine/build.py` from the folder: it validates the file and prints every scene with its start and end
time. Show the user that list as a short table (time, what is on screen, the words) and ask for changes. Do not
capture or render before they approve the storyboard.

## 5. Capture, music, contact sheets

From the video folder:
```bash
python3 engine/build.py
node engine/capture.mjs                     # screenshots every page in each theme (+ the typed search)
python3 engine/music.py                     # audio/music.wav, -14 LUFS, true peak under -1 dBTP
node engine/render.mjs sheet --format all --theme all
```
Look at every sheet yourself (`previews/<format>-<theme>/sheet.png`, a frame every 2 s) before showing it: text
that overflows, a title covering the product, a camera that shows an empty area, a dark capture that came out
light, a cookie banner, a highlight ring off its button. `build.py` and the `ready` line of the render also print
warnings (text too long, box not found, page not captured): fix them all. Check single moments with
`node engine/render.mjs still 12.5 30 --format 9x16 --theme dark`. Show the user the sheets and ask for changes;
iterate on `video.json` (only `capture.mjs` again if pages changed, only `music.py` again if the scenes changed).

## 6. Render and deliver

```bash
node engine/render.mjs full --format all --theme all     # out/<name>-<format>-<theme>.mp4
```
On a recent laptop about 30 s to 2 minutes per minute of video, per format and theme, with 4 workers (`WORKERS=6` for more). Long renders:
run them in the background. Output: H.264 CRF 10 (master quality), BT.709, AAC 320 kbps, 30 fps, +faststart:
platforms re-encode, so a rich source keeps them sharp. Check each file (ffmpeg `-i`: duration, 1920x1080 or
1080x1920, an audio stream), then give the user the paths, the length, and a short posting note per platform from
`references/interview.md` (cover frame, where captions go, how long the platform allows).

Before you finish, check that no headless Chrome is left running (`ps aux | grep -- --headless | grep -v grep`):
the scripts close it themselves, but stop any you started that is still there.

## Ground rules

- Facts in the video come from the site or the user, never from memory. Ask when unsure.
- The engine is data-driven: change `video.json`, not the engine. If a request needs something the scene types
  cannot do, say so and offer the closest scene type; change the engine only if the user asks, in the video
  folder's own copy.
- Only the URLs in `video.json` are opened. Typing with `"submit": true` presses Enter in that field once: use it
  only on a search or filter field, never on a form that sends, buys, signs up or posts.
- Short words win: a lead of 2 to 6 words, a big word of 1 to 3 words, a sub line of at most 12 words.
- 9:16 keeps text in the top half and the product below; the right edge and the bottom 280 px stay free for the
  platform's buttons and caption (the layout already does this: do not push text there).
- A logo or brand that is not the user's own needs their confirmation that they may use it.
