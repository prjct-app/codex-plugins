#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseLibrary } from '../lib/library.mjs';
import { toTmTheme } from '../lib/themes.mjs';
import { readFileSync } from 'node:fs';

const palettes = parseLibrary(readFileSync(new URL('../assets/palettes.json', import.meta.url), 'utf8')).palettes;
const target = new URL('../themes/', import.meta.url);
mkdirSync(target, { recursive: true });
for (const palette of palettes) writeFileSync(new URL(`palette-${palette.id}.tmTheme`, target), toTmTheme(palette));
console.log(`Generated ${palettes.length} native Codex syntax themes`);
