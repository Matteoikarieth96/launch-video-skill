// Behaviour checks of the engine's file and server guards (no Chrome). Run by tests/test_skill.py:
//   node tests/node_checks.mjs <scratch folder>
import { mkdirSync, writeFileSync, readFileSync, symlinkSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { request } from 'node:http';
import { pathToFileURL } from 'node:url';

const T = resolve(process.argv[2]);
const engine = pathToFileURL(resolve(import.meta.dirname, '..', 'engine', 'chrome.mjs')).href;
const { safeWrite, readCaptures, serveFolder } = await import(engine);
const ok = (cond, msg) => { if (!cond) { console.error('FAIL', msg); process.exit(1); } console.log('ok', msg); };

// safeWrite replaces a planted symlink instead of writing through it
writeFileSync(join(T, 'victim.txt'), 'untouched');
mkdirSync(join(T, 'out'));
symlinkSync(join(T, 'victim.txt'), join(T, 'out', 'x.png'));
safeWrite(join(T, 'out', 'x.png'), 'new');
ok(readFileSync(join(T, 'victim.txt'), 'utf8') === 'untouched', 'safeWrite leaves the symlink target alone');
ok(lstatSync(join(T, 'out', 'x.png')).isFile() && readFileSync(join(T, 'out', 'x.png'), 'utf8') === 'new', 'safeWrite writes a regular file');

// readCaptures keeps only regular tiles under captures/<theme>/
const V = join(T, 'video'), C = join(V, 'captures', 'light');
mkdirSync(C, { recursive: true });
writeFileSync(join(C, 'home-0.png'), 'png');
symlinkSync(join(T, 'victim.txt'), join(C, 'home-1.png'));
writeFileSync(join(C, 'meta.json'), JSON.stringify({ home: { w: 1, h: 1, tiles: [
  { src: 'captures/light/home-0.png' }, { src: 'captures/light/home-1.png' }, { src: '../outside.png' },
  { src: 'captures/light/../../x-0.png' }, { src: 'captures/dark/home-0.png' }] } }));
const warns = [];
const meta = readCaptures(V, 'light', m => warns.push(m));
ok(meta.home.tiles.length === 1 && meta.home.tiles[0].src === 'captures/light/home-0.png', 'readCaptures keeps only the real tile');
ok(warns.length === 4 && warns.every(w => w.startsWith('ignored a capture tile')), 'readCaptures warns about the other four');

// serveFolder serves only its folder, to the right Host
const S = join(T, 'site');
mkdirSync(S);
writeFileSync(join(S, 'index.html'), '<p>hi</p>');
writeFileSync(join(T, 'secret.txt'), 'secret');
symlinkSync(join(T, 'secret.txt'), join(S, 'link.txt'));
const srv = await serveFolder(S);
const port = new URL(srv.url).port;
const get = (path, host = `127.0.0.1:${port}`) => new Promise((res, rej) => {
  const r = request({ host: '127.0.0.1', port, path, headers: { host } }, resp => { let b = ''; resp.on('data', d => b += d); resp.on('end', () => res([resp.statusCode, b])); });
  r.on('error', rej); r.end();
});
ok((await get('/'))[0] === 200, 'serves index.html');
ok((await get('/../secret.txt'))[0] === 404, 'refuses /../');
ok((await get('/%2e%2e/secret.txt'))[0] === 404, 'refuses encoded ..');
ok((await get('/link.txt'))[0] === 404, 'refuses a symlink that leaves the folder');
ok((await get('/', 'evil.example'))[0] === 403, 'refuses another Host');
await srv.close();
console.log('all node checks passed');
