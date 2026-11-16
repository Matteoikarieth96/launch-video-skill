// launch-video: one headless Chrome driven over the raw DevTools protocol (Node 22+ built-in WebSocket, no npm packages).
// Every Chrome gets --use-mock-keychain --password-store=basic (no macOS Keychain prompt) and a throwaway profile,
// and is killed when the process ends, whatever ends it.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync, readFileSync, renameSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { tmpdir, homedir } from 'node:os';
import { join, relative, sep, isAbsolute, dirname, resolve, extname } from 'node:path';

export const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find(p => existsSync(p));

// ffmpeg: FFMPEG wins, else ~/.local/bin/ffmpeg if present, else the one on PATH
export const FFMPEG = process.env.FFMPEG || [join(homedir(), '.local/bin/ffmpeg')].find(p => existsSync(p)) || 'ffmpeg';

const CHROMES = new Set(), PROFILES = new Set();
process.on('exit', () => {
  for (const c of CHROMES) if (c.exitCode === null && !c.signalCode) c.kill('SIGKILL');
  for (const p of PROFILES) try { rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* best effort */ }
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));

export function need() {
  if (!CHROME) { console.error('Chrome or Chromium not found: install one or set CHROME_PATH'); process.exit(1); }
  if (typeof WebSocket === 'undefined') { console.error('Node 22 or newer is needed (built-in WebSocket)'); process.exit(1); }
}

// open a tab: { S (send in the tab), ev (evaluate), once (wait for an event), logs, close }
export async function openTab({ width = 1280, height = 900, dsf = 1, mobile = false } = {}) {
  need();
  const prof = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'launch-video-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--use-mock-keychain', '--password-store=basic', '--remote-debugging-port=0',
    `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    `--window-size=${width},${height}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  CHROMES.add(chrome); PROFILES.add(prof);
  chrome.once('exit', () => { CHROMES.delete(chrome); try { rmSync(prof, { recursive: true, force: true }); PROFILES.delete(prof); } catch { /* still flushing */ } });
  const wsUrl = await new Promise((res, rej) => {
    let buf = '';
    chrome.stderr.on('data', d => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) res(m[1]); });
    chrome.on('exit', c => rej(new Error('chrome exited ' + c)));
    setTimeout(() => rej(new Error('chrome did not start in 20 s')), 20000);
  });
  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map(), waiters = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message || JSON.stringify(m.error))) : res(m.result); }
    else if (m.method) for (const w of [...waiters]) if (w.method === m.method) { if (!w.keep) waiters.splice(waiters.indexOf(w), 1); w.res(m.params); }
  });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  const once = (method, ms = 60000) => new Promise((res, rej) => { waiters.push({ method, res }); setTimeout(() => rej(new Error('timeout waiting for ' + method)), ms); });
  const logs = [];
  waiters.push({ method: 'Runtime.exceptionThrown', keep: true, res: p => logs.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text) });
  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dsf, mobile });
  const ev = async expr => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const close = async () => {
    try { ws.close(); } catch { /* gone */ }
    const gone = new Promise(r => { if (chrome.exitCode !== null || chrome.signalCode) r(); else chrome.once('exit', r); });
    chrome.kill(); await Promise.race([gone, new Promise(r => setTimeout(r, 3000))]);
    try { rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Chrome may still be flushing */ }
  };
  return { S, ev, once, logs, close };
}

// an output folder under root (captures/light, out, previews/9x16-dark): every part must be a real folder, not a
// symlink, and stay inside root, so a planted link cannot send deletes or writes elsewhere
export function outDir(root, ...parts) {
  let d = root;
  for (const part of parts) {
    d = join(d, part);
    let st = null; try { st = lstatSync(d); } catch { /* missing: made below */ }
    if (st && st.isSymbolicLink()) { console.error(`${relative(root, d)} is a symlink: remove it (output folders must be real folders inside the video folder)`); process.exit(1); }
    if (st && !st.isDirectory()) { console.error(`${relative(root, d)} is not a folder`); process.exit(1); }
    if (!st) mkdirSync(d);
  }
  const rel = relative(realpathSync(root), realpathSync(d));
  if (rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) { console.error(`${d} is outside the video folder`); process.exit(1); }
  return d;
}

const inside = (base, p) => { const r = relative(base, p); return r === '' || (!r.startsWith('..' + sep) && r !== '..' && !isAbsolute(r)); };

// write a file without following a symlink planted at its name: write a fresh temp file next to it, then rename it
// over the name (a rename replaces the link itself)
export function safeWrite(file, data) {
  const tmp = join(dirname(file), `.lv-${process.pid}-${randomBytes(6).toString('hex')}.tmp`);
  writeFileSync(tmp, data, { flag: 'wx' });
  try { renameSync(tmp, file); } catch (e) { rmSync(tmp, { force: true }); throw e; }
}

// captures/<theme>/meta.json, read in Node and checked: the render page gets it as data and never runs a file from
// captures/. Only tiles named captures/<theme>/<page>-<n>.png that are regular files are kept; the rest is a warning.
export function readCaptures(root, theme, warn) {
  let d = root;
  for (const part of ['captures', theme]) {
    d = join(d, part);
    let st = null; try { st = lstatSync(d); } catch { return {}; }
    if (st.isSymbolicLink() || !st.isDirectory()) { warn(`${relative(root, d)} is not a real folder: captures ignored`); return {}; }
  }
  const f = join(d, 'meta.json');
  let st = null; try { st = lstatSync(f); } catch { return {}; }
  if (!st.isFile()) { warn(`captures/${theme}/meta.json is not a regular file: ignored`); return {}; }
  let meta;
  try { meta = JSON.parse(readFileSync(f, 'utf8')); } catch { warn(`captures/${theme}/meta.json is not valid JSON: run node engine/capture.mjs`); return {}; }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  const re = new RegExp(`^captures/${theme}/([a-z0-9-]+(?:__typed)?-\\d+\\.png)$`);
  for (const c of Object.values(meta)) {
    if (!c || typeof c !== 'object') continue;
    c.tiles = (Array.isArray(c.tiles) ? c.tiles : []).filter(tl => {
      const m = re.exec(String(tl && tl.src));
      let ok = false;
      if (m) try { ok = lstatSync(join(d, m[1])).isFile(); } catch { /* missing */ }
      if (!ok) warn('ignored a capture tile outside captures/: ' + String(tl && tl.src).slice(0, 60));
      return ok;
    });
  }
  return meta;
}

// build/data.json is made by build.py, which checks every path. Check again the fields the render page loads, so a
// stale or planted data.json cannot point it at files outside the video folder.
const ASSET_KEYS = new Set(['logo', 'logoDark', 'light', 'dark', 'src', 'image']);
export function checkData(root, vid) {
  const realRoot = realpathSync(root), bad = [];
  const walk = (o, key) => {
    if (Array.isArray(o)) return o.forEach(v => walk(v, key));
    if (o && typeof o === 'object') return Object.entries(o).forEach(([k, v]) => walk(v, k));
    if (typeof o !== 'string' || !ASSET_KEYS.has(key) || !/\.(png|jpe?g|svg|webp)$/i.test(o)) return;
    let ok = !isAbsolute(o) && !o.includes('\\') && !o.includes(':');
    if (ok) try { ok = inside(realRoot, realpathSync(resolve(root, o))) && statSync(resolve(root, o)).isFile(); } catch { ok = false; }
    if (!ok) bad.push(o);
  };
  walk(vid, '');
  if (vid.googleFont != null && !/^[A-Za-z0-9 ]{1,40}$/.test(String(vid.googleFont))) bad.push('googleFont');
  if (bad.length) { console.error('build/data.json points outside the video folder (' + bad.slice(0, 3).join(', ') + '): run python3 engine/build.py'); process.exit(1); }
}

// a local site (site.url "file:...") is served over http://127.0.0.1 from its own folder only, so its pages cannot
// load other local files (an http page may not open file:// URLs, and this server refuses anything outside the folder)
const TYPES = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8' };
export async function serveFolder(folder) {
  const base = realpathSync(folder);
  let port = 0;
  const srv = createServer((req, res) => {
    const no = (code) => { res.writeHead(code, { 'content-type': 'text/plain' }); res.end(String(code)); };
    if (req.headers.host !== `127.0.0.1:${port}`) return no(403);
    if (req.method !== 'GET' && req.method !== 'HEAD') return no(405);
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return no(400); }
    if (path.includes('\0')) return no(400);
    let f = resolve(base, '.' + path), real;
    try { if (statSync(f).isDirectory()) f = join(f, 'index.html'); real = realpathSync(f); } catch { return no(404); }
    if (!inside(base, real) || !statSync(real).isFile()) return no(404);
    res.writeHead(200, { 'content-type': TYPES[extname(real).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(real));
  });
  await new Promise((ok, ko) => { srv.once('error', ko); srv.listen(0, '127.0.0.1', ok); });
  port = srv.address().port;
  return { base, url: `http://127.0.0.1:${port}`, close: () => new Promise(r => srv.close(() => r())) };
}
