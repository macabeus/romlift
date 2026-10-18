import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifier, classifyFalseEntry, classifyMiss, gluedWhere, labelClause, type ClassifyInput, type FoundFunction, type TruthFunction } from '../../../bench/src/classify.ts';

// One hand-built layout: startup below 0x08000200, then F at 0x08000200..0x08000300 (an ELF FUNC whose
// ELF size stops at 0x08000280, as a hand-written parent's does), G at 0x08000400 (not an ELF FUNC).
const STARTUP_END = 0x08000200;

function found(overrides: Partial<FoundFunction> = {}): FoundFunction {
  return {
    entry: 0x08000200,
    mode: 'thumb',
    extent: { start: 0x08000200, end: 0x08000300 },
    holes: [],
    branchTargets: [],
    noReturnSites: [],
    origin: 'call',
    ...overrides,
  };
}

const truth = (addr: number, size: number): TruthFunction => ({ addr, size, thumb: true });

function input(found: readonly FoundFunction[], overrides: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    found,
    truth: [truth(0x08000000, 0x100), truth(0x08000200, 0x80), truth(0x08000240, 0x20), truth(0x080002F0, 0x10)],
    startupEnd: STARTUP_END,
    isPrologue: () => false,
    ...overrides,
  };
}

test('a miss right after a never-returning bl of F is a label candidate (a)', () => {
  const cx = classifier(input([found({ noReturnSites: [{ site: 0x0800023C, size: 4 }] })]));
  assert.equal(labelClause(cx, 0x08000240), 'after-no-return');
  assert.equal(classifyMiss(cx, 0x08000240), 'label-candidate');
});

test('(a) allows zero padding to the next 4-byte boundary, and no further', () => {
  const swi = found({ noReturnSites: [{ site: 0x0800023C, size: 2 }] });
  assert.equal(classifyMiss(classifier(input([swi])), 0x08000240), 'label-candidate');
  const bl = found({ noReturnSites: [{ site: 0x08000238, size: 4 }] });
  assert.equal(classifyMiss(classifier(input([bl])), 0x08000240), 'glued');
});

test('a b/bcc target inside F is a label candidate (b)', () => {
  const cx = classifier(input([found({ branchTargets: [0x08000240] })]));
  assert.equal(labelClause(cx, 0x08000240), 'branch-target');
  assert.equal(classifyMiss(cx, 0x08000240), 'label-candidate');
});

test('a bl target is never a label: listed only as a call target it is glued, and a call target vetoes (b)', () => {
  assert.equal(classifyMiss(classifier(input([found({ callTargets: [0x08000240] })])), 0x08000240), 'glued');
  assert.equal(classifyMiss(classifier(input([found({ branchTargets: [0x08000240], callTargets: [0x08000240] })])), 0x08000240), 'glued');
});

test('a miss inside one of F\'s holes is a label candidate (c), the hole being half-open', () => {
  const f = found({ holes: [{ start: 0x08000240, end: 0x08000260 }] });
  const cx = classifier(input([f]));
  assert.equal(labelClause(cx, 0x08000240), 'in-hole');
  assert.equal(classifyMiss(cx, 0x08000250), 'label-candidate');
  assert.equal(classifyMiss(cx, 0x08000260), 'glued');
});

test('the suppressed-split case: a real function swallowed by its neighbour is glued', () => {
  // The split before 0x08000240 was suppressed, so F runs over it; no clause gives it a label's meaning.
  const cx = classifier(input([found()]));
  assert.equal(labelClause(cx, 0x08000240), undefined);
  assert.equal(classifyMiss(cx, 0x08000240), 'glued');
});

test('a miss that opens with the prologue is glued even when a clause holds', () => {
  const f = found({ branchTargets: [0x08000240], holes: [{ start: 0x08000240, end: 0x08000260 }], noReturnSites: [{ site: 0x0800023C, size: 4 }] });
  const cx = classifier(input([f], { isPrologue: (addr) => addr === 0x08000240 }));
  assert.equal(classifyMiss(cx, 0x08000240), 'glued');
});

test('F must have an ELF FUNC entry', () => {
  const g = found({ entry: 0x08000210, extent: { start: 0x08000210, end: 0x08000300 }, branchTargets: [0x08000240] });
  assert.equal(classifyMiss(classifier(input([g])), 0x08000240), 'glued');
});

test('M must lie strictly inside the extent: not at its start, not at or past its end', () => {
  const f = found({ branchTargets: [0x08000200, 0x08000300], holes: [{ start: 0x08000300, end: 0x08000310 }] });
  const cx = classifier(input([f]));
  assert.equal(classifyMiss(cx, 0x08000300), 'glued');
  const g = found({ entry: 0x080002F0, extent: { start: 0x080002F0, end: 0x08000300 }, branchTargets: [0x080002F0] });
  assert.equal(classifyMiss(classifier(input([g])), 0x080002F0), 'glued');
});

test('a clause of a function that does not contain M does not count', () => {
  const f = found({ extent: { start: 0x08000200, end: 0x08000230 }, branchTargets: [0x08000240] });
  assert.equal(classifyMiss(classifier(input([f])), 0x08000240), 'glued');
});

test('any containing function with an ELF entry and a clause makes a label; the clause is the lowest entry\'s', () => {
  const outer = found({ holes: [{ start: 0x08000240, end: 0x08000260 }] });
  const nested = found({ entry: 0x08000240, extent: { start: 0x08000240, end: 0x08000300 }, branchTargets: [0x08000250] });
  const later = found({ entry: 0x080002F0, extent: { start: 0x080002F0, end: 0x08000400 }, branchTargets: [0x08000300] });
  const cx = classifier(input([later, nested, outer]));
  assert.equal(labelClause(cx, 0x08000250), 'in-hole');
  assert.equal(labelClause(cx, 0x08000300), 'branch-target');
});

test('false entries: startup, veneer, adr-callback, inside-elf-function, other, in that precedence', () => {
  const cx = classifier(input([]));
  assert.equal(classifyFalseEntry(cx, { entry: 0x08000100, origin: 'veneer' }), 'startup');
  assert.equal(classifyFalseEntry(cx, { entry: 0x08000250, origin: 'veneer' }), 'veneer');
  assert.equal(classifyFalseEntry(cx, { entry: 0x08000250, origin: 'adr' }), 'adr-callback');
  assert.equal(classifyFalseEntry(cx, { entry: 0x08000250, origin: 'gap-scan' }), 'inside-elf-function');
  assert.equal(classifyFalseEntry(cx, { entry: 0x080002FE, origin: 'call' }), 'inside-elf-function');
  assert.equal(classifyFalseEntry(cx, { entry: 0x08000300, origin: 'call' }), 'other');
  assert.equal(classifyFalseEntry(cx, { entry: 0x08000280, origin: 'pool-pointer' }), 'other');
});

test('gluedWhere: inside the extent of a found function with an ELF entry, else past the code end, else outside every such extent', () => {
  const g = found({ entry: 0x08000400, extent: { start: 0x08000400, end: 0x08000440 } }); // not an ELF FUNC
  const cx = classifier(input([found(), g]));
  assert.equal(gluedWhere(cx, 0x08000240, 0x08000500), 'inside-extent', 'swallowed by F: a glued split');
  assert.equal(gluedWhere(cx, 0x08000420, 0x08000500), 'outside-extents', "inside a false entry's extent is not a glued split");
  assert.equal(gluedWhere(cx, 0x08000300, 0x08000500), 'outside-extents', "at F's end: not strictly inside");
  assert.equal(gluedWhere(cx, 0x08000200, 0x08000500), 'outside-extents', "at F's own entry");
  assert.equal(gluedWhere(cx, 0x08000600, 0x08000500), 'past-code-end');
  assert.equal(gluedWhere(cx, 0x08000500, 0x08000500), 'past-code-end', 'at the code end');
});
