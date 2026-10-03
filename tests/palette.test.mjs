import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Palette } from '../lib/palette.mjs';
import { parseLibrary, writePrivate } from '../lib/library.mjs';
import { Cloud, secureSite } from '../lib/cloud.mjs';
import { desktopRecipe, syncThemeFiles, toTmTheme } from '../lib/themes.mjs';
import { readThemeConfig, writeThemeConfig } from '../lib/codex.mjs';

const token = `pit_${'a'.repeat(64)}`;
const poll = 'b'.repeat(64);
const temp = t => { const path = mkdtempSync(join(tmpdir(), 'codex-palette-test-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path; };
const fixture = (t, opts = {}) => {
  const calls = [];
  const palette = new Palette({ codexHome: temp(t), saveTheme: async (theme, options) => { calls.push({ theme, options }); }, ...opts });
  return { palette, calls };
};
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });

test('all 34 palettes produce actual plist themes, with semantic syntax roles', t => {
  const { palette } = fixture(t);
  assert.equal(palette.list().length, 34);
  for (const p of palette.palettes()) {
    const parsed = JSON.parse(execFileSync('python3', ['-c', 'import json,plistlib,sys; print(json.dumps(plistlib.loads(sys.stdin.buffer.read())))'], { input: toTmTheme(p), encoding: 'utf8' }));
    assert.equal(parsed.name, `Palette · ${p.label}`);
    assert.equal(parsed.settings[0].settings.background, p.vars.canvas);
    const string = parsed.settings.find(s => s.scope === 'string');
    assert.equal(string.settings.foreground, p.vars[p.colors?.syntaxString || 'synString'] || p.vars.success);
  }
});

test('untrusted libraries validate ids and core roles, deduplicate, and preserve meaningful mappings', t => {
  const { palette } = fixture(t);
  const nord = palette.find('nord');
  const parsed = parseLibrary(JSON.stringify({ palettes: [{ ...nord, id: '../../config' }, { id: 'missing', vars: {} }, nord, nord], favorites: ['nord', 'nord', '../auth'] }));
  assert.deepEqual(parsed.palettes.map(p => p.id), ['nord']);
  assert.deepEqual(parsed.favorites, ['nord']);
  assert.throws(() => parseLibrary('{"palettes":[{}]}'), /no valid palettes/);
  assert.throws(() => parseLibrary('{"format":"other","palettes":[]}'), /format/);
});

test('own themes override bundled themes; favorites persist and sort first; apply saves only after success', async t => {
  const { palette, calls } = fixture(t);
  const own = { ...palette.find('nord'), label: 'My Nord', vars: { ...palette.find('nord').vars, accent: '#123456' } };
  writePrivate(palette.libraryPath, { palettes: [own] });
  palette.favorite('nord');
  assert.equal(palette.list()[0].id, 'nord');
  assert.equal(palette.list()[0].group, 'own');
  await palette.apply('nord');
  assert.equal(calls[0].theme, 'palette-nord');
  const reloaded = new Palette({ codexHome: palette.codexHome });
  assert.equal(reloaded.status().active, 'nord');
  assert.deepEqual(reloaded.status().favorites, ['nord']);
  palette.saveTheme = async () => { throw new Error('config failure'); };
  await assert.rejects(palette.apply('dracula'), /config failure/);
  assert.equal(palette.status().active, 'nord');
});

test('theme installation keeps unrelated files and refuses ownership collisions before any writes', t => {
  const { palette } = fixture(t);
  palette.install();
  const custom = join(palette.themesDir, 'my-theme.tmTheme');
  writeFileSync(custom, 'mine');
  const orphan = { ...palette.find('nord'), id: 'own-theme' };
  syncThemeFiles([...palette.palettes(), orphan], palette.themesDir, palette.manifestPath);
  syncThemeFiles(palette.palettes(), palette.themesDir, palette.manifestPath);
  assert.ok(!existsSync(join(palette.themesDir, 'palette-own-theme.tmTheme')));
  assert.equal(readFileSync(custom, 'utf8'), 'mine');
  writeFileSync(join(palette.themesDir, 'palette-collision.tmTheme'), 'user theme');
  const before = readFileSync(palette.manifestPath, 'utf8');
  assert.throws(() => syncThemeFiles([...palette.palettes(), { ...orphan, id: 'collision' }], palette.themesDir, palette.manifestPath), /not created by Palette/);
  assert.equal(readFileSync(palette.manifestPath, 'utf8'), before);
});

test('native /theme selections are observed before cycling or exporting instead of using stale plugin state', async t => {
  const { palette } = fixture(t, { readTheme: async () => 'palette-dracula' });
  await palette.apply('nord');
  writeFileSync(join(palette.codexHome, 'config.toml'), '');
  await palette.refreshSelection();
  assert.equal(palette.status().active, 'dracula');
  const exported = palette.exportFile(join(palette.codexHome, 'export.json'));
  assert.equal(parseLibrary(readFileSync(exported.path, 'utf8')).active, 'dracula');
  palette.readTheme = async () => 'a-theme-from-another-plugin';
  await palette.refreshSelection();
  assert.equal(palette.status().active, undefined);
});

test('whole-library import previews replacement; authorized import and export round trip with private permissions', async t => {
  const { palette } = fixture(t);
  const input = join(palette.codexHome, 'input.json');
  const own = { ...palette.find('nord'), id: 'my-nord' };
  writePrivate(input, { format: 'pi-palette', version: 1, palettes: [own], favorites: ['nord', 'my-nord'], active: 'my-nord' });
  assert.equal((await palette.importFile(input)).confirmationRequired, true);
  assert.ok(!existsSync(palette.libraryPath));
  await palette.importFile(input, { replace: true });
  const exported = palette.exportFile(join(palette.codexHome, 'export.json'));
  const lib = parseLibrary(readFileSync(exported.path, 'utf8'));
  assert.deepEqual(lib.palettes.map(p => p.id), ['my-nord']);
  assert.equal(lib.active, 'my-nord');
  assert.deepEqual(lib.favorites, ['nord', 'my-nord']);
  assert.equal(statSync(exported.path).mode & 0o777, 0o600);
});

test('single theme import adds and applies it without replacing other palettes or favorites', async t => {
  const { palette } = fixture(t);
  palette.favorite('nord');
  writePrivate(palette.libraryPath, { palettes: [{ ...palette.find('nord'), id: 'first' }] });
  const input = join(palette.codexHome, 'second.json');
  writePrivate(input, { name: 'second', vars: palette.find('dracula').vars });
  await palette.importFile(input);
  assert.deepEqual(palette.own().palettes.map(p => p.id), ['first', 'second']);
  assert.equal(palette.status().active, 'second');
  assert.deepEqual(palette.status().favorites, ['nord']);
});

test('login starts and claims the existing API, scopes the private token, and redacts all output', async t => {
  const requests = [];
  const { palette } = fixture(t, { fetchImpl: async (url, opts) => {
    requests.push({ url: String(url), opts });
    return new URL(url).pathname === '/api/pi/link' ? response({ code: 'ABCD-1234', poll, url: 'https://palette.prjct.app/link?code=ABCD-1234&editor=pi', expiresAt: new Date(Date.now() + 60_000).toISOString() })
      : response({ status: 'ok', token, username: 'jj' });
  } });
  const start = await palette.cloud.startLogin();
  assert.equal(JSON.parse(requests[0].opts.body).client, 'codex');
  assert.equal(new URL(start.url).searchParams.get('editor'), 'codex');
  assert.ok(!JSON.stringify(start).includes(poll));
  await palette.cloud.pollLogin();
  assert.equal(palette.status().connected, true);
  assert.equal(palette.status().username, 'jj');
  assert.ok(!JSON.stringify(palette.status()).includes(token));
  assert.equal(statSync(palette.cloud.authPath).mode & 0o777, 0o600);
  assert.ok(!existsSync(palette.cloud.pendingPath));
  const other = new Cloud({ site: 'https://other.example', authPath: palette.cloud.authPath, pendingPath: palette.cloud.pendingPath });
  assert.throws(() => other.readAuth(), /another Palette site/);
});

test('logout during a pending claim prevents credentials from being recreated', async t => {
  let release;
  const { palette } = fixture(t, { fetchImpl: () => new Promise(resolve => { release = resolve; }) });
  writePrivate(palette.cloud.pendingPath, { poll, site: palette.cloud.site, expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const claim = palette.cloud.pollLogin();
  await palette.cloud.logout();
  release(response({ status: 'ok', token }));
  assert.equal((await claim).status, 'cancelled');
  assert.ok(!existsSync(palette.cloud.authPath));
});

test('a concurrent worker and login-status consume the one-time token only once', async t => {
  let release;
  let requests = 0;
  const { palette } = fixture(t, { fetchImpl: () => { requests++; return new Promise(resolve => { release = resolve; }); } });
  writePrivate(palette.cloud.pendingPath, { poll, site: palette.cloud.site, expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const claim = palette.cloud.pollLogin();
  assert.equal((await palette.cloud.pollLogin()).status, 'pending');
  assert.equal(requests, 1);
  release(response({ status: 'ok', token }));
  assert.equal((await claim).status, 'connected');
  assert.equal((await palette.cloud.pollLogin()).status, 'connected');
  assert.ok(!existsSync(`${palette.cloud.pendingPath}.claim-lock`));
});

test('expired pending logins are removed without contacting the service', async t => {
  const { palette } = fixture(t, { fetchImpl: async () => { throw new Error('Unexpected network call'); } });
  writePrivate(palette.cloud.pendingPath, { poll, site: palette.cloud.site, expiresAt: new Date(Date.now() - 1).toISOString() });
  assert.equal((await palette.cloud.pollLogin()).status, 'expired');
  assert.ok(!existsSync(palette.cloud.pendingPath));
});

test('sync sends and pulls the shared library, preserves active selection, and offline actions never fetch', async t => {
  const requests = [];
  let remote;
  const { palette } = fixture(t, { fetchImpl: async (url, opts) => {
    requests.push({ path: new URL(url).pathname, ...opts });
    return opts.method === 'PUT' ? response({ saved: 1 }) : response(remote);
  } });
  await palette.apply('nord');
  palette.favorite('dracula');
  palette.list(); palette.status(); palette.desktop('nord');
  assert.equal(requests.length, 0);
  writePrivate(palette.cloud.authPath, { token, site: palette.cloud.site });
  remote = { format: 'pi-palette', version: 1, active: 'dracula', palettes: [{ ...palette.find('nord'), id: 'remote' }], favorites: ['remote', 'dracula'] };
  await palette.sync();
  assert.equal(requests[0].path, '/api/pi/library');
  assert.equal(requests[0].headers.authorization, `Bearer ${token}`);
  assert.equal(requests[0].redirect, 'error');
  assert.equal(JSON.parse(requests[0].body).format, 'pi-palette');
  assert.equal(requests[1].method, 'GET');
  assert.equal(palette.status().active, 'nord');
  assert.deepEqual(palette.status().favorites, ['remote', 'dracula']);
  assert.ok(existsSync(join(palette.themesDir, 'palette-remote.tmTheme')));
});

test('revoked tokens are cleared, malformed remote libraries preserve local data, and offline logout reports revocation failure', async t => {
  const { palette } = fixture(t, { fetchImpl: async () => response({}, 401) });
  writePrivate(palette.cloud.authPath, { token, site: palette.cloud.site });
  await assert.rejects(palette.sync(), /disconnected/);
  assert.equal(palette.status().connected, false);
  writePrivate(palette.cloud.authPath, { token, site: palette.cloud.site });
  palette.cloud.fetch = async (_url, opts) => opts.method === 'PUT' ? response({ saved: 0 }) : response({ palettes: [{}] });
  const before = JSON.stringify(palette.own());
  await assert.rejects(palette.sync(), /no valid palettes/);
  assert.equal(JSON.stringify(palette.own()), before);
  palette.cloud.fetch = async () => { throw new Error('offline'); };
  const result = await palette.cloud.logout();
  assert.equal(result.revoked, false);
  assert.ok(!existsSync(palette.cloud.authPath));
});

test('desktop-only library sync and import do not need the CLI config writer', async t => {
  const { palette } = fixture(t, { saveTheme: async () => { throw new Error('CLI should not run'); }, fetchImpl: async (_url, opts) => opts.method === 'PUT' ? response({ saved: 0 }) : response({ palettes: [], favorites: [], active: 'nord' }) });
  const input = join(palette.codexHome, 'library.json');
  writePrivate(input, { palettes: [], active: 'nord', favorites: ['nord'] });
  await palette.importFile(input, { replace: true, applySelection: false });
  writePrivate(palette.cloud.authPath, { token, site: palette.cloud.site });
  await palette.sync({ applySelection: false });
  assert.equal(palette.status().active, 'nord');
});

test('the actual helper returns the approval code promptly and its background worker saves the claimed token', async t => {
  const codexHome = temp(t);
  const routes = [];
  let site;
  const server = createServer(async (req, res) => {
    routes.push(req.url);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/pi/link') {
      assert.equal(body.client, 'codex');
      res.end(JSON.stringify({ code: 'ABCD-1234', poll, url: `${site}/link?code=ABCD-1234`, expiresAt: new Date(Date.now() + 15_000).toISOString() }));
    } else {
      assert.equal(req.url, '/api/pi/link/claim');
      assert.equal(body.poll, poll);
      res.end(JSON.stringify({ status: 'ok', token, username: 'test-user' }));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  site = `http://127.0.0.1:${server.address().port}`;
  const script = fileURLToPath(new URL('../scripts/palette.mjs', import.meta.url));
  const stdout = await new Promise((resolve, reject) => execFile(process.execPath, [script, 'login'], { env: { ...process.env, CODEX_HOME: codexHome, PALETTE_SITE_URL: site }, timeout: 5000 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  assert.equal(JSON.parse(stdout).code, 'ABCD-1234');
  assert.ok(!stdout.includes(poll));
  assert.ok(!stdout.includes(token));
  const authPath = join(codexHome, 'palette', 'auth.json');
  const deadline = Date.now() + 5000;
  while (!existsSync(authPath) && Date.now() < deadline) await delay(50);
  assert.ok(existsSync(authPath), 'Background worker completed the device login');
  assert.equal(JSON.parse(readFileSync(authPath, 'utf8')).token, token);
  assert.deepEqual(routes, ['/api/pi/link', '/api/pi/link/claim']);
});

test('HTTP and approval origin validation prevent credentials from leaving the selected service', async t => {
  assert.equal(secureSite('http://localhost:3000'), 'http://localhost:3000');
  assert.throws(() => secureSite('http://palette.prjct.app'), /HTTPS/);
  assert.throws(() => secureSite('https://user:password@example.com'), /credentials/);
  const { palette } = fixture(t, { fetchImpl: async () => response({ code: 'ABCD-1234', poll, expiresAt: new Date(Date.now() + 60_000).toISOString(), url: 'https://evil.example/link' }) });
  await assert.rejects(palette.cloud.startLogin(), /another site/);
  assert.ok(!existsSync(palette.cloud.pendingPath));
});

test('desktop recipe reflects the chosen palette and explicitly reports it was not applied', t => {
  const { palette } = fixture(t);
  const nord = palette.find('nord');
  const desktop = desktopRecipe(nord);
  assert.equal(desktop.background, nord.vars.canvas);
  assert.equal(desktop.accent, nord.vars.accent);
  assert.equal(desktop.applied, false);
  assert.equal(desktop.base, 'dark');
});

test('Codex writes only tui.theme through its own config API and preserves comments and other settings', async t => {
  const codexHome = temp(t);
  const config = join(codexHome, 'config.toml');
  writeFileSync(config, '# Keep my preferences\nmodel = "gpt-6.1-sol"\n\n[tui]\n# Keep this comment\nanimations = false\ntheme = "nord"\n');
  await writeThemeConfig('palette-dracula', { codexHome });
  assert.equal(await readThemeConfig({ codexHome }), 'palette-dracula');
  const text = readFileSync(config, 'utf8');
  assert.ok(text.includes('# Keep my preferences'));
  assert.ok(text.includes('# Keep this comment'));
  assert.ok(text.includes('model = "gpt-6.1-sol"'));
  assert.ok(text.includes('animations = false'));
  assert.ok(text.includes('theme = "palette-dracula"'));
});
