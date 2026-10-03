#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Palette } from '../lib/palette.mjs';

const [verb = 'list', ...args] = process.argv.slice(2);
const action = verb.toLowerCase();
const argument = args.find(arg => !arg.startsWith('--'));
const output = value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
try {
  const palette = new Palette();
  if (!args.includes('--no-apply') && !['login', 'login-status', 'login-wait', 'logout', 'desktop', 'install'].includes(action)) await palette.refreshSelection();
  switch (action) {
    case 'list': output(palette.list()); break;
    case 'install': output(palette.install()); break;
    case 'apply': output(await palette.apply(argument)); break;
    case 'next': case 'prev': case 'random': output(await palette.cycle(action)); break;
    case 'fav': output(palette.favorite(argument)); break;
    case 'import': output(await palette.importFile(argument, { replace: args.includes('--replace'), applySelection: !args.includes('--no-apply') })); break;
    case 'export': output(palette.exportFile(argument)); break;
    case 'status': output(palette.status()); break;
    case 'desktop': output(palette.desktop(argument)); break;
    case 'login': {
      const result = await palette.cloud.startLogin();
      output(result);
      if (result.status === 'pending' && !args.includes('--no-wait')) {
        const worker = spawn(process.execPath, [fileURLToPath(import.meta.url), 'login-wait'], { detached: true, stdio: 'ignore', env: process.env });
        worker.on('error', () => {});
        worker.unref();
      }
      break;
    }
    case 'login-status': output(await palette.cloud.pollLogin()); break;
    case 'login-wait': {
      // This background worker belongs to this login only, and exits on logout,
      // expiry or a new login. Poll secrets and tokens never go to stdout.
      const { readJson } = await import('../lib/library.mjs');
      const initial = readJson(palette.cloud.pendingPath, undefined);
      const deadline = Math.min(Date.parse(initial?.expiresAt) || 0, Date.now() + 10 * 60_000);
      while (initial && Date.now() < deadline && readJson(palette.cloud.pendingPath, undefined)?.poll === initial.poll) {
        await delay(3000);
        try { if ((await palette.cloud.pollLogin()).status !== 'pending') break; }
        catch { if (Date.parse(initial.expiresAt) <= Date.now()) { palette.cloud.removePending(initial.poll); break; } }
      }
      if (initial && Date.now() >= deadline) palette.cloud.removePending(initial.poll);
      break;
    }
    case 'sync': output(await palette.sync({ applySelection: !args.includes('--no-apply') })); break;
    case 'logout': output(await palette.cloud.logout()); break;
    default: output(await palette.apply(action));
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
