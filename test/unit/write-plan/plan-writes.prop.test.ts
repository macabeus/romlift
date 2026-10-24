// planWrites converges (architecture §6.4, D17): over seeded random trees, disks, manifests and retained
// prefixes, a plan without errors, applied to an in-memory disk, leaves a disk whose re-plan with the new
// manifest is only keeps and the same manifest. A plan with an error is refused, so applying nothing and
// re-planning gives the same plan.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FileEntry } from '../../../src/core/emit/tree.ts';
import { applyTextEdits, planHasErrors, planWrites } from '../../../src/core/write-plan/plan-writes.ts';
import type { Manifest, WritePlan } from '../../../src/core/write-plan/types.ts';
import { xorshift32 } from '../../helpers/prng.ts';

function fakeHash(text: string): string {
  let out = '';
  for (let lane = 0; lane < 5; lane++) {
    let h = (0x811c9dc5 ^ (lane * 0x9e3779b9)) >>> 0;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out;
}

class Random {
  state: number;
  constructor(seed: number) {
    this.state = seed;
  }
  next(): number {
    this.state = xorshift32(this.state);
    return this.state;
  }
  below(n: number): number {
    return this.next() % n;
  }
  chance(percent: number): boolean {
    return this.below(100) < percent;
  }
  pick<T>(items: readonly T[]): T {
    const item = items[this.below(items.length)];
    if (item === undefined) throw new Error('pick from nothing');
    return item;
  }
}

const GENERATED = ['asm/a.s', 'asm/b.s', 'asm/m4a.s', 'asm/nonmatchings/m4a/F.s', 'asm/nonmatchings/main/G.s', 'data/main.s', 'ldscript.txt', 'symbols.ld'];
const SCAFFOLD = ['Makefile', 'README.md', 'include/macros.inc'];
const RECONCILED = ['src/main.c', 'src/m4a.c'];
const STRAY = ['asm/stray.s', 'data/old.s', 'notes.txt'];
const RETAINED = [[], ['asm/m4a.s', 'asm/nonmatchings/m4a/'], ['src/m4a.c']];

type Disk = Map<string, string>;

interface Case {
  readonly entries: readonly FileEntry[];
  readonly manifest: Manifest | null;
  readonly disk: Disk;
  readonly retained: readonly string[];
}

function randomCase(r: Random): Case {
  const disk: Disk = new Map();
  const entries: FileEntry[] = [];
  const files: Record<string, { sha1: string; writer: 'function' }> = {};
  const paths = [...GENERATED, ...SCAFFOLD, ...RECONCILED, ...STRAY];
  for (const path of paths) {
    if (r.chance(60)) disk.set(path, `${path} v${r.below(3)}`);
  }
  for (const path of GENERATED) {
    if (r.chance(75)) entries.push({ ownership: 'generated', path, text: `${path} v${r.below(3)}`, writer: 'function' });
    if (r.chance(50)) files[path] = { sha1: fakeHash(`${path} v${r.below(3)}`), writer: 'function' };
  }
  for (const path of SCAFFOLD) {
    if (r.chance(70)) entries.push({ ownership: 'scaffold', path, text: `${path} template`, writer: 'scaffold' });
  }
  for (const path of RECONCILED) {
    const text = disk.get(path);
    if (text === undefined || !r.chance(70)) continue;
    const at = r.below(text.length + 1);
    entries.push({ ownership: 'reconciled', path, baseSha1: fakeHash(text), edits: [{ start: at, end: at, text: '/* stub */', reason: 'add-stub' }] });
  }
  if (r.chance(10)) entries.push({ ownership: 'generated', path: 'notes.txt', text: 'generated notes', writer: 'objdiff' });
  if (r.chance(20)) files['asm/stray.s'] = { sha1: fakeHash('asm/stray.s v0'), writer: 'function' };
  const order = entries.map((entry) => ({ entry, key: r.next() })).sort((a, b) => a.key - b.key);
  return {
    entries: order.map((o) => o.entry),
    manifest: r.chance(25) ? null : { schema: 1, romlift: '1.0.0', files },
    disk,
    retained: r.pick(RETAINED),
  };
}

function snapshot(disk: Disk, c: Pick<Case, 'entries' | 'manifest'>): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const [path, text] of disk) out.set(path, fakeHash(text));
  for (const entry of c.entries) if (!out.has(entry.path)) out.set(entry.path, 'absent');
  for (const path of Object.keys(c.manifest?.files ?? {})) if (!out.has(path)) out.set(path, 'absent');
  return out;
}

function planFor(c: Case): WritePlan {
  const reconciledTexts = new Map<string, string>();
  for (const path of RECONCILED) {
    const text = c.disk.get(path);
    if (text !== undefined) reconciledTexts.set(path, text);
  }
  return planWrites({ entries: c.entries, manifest: c.manifest, disk: snapshot(c.disk, c), reconciledTexts, hash: fakeHash, retained: c.retained });
}

function apply(disk: Disk, p: WritePlan): Disk {
  const out = new Map(disk);
  for (const op of p.ops) {
    if (op.op === 'write' || op.op === 'edit') out.set(op.path, op.text);
    else if (op.op === 'delete') out.delete(op.path);
  }
  return out;
}

/** The reconciled entries a workflow plans against the applied texts: the stubs are in, so no edit is left. */
function settled(entries: readonly FileEntry[], disk: Disk): readonly FileEntry[] {
  return entries.map((e) => (e.ownership === 'reconciled' ? { ...e, baseSha1: fakeHash(disk.get(e.path) ?? ''), edits: [] } : e));
}

test('applying a plan then re-planning gives only keeps and the same manifest (500 seeded cases)', () => {
  const r = new Random(0x5eed_3d01);
  let applied = 0;
  let refused = 0;
  for (let i = 0; i < 500; i++) {
    const c = randomCase(r);
    const first = planFor(c);
    if (planHasErrors(first)) {
      refused++;
      assert.deepEqual(planFor(c), first, `case ${i}: a refused plan re-plans the same`);
      continue;
    }
    applied++;
    const disk = apply(c.disk, first);
    const again = planFor({ ...c, entries: settled(c.entries, disk), manifest: first.manifest, disk });
    assert.deepEqual(again.ops.filter((op) => op.op !== 'keep'), [], `case ${i}: the re-plan changes nothing`);
    assert.deepEqual(again.manifest, first.manifest, `case ${i}: the manifest is stable`);
    assert.ok(!planHasErrors(again), `case ${i}: the re-plan has no error`);
    for (const op of first.ops) {
      if (op.op === 'edit') assert.equal(disk.get(op.path), op.text);
      if (op.op === 'delete') assert.ok(!c.retained.some((p) => op.path === p || (p.endsWith('/') && op.path.startsWith(p))));
    }
    for (const prefix of c.retained) {
      for (const [path, text] of c.disk) {
        if (path === prefix || (prefix.endsWith('/') && path.startsWith(prefix))) assert.equal(disk.get(path), text, `case ${i}: retained ${path} untouched`);
      }
    }
  }
  assert.ok(applied > 100 && refused > 10, `applied ${applied}, refused ${refused}: both branches are exercised`);
});

test('applyTextEdits equals splicing edits in from the end', () => {
  const r = new Random(0x0bad_cafe);
  for (let i = 0; i < 300; i++) {
    const text = 'abcdefghijklmnopqrstuvwxyz'.slice(0, r.below(27));
    const cuts = Array.from({ length: r.below(5) * 2 }, () => r.below(text.length + 1)).sort((a, b) => a - b);
    const edits = [];
    for (let k = 0; k + 1 < cuts.length; k += 2) edits.push({ start: cuts[k] ?? 0, end: cuts[k + 1] ?? 0, text: `<${k}>`, reason: 'add-stub' as const });
    let expected = text;
    for (const e of [...edits].reverse()) expected = expected.slice(0, e.start) + e.text + expected.slice(e.end);
    const shuffled = edits.map((e) => ({ e, key: r.next() })).sort((a, b) => a.key - b.key).map((x) => x.e);
    // equal-offset insertions keep their given order, so only shuffle when no two edits share a start
    const distinct = new Set(edits.map((e) => e.start)).size === edits.length;
    assert.equal(applyTextEdits(text, distinct ? shuffled : edits), expected);
  }
});
