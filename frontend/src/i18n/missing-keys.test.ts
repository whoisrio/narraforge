/**
 * I1 guard test: every literal i18n key referenced in source must exist in both packs.
 * Scans src for t('...') / translate('...') / staticT('...') calls and resolves
 * each key against the real zh-CN / en-US message objects.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { zhCN } from './zh-CN';
import { enUS } from './en-US';

const SRC_ROOT = join(__dirname, '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(p));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.')) {
      out.push(p);
    }
  }
  return out;
}

const KEY_CALL_RE = /(?:\bt|translate|staticT)\(\s*['"`]([a-zA-Z0-9_.]+)['"`]/g;

function collectReferencedKeys(): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  for (const file of walk(SRC_ROOT)) {
    if (relative(SRC_ROOT, file).startsWith('i18n')) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(KEY_CALL_RE)) {
      const key = m[1];
      const line = src.slice(0, m.index).split('\n').length;
      const loc = `${relative(SRC_ROOT, file)}:${line}`;
      refs.set(key, [...(refs.get(key) ?? []), loc]);
    }
  }
  return refs;
}

function resolveKey(pack: unknown, key: string): boolean {
  let node: unknown = pack;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string';
}

describe('i18n referenced-key integrity (I1)', () => {
  const refs = collectReferencedKeys();

  it('finds referenced keys (sanity)', () => {
    expect(refs.size).toBeGreaterThan(500);
  });

  it('every referenced key exists in zh-CN', () => {
    const missing = [...refs.entries()].filter(([key]) => !resolveKey(zhCN, key));
    const report = missing.map(([k, locs]) => `${k} -> ${locs.slice(0, 3).join(', ')}`);
    expect(report).toEqual([]);
  });

  it('every referenced key exists in en-US', () => {
    const missing = [...refs.entries()].filter(([key]) => !resolveKey(enUS, key));
    const report = missing.map(([k, locs]) => `${k} -> ${locs.slice(0, 3).join(', ')}`);
    expect(report).toEqual([]);
  });
});
