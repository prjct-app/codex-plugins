import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Cloud, DEFAULT_SITE } from './cloud.mjs';
import { readThemeConfig, writeThemeConfig } from './codex.mjs';
import { ID, mergePalettes, parseLibrary, readJson, writePrivate } from './library.mjs';
import { desktopRecipe, syncThemeFiles } from './themes.mjs';

const BUNDLED = new URL('../assets/palettes.json', import.meta.url);
const expand = path => resolve(path.replace(/^~(?=$|\/)/, homedir()));

export class Palette {
  constructor({ codexHome = process.env.CODEX_HOME || join(homedir(), '.codex'), site = process.env.PALETTE_SITE_URL || DEFAULT_SITE,
    fetchImpl, saveTheme = writeThemeConfig, readTheme = readThemeConfig, bundledPath = BUNDLED, now } = {}) {
    this.codexHome = resolve(codexHome);
    this.dataDir = join(this.codexHome, 'palette');
    this.libraryPath = join(this.dataDir, 'library.json');
    this.statePath = join(this.dataDir, 'state.json');
    this.manifestPath = join(this.dataDir, 'themes.json');
    this.themesDir = join(this.codexHome, 'themes');
    this.bundled = parseLibrary(readFileSync(bundledPath, 'utf8')).palettes;
    this.saveTheme = saveTheme;
    this.readTheme = readTheme;
    this.cloud = new Cloud({ site, fetchImpl, now, authPath: join(this.dataDir, 'auth.json'), pendingPath: join(this.dataDir, 'pending.json') });
  }

  own() { return existsSync(this.libraryPath) ? parseLibrary(readFileSync(this.libraryPath, 'utf8')) : { format: 'pi-palette', version: 1, palettes: [] }; }
  palettes() { return mergePalettes(this.bundled, this.own().palettes); }
  async refreshSelection() {
    if (!existsSync(join(this.codexHome, 'config.toml'))) return;
    const theme = await this.readTheme({ codexHome: this.codexHome });
    this.hasNativeSelection = true;
    const id = typeof theme === 'string' && theme.startsWith('palette-') ? theme.slice(8) : undefined;
    this.nativeSelection = this.palettes().some(p => p.id === id) ? id : undefined;
  }
  state() {
    const raw = readJson(this.statePath, {});
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid Palette state');
    const active = this.hasNativeSelection ? this.nativeSelection : raw.active;
    return { ...(typeof active === 'string' && ID.test(active) ? { active } : {}),
      favorites: Array.isArray(raw.favorites) ? [...new Set(raw.favorites.filter(id => typeof id === 'string' && ID.test(id)))] : [] };
  }
  find(id) {
    const palette = this.palettes().find(p => p.id === id?.trim().toLowerCase());
    if (!palette) throw new Error(`Unknown palette: ${id}`);
    return palette;
  }
  list() {
    const { active, favorites } = this.state();
    const groups = ['own', 'editor', 'photo', 'original', 'community'];
    return this.palettes().map(p => ({ id: p.id, label: p.label, group: p.own ? 'own' : p.group || 'community', active: p.id === active, favorite: favorites.includes(p.id) }))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || groups.indexOf(a.group) - groups.indexOf(b.group));
  }
  install() {
    const files = syncThemeFiles(this.palettes(), this.themesDir, this.manifestPath);
    return { installed: files.length, themesDir: this.themesDir, instruction: 'In Codex CLI, open /theme to preview and select a palette-* theme.' };
  }
  async apply(id) {
    const palette = this.find(id);
    this.install();
    const theme = `palette-${palette.id}`;
    await this.saveTheme(theme, { codexHome: this.codexHome });
    this.nativeSelection = palette.id;
    writePrivate(this.statePath, { ...this.state(), active: palette.id });
    return { active: palette.id, label: palette.label, theme, saved: true,
      instruction: 'Saved for Codex CLI. In an already open CLI session, open /theme and select this theme to update syntax highlighting immediately. Desktop Appearance is separate.' };
  }
  async cycle(direction) {
    const ids = this.list().map(p => p.id);
    const active = this.state().active;
    if (direction === 'random') {
      const choices = ids.filter(id => id !== active);
      return this.apply(choices[Math.floor(Math.random() * choices.length)] || ids[0]);
    }
    const current = ids.indexOf(active);
    return this.apply(ids[current < 0 ? 0 : (current + (direction === 'prev' ? -1 : 1) + ids.length) % ids.length]);
  }
  favorite(id = this.state().active) {
    if (!id) throw new Error('Choose a palette before saving a favorite');
    const palette = this.find(id);
    const state = this.state();
    const favorites = new Set(state.favorites);
    if (favorites.has(palette.id)) favorites.delete(palette.id); else favorites.add(palette.id);
    writePrivate(this.statePath, { ...state, favorites: [...favorites] });
    return { id: palette.id, favorite: favorites.has(palette.id) };
  }
  async importFile(arg, { replace = false, applySelection = true } = {}) {
    const path = arg ? expand(arg) : join(homedir(), 'Downloads', 'library.json');
    const text = readFileSync(path, 'utf8');
    const raw = JSON.parse(text);
    const incoming = parseLibrary(text);
    const single = !Array.isArray(raw.palettes);
    if (!single && !replace) return { confirmationRequired: true, path, palettes: incoming.palettes.length, favorites: incoming.favorites?.length || 0,
      instruction: 'This replaces your own palettes and favorites. Repeat import with --replace only when the user has authorized that replacement.' };
    const old = this.own();
    const library = single ? { ...old, palettes: [...old.palettes.filter(p => p.id !== incoming.palettes[0].id), ...incoming.palettes] } : incoming;
    // Preflight the generated files before committing the library.
    syncThemeFiles(mergePalettes(this.bundled, library.palettes), this.themesDir, this.manifestPath);
    writePrivate(this.libraryPath, library);
    const known = new Set(this.palettes().map(p => p.id));
    const previous = this.state();
    const requested = single ? incoming.palettes[0].id : incoming.active;
    const active = known.has(requested) ? requested : known.has(previous.active) ? previous.active : previous.active ? 'dracula' : undefined;
    writePrivate(this.statePath, { ...(active ? { active } : {}), favorites: (single ? previous.favorites : incoming.favorites || []).filter(id => known.has(id)) });
    return { imported: incoming.palettes.length, path, ...(active ? applySelection ? { applied: await this.apply(active) } : { active } : {}) };
  }
  exportFile(arg) {
    const downloads = join(homedir(), 'Downloads');
    const path = arg ? expand(arg) : join(existsSync(downloads) ? downloads : homedir(), 'palette-export.json');
    const state = this.state();
    const library = { format: 'pi-palette', version: 1, exportedAt: new Date().toISOString(), ...state, palettes: this.own().palettes };
    writePrivate(path, library);
    return { path, palettes: library.palettes.length, favorites: state.favorites.length };
  }
  status() {
    const auth = this.cloud.readAuth();
    return { ...this.state(), connected: Boolean(auth), ...(auth?.username ? { username: auth.username } : {}), site: this.cloud.site, libraryPath: this.libraryPath };
  }
  async sync({ applySelection = true } = {}) {
    const auth = this.cloud.readAuth();
    if (!auth) throw new Error('Not connected. Run $palette login first');
    try {
      const current = this.state();
      const sent = await this.cloud.api('/api/pi/library', { method: 'PUT', token: auth.token,
        body: { format: 'pi-palette', version: 1, favorites: current.favorites, palettes: this.own().palettes } });
      const data = await this.cloud.api('/api/pi/library', { token: auth.token });
      const remote = parseLibrary(JSON.stringify(data));
      const merged = mergePalettes(this.bundled, remote.palettes);
      const known = new Set(merged.map(p => p.id));
      const active = known.has(current.active) ? current.active : known.has(remote.active) ? remote.active : current.active ? 'dracula' : undefined;
      syncThemeFiles(merged, this.themesDir, this.manifestPath);
      writePrivate(this.libraryPath, remote);
      writePrivate(this.statePath, { ...(active ? { active } : {}), favorites: (remote.favorites || []).filter(id => known.has(id)) });
      if (active && applySelection) await this.apply(active);
      return { synced: true, palettes: remote.palettes.length, favorites: this.state().favorites.length, sent: sent?.saved ?? 0,
        ...(active ? { active } : {}), site: this.cloud.site };
    } catch (error) {
      if (error.status === 401) { this.cloud.forget(); throw new Error('This Codex was disconnected. Run $palette login again'); }
      throw error;
    }
  }
  desktop(id = this.state().active) { return desktopRecipe(this.find(id)); }
}
