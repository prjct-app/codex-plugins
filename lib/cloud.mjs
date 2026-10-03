import { closeSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readJson, writePrivate } from './library.mjs';

export const DEFAULT_SITE = 'https://palette.prjct.app';
const TOKEN = /^pit_[0-9a-f]{64}$/;
const POLL = /^[0-9a-f]{64}$/;

export function secureSite(site) {
  const url = new URL(site);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Palette site must be an origin without credentials, a path or a query');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('Palette credentials require HTTPS (HTTP is only allowed for localhost)');
  return url.origin;
}

export class ApiError extends Error {
  constructor(status) { super(`Palette API returned HTTP ${status}`); this.status = status; }
}

export class Cloud {
  constructor({ site = DEFAULT_SITE, fetchImpl = globalThis.fetch, authPath, pendingPath, now = Date.now }) {
    this.site = secureSite(site);
    this.fetch = fetchImpl;
    this.authPath = authPath;
    this.pendingPath = pendingPath;
    this.now = now;
  }

  readAuth() {
    let data;
    try { data = readJson(this.authPath, undefined); } catch { return undefined; }
    if (!data || typeof data.token !== 'string' || !TOKEN.test(data.token)) return undefined;
    if (data.site !== this.site) throw new Error('This login belongs to another Palette site. Switch back to that site or disconnect it before logging in here.');
    return data;
  }

  async api(path, { method = 'GET', token, body } = {}) {
    const res = await this.fetch(new URL(path, this.site), { method,
      headers: { 'content-type': 'application/json', 'user-agent': 'palette/0.1.0 (codex)', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000), redirect: 'error' });
    if (!res.ok) throw new ApiError(res.status);
    const text = await res.text();
    if (text.length > 1024 * 1024) throw new Error('Palette response is too large');
    try { return JSON.parse(text); } catch { throw new Error('Palette returned invalid JSON'); }
  }

  async startLogin() {
    const auth = this.readAuth();
    if (auth) return { status: 'connected', username: auth.username, site: this.site };
    const previous = readJson(this.pendingPath, undefined);
    if (previous?.site === this.site && typeof previous.poll === 'string' && POLL.test(previous.poll) && Date.parse(previous.expiresAt) > this.now()) {
      return { status: 'pending', code: previous.code, url: previous.url, expiresAt: previous.expiresAt };
    }
    const link = await this.api('/api/pi/link', { method: 'POST', body: { client: 'codex' } });
    if (!link || typeof link.code !== 'string' || !/^[A-Z0-9-]{4,16}$/i.test(link.code) || typeof link.poll !== 'string' || !POLL.test(link.poll)
      || typeof link.url !== 'string' || !Number.isFinite(Date.parse(link.expiresAt)) || Date.parse(link.expiresAt) <= this.now()) throw new Error('Palette returned an invalid login code');
    const url = new URL(link.url);
    if (url.origin !== this.site || url.pathname !== '/link' || url.username || url.password) throw new Error('Palette returned an approval link for another site');
    // Older deployments do not yet recognize Codex's client label.
    url.searchParams.set('editor', 'codex');
    writePrivate(this.pendingPath, { ...link, url: url.toString(), site: this.site });
    return { status: 'pending', code: link.code, url: url.toString(), expiresAt: link.expiresAt };
  }

  removePending(poll) {
    const current = readJson(this.pendingPath, undefined);
    if (current?.poll === poll) this.forget(this.pendingPath);
  }

  async pollLogin() {
    const lockPath = `${this.pendingPath}.claim-lock`;
    // The worker and a manual login-status can race. Claiming a code consumes
    // its token once, so only one process may poll it at a time.
    const nonce = randomUUID();
    let lock;
    try { lock = openSync(lockPath, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'ENOENT') return { status: this.readAuth() ? 'connected' : 'not-connected' };
      if (error.code !== 'EEXIST') throw error;
      const previous = readJson(lockPath, undefined);
      let alive = true;
      if (Number.isInteger(previous?.pid) && previous.pid > 0) {
        try { process.kill(previous.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
      }
      if (alive) return { status: this.readAuth() ? 'connected' : 'pending' };
      if (readJson(lockPath, undefined)?.nonce !== previous.nonce) return { status: 'pending' };
      this.forget(lockPath);
      try { lock = openSync(lockPath, 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') return { status: 'pending' }; throw error; }
    }
    try {
      writeFileSync(lock, JSON.stringify({ pid: process.pid, nonce }));
      closeSync(lock);
      lock = undefined;
      return await this.claimLogin();
    } finally {
      if (lock !== undefined) closeSync(lock);
      if (readJson(lockPath, undefined)?.nonce === nonce) this.forget(lockPath);
    }
  }

  async claimLogin() {
    const pending = readJson(this.pendingPath, undefined);
    if (!pending) return { status: this.readAuth() ? 'connected' : 'not-connected' };
    if (pending.site !== this.site || typeof pending.poll !== 'string' || !POLL.test(pending.poll)) throw new Error('Invalid pending Palette login');
    if (!Number.isFinite(Date.parse(pending.expiresAt)) || Date.parse(pending.expiresAt) <= this.now()) { this.removePending(pending.poll); return { status: 'expired' }; }
    const claim = await this.api('/api/pi/link/claim', { method: 'POST', body: { poll: pending.poll } });
    // A logout or replacement login during the HTTP request cancels this claim.
    if (readJson(this.pendingPath, undefined)?.poll !== pending.poll) return { status: 'cancelled' };
    if (claim?.status === 'ok') {
      if (typeof claim.token !== 'string' || !TOKEN.test(claim.token)) throw new Error('Palette returned an invalid token');
      const username = typeof claim.username === 'string' ? claim.username.slice(0, 40) : undefined;
      writePrivate(this.authPath, { token: claim.token, site: this.site, username, connectedAt: new Date(this.now()).toISOString() });
      this.removePending(pending.poll);
      return { status: 'connected', username, site: this.site };
    }
    if (!['pending', 'expired', 'invalid'].includes(claim?.status)) throw new Error('Palette returned an invalid login status');
    if (claim.status !== 'pending') this.removePending(pending.poll);
    return { status: claim.status };
  }

  forget(path = this.authPath) {
    try { unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  async logout() {
    const auth = this.readAuth();
    this.forget(this.pendingPath);
    let revoked = !auth;
    try {
      if (auth) { await this.api('/api/pi/token', { method: 'DELETE', token: auth.token }); revoked = true; }
    } catch (error) { if (error.status === 401) revoked = true; }
    this.forget();
    return { status: 'disconnected', revoked, ...(revoked ? {} : { instruction: 'Removed locally. Revoke this device on palette.prjct.app/library when you are online.' }) };
  }
}
