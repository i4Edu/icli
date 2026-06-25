#!/usr/bin/env node
/**
 * Capture real CLI output and render it to SVG terminal screenshots.
 * No external deps: includes a small ANSI SGR → SVG renderer.
 *
 * Usage: node scripts/screenshots.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT_DIR = path.join('docs', 'screenshots');
mkdirSync(OUT_DIR, { recursive: true });

// ---------------- ANSI → SVG ----------------

const PALETTE_16 = [
  '#1e1e1e', '#cd3131', '#0dbc79', '#e5e510',
  '#2472c8', '#bc3fbc', '#11a8cd', '#cccccc',
  '#666666', '#f14c4c', '#23d18b', '#f5f543',
  '#3b8eea', '#d670d6', '#29b8db', '#ffffff',
];

const NAMED = {
  // truecolor hexes we use for brand/badge — handled in 24-bit path
};

function parseSGR(codes, state) {
  let i = 0;
  while (i < codes.length) {
    const c = codes[i];
    if (c === 0) {
      state.fg = '#dcdcdc';
      state.bg = null;
      state.bold = false;
      state.italic = false;
      state.dim = false;
      i++;
      continue;
    }
    if (c === 1) { state.bold = true; i++; continue; }
    if (c === 2) { state.dim = true; i++; continue; }
    if (c === 3) { state.italic = true; i++; continue; }
    if (c === 22) { state.bold = false; state.dim = false; i++; continue; }
    if (c === 23) { state.italic = false; i++; continue; }
    if (c === 39) { state.fg = '#dcdcdc'; i++; continue; }
    if (c === 49) { state.bg = null; i++; continue; }
    if (c >= 30 && c <= 37) { state.fg = PALETTE_16[c - 30]; i++; continue; }
    if (c >= 90 && c <= 97) { state.fg = PALETTE_16[c - 90 + 8]; i++; continue; }
    if (c >= 40 && c <= 47) { state.bg = PALETTE_16[c - 40]; i++; continue; }
    if (c >= 100 && c <= 107) { state.bg = PALETTE_16[c - 100 + 8]; i++; continue; }
    if (c === 38 || c === 48) {
      const kind = c === 38 ? 'fg' : 'bg';
      const mode = codes[i + 1];
      if (mode === 5) {
        const n = codes[i + 2] ?? 0;
        state[kind] = palette256(n);
        i += 3;
        continue;
      }
      if (mode === 2) {
        const r = codes[i + 2] ?? 0;
        const g = codes[i + 3] ?? 0;
        const b = codes[i + 4] ?? 0;
        state[kind] = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
        i += 5;
        continue;
      }
    }
    i++;
  }
}

function palette256(n) {
  if (n < 16) return PALETTE_16[n];
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `#${[v, v, v].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
  }
  const i = n - 16;
  const r = Math.floor(i / 36);
  const g = Math.floor((i % 36) / 6);
  const b = i % 6;
  const c = (x) => (x === 0 ? 0 : 55 + x * 40);
  return `#${[c(r), c(g), c(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function ansiToSegments(text) {
  const segs = [];
  const state = { fg: '#dcdcdc', bg: null, bold: false, italic: false, dim: false };
  const re = /\x1b\[([\d;]*)m/g;
  let pos = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > pos) segs.push({ text: text.slice(pos, m.index), ...state });
    const codes = m[1].split(';').filter(Boolean).map(Number);
    if (!codes.length) codes.push(0);
    parseSGR(codes, state);
    pos = m.index + m[0].length;
  }
  if (pos < text.length) segs.push({ text: text.slice(pos), ...state });
  // strip remaining escape sequences (cursor, OSC, etc.)
  for (const s of segs) s.text = s.text.replace(/\x1b\][^\x07]*\x07|\x1b\[[?]?[\d;]*[A-Za-z]/g, '');
  return segs;
}

function escapeXML(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSVG({ title, text, columns = 92 }) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\x1b\[K/g, '').split('\n');
  const charW = 8.4;
  const lineH = 18;
  const padX = 16;
  const padY = 36;
  const titleH = 28;
  const width = Math.max(560, padX * 2 + columns * charW);
  const height = padY + titleH + lines.length * lineH + 12;

  const rows = lines.map((line, idx) => {
    const segs = ansiToSegments(line);
    let x = padX;
    const tspans = segs
      .map((seg) => {
        if (!seg.text) return '';
        const w = seg.text.length * charW;
        const bg = seg.bg
          ? `<rect x="${x.toFixed(2)}" y="${(padY + titleH + idx * lineH - 13).toFixed(2)}" width="${w.toFixed(2)}" height="${lineH}" fill="${seg.bg}"/>`
          : '';
        const fill = seg.fg || '#dcdcdc';
        const fw = seg.bold ? 'bold' : 'normal';
        const fs = seg.italic ? 'italic' : 'normal';
        const opacity = seg.dim ? 0.55 : 1;
        const span = `<tspan x="${x.toFixed(2)}" font-weight="${fw}" font-style="${fs}" fill="${fill}" opacity="${opacity}">${escapeXML(seg.text)}</tspan>`;
        const out = bg + span;
        x += w;
        return out;
      })
      .join('');
    return `<text y="${padY + titleH + idx * lineH}" font-family="ui-monospace,Consolas,Menlo,monospace" font-size="13" xml:space="preserve">${tspans || '<tspan> </tspan>'}</text>`;
  }).join('\n  ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXML(title)}">
  <defs>
    <linearGradient id="bar" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#3a3a3a"/>
      <stop offset="1" stop-color="#262626"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="8" ry="8" fill="#1e1e1e"/>
  <rect width="${width}" height="28" rx="8" ry="8" fill="url(#bar)"/>
  <circle cx="16" cy="14" r="6" fill="#ff5f57"/>
  <circle cx="36" cy="14" r="6" fill="#febc2e"/>
  <circle cx="56" cy="14" r="6" fill="#28c840"/>
  <text x="${width / 2}" y="19" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="12" fill="#bdbdbd">${escapeXML(title)}</text>
  ${rows}
</svg>
`;
}

// ---------------- Capture ----------------

const env = { ...process.env, FORCE_COLOR: '3', NO_COLOR: undefined, CI: undefined };

function capture(args, extraEnv = {}) {
  const r = spawnSync('node', ['bin/icopilot.js', ...args], {
    encoding: 'utf8',
    env: { ...env, ...extraEnv },
  });
  return (r.stdout || '') + (r.stderr || '');
}

const SHOTS = [
  {
    file: 'help.svg',
    title: '› icopilot --help',
    text: '$ icopilot --help\n' + capture(['--help']),
    columns: 96,
  },
  {
    file: 'version.svg',
    title: '› icopilot --version',
    text: '$ icopilot --version\n' + capture(['--version']),
    columns: 60,
  },
  {
    file: 'missing-token.svg',
    title: '› icopilot -p "hi"   (no GITHUB_TOKEN)',
    text: '$ icopilot -p "hi"\n' + capture(['-p', 'hi'], { GITHUB_TOKEN: '', ICOPILOT_TOKEN: '' }),
    columns: 96,
  },
];

// Banner: import the function directly and call it for a realistic capture.
{
  const { banner } = await import(pathToFileURL(path.resolve('dist/ui/theme.js')).href);
  const { theme } = await import(pathToFileURL(path.resolve('dist/ui/theme.js')).href);
  const lines = [];
  lines.push(banner('0.1.0', 'gpt-4o-mini'));
  lines.push(`${theme.badge('ASK')} ${theme.user('›')} Refactor @src/api/github-models.ts to add caching`);
  lines.push(theme.dim('  injected 1 file ref: src/api/github-models.ts'));
  lines.push('');
  lines.push(`${theme.assistant('●')} I'll add an in-memory LRU keyed by ` + theme.hl('(model, messages)') + '.');
  lines.push('');
  lines.push(theme.badge('SHELL'));
  lines.push(theme.dim('  Run the test suite to confirm the cache hit path.'));
  lines.push(theme.hl('  $ ') + 'npm test');
  lines.push(theme.dim(`  cwd: ${process.cwd()}`));
  lines.push('  ' + theme.ok('?') + ' Run this command? ' + theme.dim('(y/N)'));
  lines.push('');
  lines.push(theme.badge('WRITE') + ' src/api/cache.ts');
  lines.push(theme.dim('--- empty'));
  lines.push(theme.dim('+++ proposed'));
  lines.push(theme.hl('@@ -0,0 +1,12 @@'));
  lines.push(theme.ok('+export class LRU<K, V> {'));
  lines.push(theme.ok('+  constructor(private max = 128) {}'));
  lines.push(theme.ok('+  // …'));
  lines.push(theme.ok('+}'));
  lines.push('');
  lines.push(theme.warn('⚠  context 78% full — run /compact to free space.'));
  SHOTS.push({
    file: 'repl.svg',
    title: '› icopilot   (interactive REPL)',
    text: lines.join('\n'),
    columns: 96,
  });
}

for (const shot of SHOTS) {
  const svg = renderSVG(shot);
  const out = path.join(OUT_DIR, shot.file);
  writeFileSync(out, svg, 'utf8');
  console.log(`wrote ${out} (${svg.length} bytes)`);
}
