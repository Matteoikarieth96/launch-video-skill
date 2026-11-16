// launch-video: one headless Chrome driven over the raw DevTools protocol (Node 22+ built-in WebSocket, no npm packages).
// Every Chrome gets --use-mock-keychain --password-store=basic (no macOS Keychain prompt) and a throwaway profile,
// and is killed when the process ends, whatever ends it.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, relative, sep, isAbsolute } from 'node:path';

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
