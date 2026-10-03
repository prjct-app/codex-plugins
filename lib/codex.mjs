import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';

async function configRequest(method, params, { codexHome, command = 'codex', timeoutMs = 15_000 } = {}) {
  mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  const child = spawn(command, ['app-server', '--listen', 'stdio://'], {
    cwd: codexHome, env: { ...process.env, CODEX_HOME: codexHome }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout });
  child.stderr.resume();
  const pending = new Map();
  let next = 1;
  const fail = error => { for (const { reject } of pending.values()) reject(error); pending.clear(); };
  child.on('error', () => fail(new Error('Could not start Codex. Install Codex CLI, or choose the theme with /theme.')));
  child.on('exit', () => fail(new Error('Codex exited before saving the theme')));
  child.stdin.on('error', fail);
  lines.on('line', line => {
    let data;
    try { data = JSON.parse(line); } catch { return; }
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(`Codex could not save the theme: ${data.error.message}`));
    else request.resolve(data.result);
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = next++;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  const timeout = setTimeout(() => { fail(new Error('Codex timed out while saving the theme')); child.kill(); }, timeoutMs);
  try {
    await rpc('initialize', { clientInfo: { name: 'prjct_palette', title: 'Palette', version: '0.1.0' } });
    child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
    return await rpc(method, params);
  } finally {
    clearTimeout(timeout);
    lines.close();
    child.stdin.end();
    child.kill();
  }
}

/** Let Codex edit its own TOML: preserves unrelated values, formatting and comments. */
export async function writeThemeConfig(theme, options) {
  if (!/^palette-[a-z0-9][a-z0-9-]{0,47}$/.test(theme)) throw new Error('Invalid theme name');
  return configRequest('config/value/write', { keyPath: 'tui.theme', value: theme, mergeStrategy: 'replace' }, options);
}

export async function readThemeConfig(options) {
  const result = await configRequest('config/read', { includeLayers: false }, options);
  return result.config?.tui?.theme;
}
