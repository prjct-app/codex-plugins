import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { ID, readJson, writePrivate } from './library.mjs';

const mix = (a, b, amount) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - amount) + parseInt(b.slice(i, i + 2), 16) * amount).toString(16).padStart(2, '0')).join('').toUpperCase();
const xml = value => String(value).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

export function themeColors(palette) {
  const v = palette.vars;
  const vars = { surface: mix(v.canvas, v.text, .07), selected: mix(v.canvas, v.text, .22),
    synComment: mix(v.text, v.canvas, .55), synKeyword: v.highlight, synFunction: v.accent,
    synVariable: v.text, synString: v.success, synNumber: v.warning, synType: v.secondary,
    synOperator: v.highlight, synPunctuation: mix(v.text, v.canvas, .38), ...v };
  const color = (role, fallback) => {
    const ref = palette.colors?.[role];
    return typeof ref === 'string' && /^#[0-9a-f]{6}$/i.test(ref) ? ref.toUpperCase() : Object.hasOwn(vars, ref) ? vars[ref] : vars[fallback];
  };
  return { ...vars, comment: color('syntaxComment', 'synComment'), keyword: color('syntaxKeyword', 'synKeyword'),
    function: color('syntaxFunction', 'synFunction'), variable: color('syntaxVariable', 'synVariable'),
    string: color('syntaxString', 'synString'), number: color('syntaxNumber', 'synNumber'),
    type: color('syntaxType', 'synType'), operator: color('syntaxOperator', 'synOperator'), punctuation: color('syntaxPunctuation', 'synPunctuation') };
}

/** Codex's native TextMate syntax theme, rather than a Pi theme renamed as XML. */
export function toTmTheme(palette) {
  if (!ID.test(palette.id)) throw new Error('Invalid palette id');
  const c = themeColors(palette);
  const dict = values => '<dict>' + Object.entries(values).map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`).join('') + '</dict>';
  const scopes = [
    ['Comment', 'comment', c.comment], ['Keyword', 'keyword, storage', c.keyword],
    ['Function', 'entity.name.function, support.function', c.function], ['Variable', 'variable', c.variable],
    ['String', 'string', c.string], ['Number', 'constant.numeric, constant.language', c.number],
    ['Type', 'entity.name.type, entity.name.class, support.type, support.class', c.type],
    ['Operator', 'keyword.operator', c.operator], ['Punctuation', 'punctuation', c.punctuation],
    ['Added', 'markup.inserted', c.success], ['Removed', 'markup.deleted', c.error],
    ['Invalid', 'invalid', c.error], ['Heading', 'markup.heading', c.highlight],
  ];
  const global = dict({ background: c.canvas, foreground: c.text, caret: c.accent, selection: c.selected, lineHighlight: c.surface });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>name</key><string>${xml(`Palette · ${palette.label}`)}</string><key>settings</key><array><dict><key>settings</key>${global}</dict>${scopes.map(([name, scope, hex]) => `<dict><key>name</key><string>${name}</string><key>scope</key><string>${scope}</string><key>settings</key>${dict({ foreground: hex })}</dict>`).join('')}</array></dict></plist>\n`;
}

/** Only files recorded by this plugin can be overwritten or removed. */
export function syncThemeFiles(palettes, themesDir, manifestPath) {
  const manifest = readJson(manifestPath, []);
  if (!Array.isArray(manifest)) throw new Error('Invalid managed-theme manifest');
  const previous = new Set(manifest.filter(name => typeof name === 'string' && /^palette-[a-z0-9][a-z0-9-]{0,47}\.tmTheme$/.test(name)));
  const files = palettes.map(p => ({ name: `palette-${p.id}.tmTheme`, text: toTmTheme(p) }));
  for (const { name, text } of files) {
    const path = join(themesDir, name);
    if (existsSync(path) && !previous.has(name) && readFileSync(path, 'utf8') !== text) throw new Error(`A theme already exists at ${path}; it was not created by Palette`);
  }
  for (const { name, text } of files) {
    const path = join(themesDir, name);
    if (!existsSync(path) || readFileSync(path, 'utf8') !== text) writePrivate(path, text);
  }
  const wanted = new Set(files.map(file => file.name));
  for (const name of previous) {
    if (!wanted.has(name)) {
      try { unlinkSync(join(themesDir, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  writePrivate(manifestPath, [...wanted]);
  return files.map(file => join(themesDir, file.name));
}

/** Desktop's documented Appearance controls; this does not claim to apply them. */
export function desktopRecipe(palette) {
  const c = themeColors(palette);
  const rgb = [1, 3, 5].map(i => parseInt(c.canvas.slice(i, i + 2), 16));
  return { palette: palette.id, label: palette.label, base: rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 150 ? 'light' : 'dark',
    accent: c.accent, background: c.canvas, foreground: c.text,
    applied: false, instruction: 'In the desktop app, open Settings → Appearance and use these colors. CLI .tmTheme files only change syntax highlighting.' };
}
