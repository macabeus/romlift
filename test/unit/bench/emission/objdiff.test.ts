// bench/src/objdiff.ts: the pure verdict on the committed objdiff-cli recording (test/fixtures/objdiff), where
// base.s misnames PoolFunc's pool word (gOther for gTarget) and the gate must fail on it while SectFunc's
// section-symbol target is reported only; the failure kinds, the example cap and the summaries; the ELF
// names the objdiff base takes (namedConfig); objdiff-cli's complaint without paths; the pool's order.
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseElf, romFromBytes, type ElfSymbol, type FunctionConfig, type RomliftConfig } from 'romlift';

import {
  assemblerError,
  EXAMPLES_PER_KIND,
  functionDifferences,
  linkedSummary,
  namedConfig,
  objdiffVerdict,
  pooled,
  REPORTED_ONLY,
  resolvedCall,
  symbolIndex,
  toolError,
  unlinkedSummary,
  type ComparedFunction,
} from '../../../../bench/src/objdiff.ts';
import { parseObjdiffDiff, type FunctionDiff } from '../../../../bench/src/objdiff-cli.ts';
import { objectFor, objectRelocations } from '../../../../bench/src/objects.ts';
import { withTempDir } from '../fixtures.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures', 'objdiff');

async function recorded(): Promise<readonly FunctionDiff[]> {
  const bytes = new Uint8Array(await readFile(join(FIXTURES, 'reference.o')));
  const elf = parseElf(bytes);
  const relocations = objectRelocations(bytes);
  assert.ok(elf.ok && relocations.ok);
  const parsed = parseObjdiffDiff(JSON.parse(await readFile(join(FIXTURES, 'diff.json'), 'utf8')) as unknown, { symbols: elf.value.symbols, relocations: relocations.value });
  assert.ok(parsed.ok);
  return parsed.value.functions;
}

async function comparedNamed(name: string): Promise<ComparedFunction> {
  return { name, diff: (await recorded()).find((f) => f.name === name) };
}

test('the misnamed pool word is a gated relocation difference: the verdict fails', async () => {
  const pool = await comparedNamed('PoolFunc');
  assert.deepEqual(functionDifferences(pool), [{ function: 'PoolFunc', kind: 'relocation', detail: '+0x1c R_ARM_ABS32: gTarget | gOther' }]);
  const verdict = objdiffVerdict([pool]);
  assert.equal(verdict.pass, false);
  assert.deepEqual(verdict.differences, { relocation: 1 });
});

test('the recording: an identical function passes, an instruction differs, a section-symbol target is reported only', async () => {
  const [same, insn, sect] = await Promise.all(['SameFunc', 'InsnFunc', 'SectFunc'].map(comparedNamed));
  assert.ok(same !== undefined && insn !== undefined && sect !== undefined);
  assert.deepEqual(functionDifferences(same), []);
  assert.deepEqual(functionDifferences(insn).map((d) => d.kind), ['instruction']);
  assert.match(functionDifferences(insn)[0]?.detail ?? '', /^\+0xe replace: add r0, r1 \| /);
  assert.deepEqual(functionDifferences(sect), [{ function: 'SectFunc', kind: REPORTED_ONLY, detail: '+0x28 R_ARM_ABS32: section .rodata | sectData' }]);
  assert.deepEqual(objdiffVerdict([same]), { scored: 1, differences: {}, examples: [], pass: true });
  const reported = objdiffVerdict([same, sect]);
  assert.equal(reported.pass, true, 'unnamed-target is reported, not gated');
  assert.deepEqual(reported.differences, { 'unnamed-target': 1 });
  const all = objdiffVerdict(await Promise.all(['InsnFunc', 'PoolFunc', 'SameFunc', 'SectFunc'].map(comparedNamed)));
  assert.equal(all.pass, false);
  assert.deepEqual(all.differences, { instruction: 1, relocation: 1, 'unnamed-target': 1 });
  assert.deepEqual(all.examples.map((e) => [e.kind, e.function]), [['instruction', 'InsnFunc'], ['relocation', 'PoolFunc'], ['unnamed-target', 'SectFunc']]);
});

const PAIRED: FunctionDiff = { name: 'f', offset: 0, size: 8, paired: true, matchPercent: 100, instructionDifferences: [], relocationDifferences: [] };

test('every other kind: unpaired, unlisted, missing relocation, base-only relocation, score, and the failures', () => {
  const kinds = (c: ComparedFunction): string[] => functionDifferences(c).map((d) => d.kind);
  assert.deepEqual(kinds({ name: 'f', diff: undefined }), ['missing-symbol']);
  assert.deepEqual(kinds({ name: 'f', diff: { ...PAIRED, paired: false, matchPercent: null } }), ['missing-symbol']);
  const plain = { offset: 4, kind: 'arg-mismatch' as const, type: 'R_ARM_ABS32', reference: { name: 'gRam', symbol: 'named' as const }, base: null };
  assert.deepEqual(functionDifferences({ name: 'f', diff: { ...PAIRED, matchPercent: 99, relocationDifferences: [plain] } }), [
    { function: 'f', kind: 'missing-relocation', detail: '+0x4 R_ARM_ABS32: gRam | a plain value' },
  ]);
  assert.deepEqual(kinds({ name: 'f', diff: { ...PAIRED, matchPercent: 99, relocationDifferences: [{ ...plain, reference: null, base: 'gX' }] } }), ['relocation']);
  assert.deepEqual(kinds({ name: 'f', diff: { ...PAIRED, matchPercent: 99.5 } }), ['score']);
  for (const kind of ['missing-symbol', 'assemble', 'tool'] as const) assert.deepEqual(functionDifferences({ name: 'f', failure: { kind, detail: 'why' } }), [{ function: 'f', kind, detail: 'why' }]);
});

test('the verdict: counts per kind in code-unit order, at most EXAMPLES_PER_KIND examples of each, nothing scored fails', () => {
  const compared: ComparedFunction[] = Array.from({ length: 7 }, (_, i) => ({ name: `f${i}`, failure: { kind: 'tool' as const, detail: 'x' } }));
  compared.push({ name: 'g', failure: { kind: 'assemble', detail: 'y' } });
  const verdict = objdiffVerdict(compared);
  assert.deepEqual(verdict.differences, { assemble: 1, tool: 7 });
  assert.deepEqual(Object.keys(verdict.differences), ['assemble', 'tool']);
  assert.equal(verdict.examples.filter((e) => e.kind === 'tool').length, EXAMPLES_PER_KIND);
  assert.deepEqual(verdict.examples[0], { function: 'g', kind: 'assemble', detail: 'y' });
  assert.equal(verdict.scored, 8);
  assert.equal(objdiffVerdict([]).pass, false);
  assert.deepEqual(linkedSummary(objdiffVerdict([])), { linked: true, scored: 0, differences: {}, examples: [] });
  assert.deepEqual(unlinkedSummary(), { linked: false, scored: 0, differences: {}, examples: [] });
});

function symbol(name: string, addr: number, type: ElfSymbol['type'], bind: ElfSymbol['bind'] = 'global', sectionName: string | null = '.text'): ElfSymbol {
  return { name, value: addr, addr, size: 4, type, bind, thumb: false, sectionIndex: sectionName === null ? 0xfff1 : 1, ...(sectionName === null ? {} : { sectionName }) };
}

test('namedConfig: functions take the ELF FUNC name, data outside every extent and RAM a section defines become symbols, an absolute one does not, a shared name is given to neither', () => {
  const rom = romFromBytes(new Uint8Array(0x200), 'f'.repeat(40));
  const f = (name: string): FunctionConfig => ({ name, mode: 'thumb', aliases: ['old'] });
  const config: RomliftConfig = {
    schema: 1,
    rom: { path: 'baserom.gba', sha1: 'f'.repeat(40) },
    build: { name: 'rom', compiler: 'agbcc' },
    signatures: { enabled: false },
    modules: [],
    functions: new Map([
      [0x0800_0100, f('sub_08000100')],
      [0x0800_0120, f('sub_08000120')],
      [0x0800_0140, f('sub_08000140')],
    ]),
    symbols: new Map(),
    overrides: [],
  };
  const symbols = [
    symbol('LocalName', 0x0800_0100, 'func', 'local'),
    symbol('AgbMain', 0x0800_0100, 'func'),
    symbol('twice', 0x0800_0120, 'func'),
    symbol('twice', 0x0800_0180, 'object'),
    symbol('$t', 0x0800_0140, 'notype'),
    symbol('gTable', 0x0800_01a0, 'object'),
    symbol('label_in_code', 0x0800_0104, 'notype'),
    symbol('gRam', 0x0300_0000, 'object', 'global', '.bss'),
    symbol('REG_IE', 0x0400_0200, 'notype', 'global', null),
    symbol('.Lpool', 0x0800_01b0, 'notype'),
    symbol('bad name', 0x0800_01c0, 'object'),
    symbol('sNoType', 0x0800_01d0, 'notype'),
  ];
  const named = namedConfig(config, rom, symbols, [{ entry: 0x0800_0100, end: 0x0800_0110 }]);
  assert.deepEqual([...named.functions].map(([a, c]) => [a, c.name, c.aliases]), [
    [0x0800_0100, 'AgbMain', []],
    [0x0800_0120, 'sub_08000120', ['old']],
    [0x0800_0140, 'sub_08000140', ['old']],
  ]);
  assert.deepEqual([...named.symbols].map(([a, s]) => [a, s.name]), [
    [0x0800_01a0, 'gTable'],
    [0x0300_0000, 'gRam'],
    [0x0800_01d0, 'sNoType'],
  ]);
});

test('symbolIndex: a stale copy makes every name ambiguous; only the linked objects define names when the map is given', async () => {
  await withTempDir('romlift-symbol-index-', async (dir) => {
    for (const sub of ['src', 'old']) {
      await mkdir(join(dir, sub), { recursive: true });
      await copyFile(join(FIXTURES, 'reference.o'), join(dir, sub, 'reference.o'));
    }
    assert.equal(objectFor(await symbolIndex(dir, undefined), 'PoolFunc'), undefined);
    assert.equal(objectFor(await symbolIndex(dir, new Set(['src/reference.o'])), 'PoolFunc'), 'src/reference.o');
  });
});

test('resolvedCall: the reference resolved a bl to a function of its own object at the offset the base relocates against', () => {
  const functions = new Map([['PutAnim', 0x7c]]);
  assert.equal(resolvedCall('arg-mismatch', 'bl 0x7c', 'bl PutAnim-0x4', functions), 'PutAnim');
  assert.equal(resolvedCall('arg-mismatch', 'bl 0x80', 'bl PutAnim-0x4', functions), undefined, 'another offset is another callee');
  assert.equal(resolvedCall('arg-mismatch', 'bl 0x7c', 'bl Other-0x4', functions), undefined);
  assert.equal(resolvedCall('replace', 'bl 0x7c', 'bl PutAnim-0x4', functions), undefined);
  assert.equal(resolvedCall('arg-mismatch', 'bl 0x7c', 'bl PutAnim-0x4', undefined), undefined);
  const diff: FunctionDiff = { ...PAIRED, matchPercent: 99, instructionDifferences: [{ offset: 0x68, kind: 'arg-mismatch', reference: 'bl 0x7c', base: 'bl PutAnim-0x4' }] };
  assert.deepEqual(functionDifferences({ name: 'f', diff, referenceFunctions: functions }), [
    { function: 'f', kind: 'resolved-call', detail: '+0x68 arg-mismatch: bl 0x7c | bl PutAnim-0x4 (PutAnim is at that offset of the reference object)' },
  ]);
  assert.deepEqual(functionDifferences({ name: 'f', diff }).map((d) => d.kind), ['instruction']);
});

test("assemblerError keeps the assembler's first error line", () => {
  assert.equal(assemblerError('source.s: Assembler messages:\nsource.s:3: Error: bad instruction `frob\'\nsource.s:4: Error: other\n'), "source.s:3: Error: bad instruction `frob'");
  assert.equal(assemblerError('source.s: Assembler messages:\n'), 'source.s: Assembler messages:');
  assert.equal(assemblerError(''), undefined);
});

test("toolError keeps objdiff-cli's complaint without the paths of the pair", () => {
  assert.equal(toolError('objdiff-cli exited 1 on /a/ref.o and /tmp/x/3.o: Failed: Invalid instruction size 1'), 'Invalid instruction size 1');
  assert.equal(toolError('objdiff-cli printed no JSON: bad\nmore'), 'objdiff-cli printed no JSON: bad');
});

test('pooled keeps the order of its items and never runs more than its limit at once', async () => {
  let running = 0;
  let peak = 0;
  const out = await pooled([5, 1, 4, 2, 3], 2, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, n));
    running--;
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30]);
  assert.equal(peak, 2);
  assert.deepEqual(await pooled([], 4, async (n: number) => n), []);
});
