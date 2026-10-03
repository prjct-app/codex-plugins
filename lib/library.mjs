import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const NAME = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const CORE = ['canvas', 'text', 'accent', 'secondary', 'highlight', 'success', 'warning', 'error'];
const GROUPS = ['original', 'editor', 'photo', 'community'];
const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function cleanPalette(value) {
  if (!object(value) || typeof value.id !== 'string' || !object(value.vars)) return undefined;
  const id = value.id.toLowerCase();
  if (!ID.test(id)) return undefined;
  const vars = Object.fromEntries(Object.entries(value.vars).slice(0, 80)
    .filter(([key, hex]) => NAME.test(key) && typeof hex === 'string' && HEX.test(hex))
    .map(([key, hex]) => [key, hex.toUpperCase()]));
  if (!CORE.every(key => Object.hasOwn(vars, key))) return undefined;
  const colors = object(value.colors) ? Object.fromEntries(Object.entries(value.colors)
    .filter(([key, ref]) => NAME.test(key) && typeof ref === 'string' && (ref === '' || HEX.test(ref) || NAME.test(ref)))) : undefined;
  const swatches = Array.isArray(value.swatches) ? value.swatches.filter(s => object(s) && typeof s.name === 'string' && typeof s.hex === 'string' && HEX.test(s.hex))
    .slice(0, 8).map(s => ({ name: s.name.slice(0, 24), hex: s.hex.toUpperCase() })) : undefined;
  return { id, label: typeof value.label === 'string' ? value.label.trim().slice(0, 40) || id : id, vars,
    ...(GROUPS.includes(value.group) ? { group: value.group } : {}),
    ...(typeof value.author === 'string' ? { author: value.author.slice(0, 40) } : {}),
    ...(colors ? { colors } : {}), ...(swatches?.length ? { swatches } : {}) };
}

export function parseLibrary(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Not JSON'); }
  if (!object(data)) throw new Error('Not a palette library');
  if (!Array.isArray(data.palettes) && object(data.vars) && typeof data.name === 'string') {
    data = { palettes: [{ id: data.name, label: data.name, vars: data.vars, colors: data.colors }] };
  }
  if (!Array.isArray(data.palettes)) throw new Error('Not a palette library');
  if (data.version !== undefined && data.version !== 1) throw new Error('Unsupported library version');
  if (data.format !== undefined && data.format !== 'pi-palette') throw new Error('Unsupported library format');
  const seen = new Set();
  const palettes = data.palettes.slice(0, 500).flatMap(p => {
    const clean = cleanPalette(p);
    if (!clean || seen.has(clean.id)) return [];
    seen.add(clean.id);
    return [clean];
  });
  if (data.palettes.length && !palettes.length) throw new Error('Library contains no valid palettes');
  const favorites = Array.isArray(data.favorites) ? [...new Set(data.favorites.filter(f => typeof f === 'string' && ID.test(f)))].slice(0, 500) : undefined;
  return { format: 'pi-palette', version: 1, palettes,
    ...(favorites ? { favorites } : {}), ...(typeof data.active === 'string' && ID.test(data.active) ? { active: data.active } : {}) };
}

export function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writePrivate(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temp, path);
    chmodSync(path, 0o600);
  } catch (error) {
    try { unlinkSync(temp); } catch { /* no temporary file */ }
    throw error;
  }
}

export function mergePalettes(bundled, own = []) {
  const ids = new Set(own.map(p => p.id));
  return [...own.map(p => ({ ...p, own: true })), ...bundled.filter(p => !ids.has(p.id))];
}
