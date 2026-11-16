// launch-video renderer: draws engine/video.html frame by frame in headless Chrome and encodes with ffmpeg.
// Run from the video folder (the one with video.json), after `python3 engine/build.py`:
//   node engine/render.mjs still 1.5 12 30 [--format 9x16] [--theme dark]   -> previews/<format>-<theme>/t1.50.png ...
//   node engine/render.mjs sheet [--format all] [--theme all]              -> previews/<format>-<theme>/sheet.png (a frame every 2 s)
//   node engine/render.mjs full [--format all] [--theme all] [--fps 30]    -> out/<name>-<format>-<theme>.mp4
// --format: 16x9 (1920x1080), 9x16 (1080x1920) or all (the formats in video.json). --theme: light, dark or all.
// WORKERS=6 sets how many Chrome processes draw frames in parallel (default 4).
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { openTab, FFMPEG, outDir } from './chrome.mjs';

const ENGINE = dirname(fileURLToPath(import.meta.url)), ROOT = resolve(ENGINE, '..');
const DATA = join(ROOT, 'build', 'data.json');
if (!existsSync(DATA)) { console.error('build/data.json missing: run python3 engine/build.py first'); process.exit(1); }
const VID = JSON.parse(readFileSync(DATA, 'utf8'));
const args = process.argv.slice(2), mode = args[0] || 'sheet';
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const times = args.slice(1).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--'))).map(Number).filter(n => !isNaN(n));
const pick = (v, all) => v === 'all' ? all : v.split(',');
const FORMATS = pick(opt('format', VID.formats[0]), VID.formats), THEMES = pick(opt('theme', VID.themes[0]), VID.themes);
for (const f of FORMATS) if (!['16x9', '9x16'].includes(f)) { console.error('format must be 16x9, 9x16 or all'); process.exit(1); }
for (const t of THEMES) if (!VID.themes.includes(t)) { console.error(`theme ${t} is not in video.json themes (${VID.themes.join(', ')})`); process.exit(1); }
const FPS = +opt('fps', 30), WORKERS = Math.max(1, Math.floor(+(process.env.WORKERS || 4)));
const TOTAL = VID.timeline.beats * 60 / VID.timeline.bpm;
const fail = e => { console.error('render failed:', e?.message || e); process.exit(1); };
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

async function openPage(format, theme) {
  const [w, h] = format === '9x16' ? [1080, 1920] : [1920, 1080];
  const tab = await openTab({ width: w, height: h });
  const loaded = tab.once('Page.loadEventFired');
  await tab.S('Page.navigate', { url: pathToFileURL(join(ENGINE, 'video.html')).href + `?format=${format}&theme=${theme}` });
  await loaded;
  const info = await tab.ev('window.ready');
  const shot = async t => {
    await tab.ev(`seek(${t})`);
    const { data } = await tab.S('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
    return Buffer.from(data, 'base64');
  };
  return { ...tab, info, shot, w, h };
}

function encodeArgs(out, audio) {
  const a = existsSync(audio) ? ['-i', audio] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'];
  // master quality: lossless PNG frames, x264 CRF 10, BT.709 tags, AAC 320k (platforms re-encode, a rich source loses less)
  return ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', ...a,
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv',
    '-c:v', 'libx264', '-preset', 'slow', '-tune', 'animation', '-crf', '10', '-maxrate', '20M', '-bufsize', '40M', '-profile:v', 'high',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-t', TOTAL.toFixed(3), '-movflags', '+faststart', out];
}

async function full(format, theme) {
  const out = join(outDir(ROOT, 'out'), `${VID.name}-${format}-${theme}.mp4`);
  const pages = await Promise.all(Array.from({ length: WORKERS }, () => openPage(format, theme)));
  const n = Math.round(TOTAL * FPS), t0 = Date.now();
  console.log(`${format} ${theme}: ${pages.length} Chrome worker(s), ${n} frames`);
  const ff = spawn(FFMPEG, encodeArgs(out, join(ROOT, 'audio', 'music.wav')), { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise(r => ff.on('exit', r));
  const ready = new Map(), AHEAD = pages.length * 4;
  let next = 0, written = 0, wakeWriter = null, wakeWorkers = [];
  const ping = () => { const w = wakeWriter; wakeWriter = null; w?.(); };
  const worker = async p => {
    for (;;) {
      while (next - written >= AHEAD) await new Promise(r => wakeWorkers.push(r));
      const f = next++;
      if (f >= n) return;
      ready.set(f, await p.shot(f / FPS));
      ping();
    }
  };
  const writer = async () => {
    while (written < n) {
      if (!ready.has(written)) { await new Promise(r => { wakeWriter = r; }); continue; }
      const buf = ready.get(written); ready.delete(written);
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (written % 300 === 0) console.log(`frame ${written}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      written++;
      const ws = wakeWorkers; wakeWorkers = []; ws.forEach(r => r());
    }
  };
  await Promise.all([writer(), ...pages.map(worker)]);
  ff.stdin.end();
  const code = await ffDone;
  const errs = pages.flatMap(p => p.logs);
  await Promise.all(pages.map(p => p.close()));
  if (code !== 0) fail('ffmpeg exited ' + code);
  if (errs.length) console.warn('page errors:', errs.join(' | '));
  console.log('video', out, `${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

async function stills(format, theme, sheet) {
  const p = await openPage(format, theme);
  console.log('ready', format, theme, JSON.stringify({ total: +p.info.total.toFixed(2), warnings: p.info.warnings }));
  const dir = outDir(ROOT, 'previews', `${format}-${theme}`);
  if (!sheet) {
    for (const t of times) { const f = join(dir, `t${t.toFixed(2)}.png`); writeFileSync(f, await p.shot(t)); console.log('still', f); }
  } else {
    const step = 2, ts = []; for (let t = 1; t < TOTAL; t += step) ts.push(+t.toFixed(2));
    const tmp = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'launch-video-sheet-'));
    try {
      for (const [k, t] of ts.entries()) writeFileSync(join(tmp, `f${String(k).padStart(3, '0')}.png`), await p.shot(t));
      const cols = format === '9x16' ? 8 : 4, [tw, th] = format === '9x16' ? [270, 480] : [480, 270];
      const r = spawnSync(FFMPEG, ['-y', '-v', 'error', '-framerate', '1', '-i', join(tmp, 'f%03d.png'), '-vf',
        `scale=${tw}:${th},tile=${cols}x${Math.ceil(ts.length / cols)}:padding=4:color=gray`, '-frames:v', '1', join(dir, 'sheet.png')], { stdio: ['ignore', 'ignore', 'pipe'] });
      if (r.status !== 0) fail('contact sheet: ' + String(r.stderr || '').trim());
    } finally { rmSync(tmp, { recursive: true, force: true }); }
    console.log('sheet', join(dir, 'sheet.png'), `(a frame every ${step} s from 1 s, left to right)`);
  }
  if (p.logs.length) console.warn('page errors:', p.logs.join(' | '));
  await p.close();
}

if (!['still', 'sheet', 'full'].includes(mode)) fail('mode must be still, sheet or full');
if (mode === 'still' && !times.length) fail('still needs one or more times in seconds');
for (const f of FORMATS) for (const t of THEMES) {
  if (mode === 'full') await full(f, t); else await stills(f, t, mode === 'sheet');
}
// Chrome's helper processes can keep a pipe open and hold node alive after the work is done
process.exit(0);
