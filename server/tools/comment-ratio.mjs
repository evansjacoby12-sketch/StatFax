#!/usr/bin/env node
/**
 * comment-ratio.mjs — measure code-vs-comment lines per file
 *
 * Crude metric: counts blank-stripped non-comment lines as "code" and
 * `//`, `*`, `/*` lines as "comments". Misses inline trailing comments;
 * a perfectly-commented terse line counts as 0 comments. So this is a
 * floor on density, not a measure of comment QUALITY. Use it to find
 * files that LOOK unfamiliar to a new contributor, not to grade
 * existing comments.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    if (f.startsWith('.') || f === 'node_modules' || f === 'dist' || f === '.expo' || f === 'ios' || f === 'android') continue;
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|jsx)$/.test(f) && !f.endsWith('.test.js')) out.push(p);
  }
  return out;
}

const files = walk('src').concat(walk('server'));
const rows = files.map(p => {
  const lines = readFileSync(p, 'utf-8').split('\n');
  let code = 0, comments = 0;
  for (const l of lines) {
    const t = l.trim();
    if (!t) continue;
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) comments++;
    else code++;
  }
  const ratio = code === 0 ? 0 : comments / code;
  return { path: p.replace(/\\/g, '/'), code, comments, ratio };
}).filter(r => r.code >= 50).sort((a, b) => a.ratio - b.ratio);

const allCode = rows.reduce((s, r) => s + r.code, 0);
const allCom  = rows.reduce((s, r) => s + r.comments, 0);

console.log(`Total: ${files.length} files (${rows.length} with ≥50 code lines)`);
console.log(`Aggregate: ${allCode} code lines · ${allCom} comment lines · ratio ${(allCom / allCode).toFixed(2)}`);
console.log();
console.log('=== BOTTOM 15 (lowest comment density) ===');
for (const r of rows.slice(0, 15)) {
  console.log(`${r.ratio.toFixed(2).padStart(5)}  ${String(r.comments).padStart(4)}c/${String(r.code).padEnd(4)}  ${r.path}`);
}
console.log();
console.log('=== TOP 5 (highest density) ===');
for (const r of rows.slice(-5)) {
  console.log(`${r.ratio.toFixed(2).padStart(5)}  ${String(r.comments).padStart(4)}c/${String(r.code).padEnd(4)}  ${r.path}`);
}
