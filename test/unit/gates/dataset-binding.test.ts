// The binding of the owner's tmc scopings to the dataset they were decided on (test/gates/dataset-binding.ts,
// D61 f): TMC_AT_D61 is the committed tmc dataset, and bindingMismatch holds a scoping only for that ROM
// and ELF (code-quality-r1-7).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { bindingMismatch, TMC_AT_D61 } from '../../gates/dataset-binding.ts';

test('TMC_AT_D61 is the committed tmc dataset (bench/dataset/real/tmc.json)', async () => {
  const d = JSON.parse(await readFile(new URL('../../../bench/dataset/real/tmc.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  assert.equal(d['name'], 'tmc');
  assert.equal(d['sha1'], TMC_AT_D61.sha1);
  assert.equal(d['elfSha256'], TMC_AT_D61.elfSha256);
});

test('bindingMismatch: the same ROM and ELF hold; another ROM, another ELF or no ELF digest end the scoping', () => {
  assert.equal(bindingMismatch('tmc', 'D61 c', TMC_AT_D61, TMC_AT_D61), undefined);
  assert.equal(bindingMismatch('tmc', 'D61 c', TMC_AT_D61, { sha1: TMC_AT_D61.sha1, elfSha256: TMC_AT_D61.elfSha256 }), undefined);
  const otherRom = bindingMismatch('tmc', 'D61 c', TMC_AT_D61, { sha1: 'c'.repeat(40), elfSha256: TMC_AT_D61.elfSha256 });
  assert.equal(
    otherRom,
    `tmc: the D61 c scoping was decided on ROM SHA-1 ${TMC_AT_D61.sha1} and ELF SHA-256 ${TMC_AT_D61.elfSha256}, the dataset has ${'c'.repeat(40)} and ${TMC_AT_D61.elfSha256}: the scoping is stale, a new owner decision is needed`,
  );
  const otherElf = bindingMismatch('tmc', 'D61 d', TMC_AT_D61, { sha1: TMC_AT_D61.sha1, elfSha256: 'e'.repeat(64) });
  assert.match(otherElf ?? '', new RegExp(`^tmc: the D61 d scoping .* the dataset has ${TMC_AT_D61.sha1} and ${'e'.repeat(64)}: the scoping is stale`));
  const noElf = bindingMismatch('tmc', 'D61 e', TMC_AT_D61, { sha1: TMC_AT_D61.sha1 });
  assert.match(noElf ?? '', new RegExp(`the dataset has ${TMC_AT_D61.sha1} and none: the scoping is stale`));
  assert.match(bindingMismatch('tmc', 'D61 e', TMC_AT_D61, { sha1: TMC_AT_D61.sha1, elfSha256: undefined }) ?? '', / and none: /);
});
