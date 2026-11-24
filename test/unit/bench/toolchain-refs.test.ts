// bench/src/toolchain-refs.ts (D123): the recipes under bench/dataset/toolchain, the TOOLCHAIN line a recipe names its
// compiler installation with, and the refusals of an unknown reference or toolchain. The build itself needs agbcc and
// binutils, so the real tier covers it (g6.signatures-rebuild builds libc, which names libc-agbcc).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { REPO_ROOT, contextFromEnv } from '../../../bench/src/context.ts';
import { BenchError } from '../../../bench/src/files.ts';
import {
  TOOLCHAINS,
  buildToolchainReference,
  isToolchainReference,
  toolchainDir,
  toolchainOf,
  toolchainReferenceNames,
} from '../../../bench/src/toolchain-refs.ts';

const TMP = mkdtempSync(join(tmpdir(), 'romlift-toolchain-refs-'));
after(() => rmSync(TMP, { recursive: true, force: true }));
const deps = { run: () => Promise.reject(new Error('nothing is run')), log: () => {} };

test('toolchainOf reads the TOOLCHAIN line of a recipe', () => {
  assert.equal(toolchainOf('NAME := x\nTOOLCHAIN := agbcc\nARCHIVE := libc.a\n'), 'agbcc');
  assert.equal(toolchainOf('NAME := x\n# TOOLCHAIN := agbcc\n'), undefined);
});

test("the repository's recipes each name a known toolchain, an archive and the shared rules", async () => {
  const cx = contextFromEnv({}, REPO_ROOT);
  const names = await toolchainReferenceNames(cx);
  assert.deepEqual(names, ['libc-agbcc']);
  assert.equal(await isToolchainReference(cx, 'libc-agbcc'), true);
  assert.equal(await isToolchainReference(cx, 'pokeemerald'), false);
  for (const name of names) {
    const recipe = readFileSync(join(toolchainDir(cx), name, 'build.mk'), 'utf8');
    assert.ok(Object.hasOwn(TOOLCHAINS, toolchainOf(recipe) ?? ''), `${name}: a TOOLCHAIN of TOOLCHAINS`);
    assert.match(recipe, new RegExp(`^NAME := ${name}$`, 'm'));
    assert.match(recipe, /^ARCHIVE := \S+\.a$/m);
    assert.match(recipe, /^include \.\.\/rules\.mk$/m);
  }
});

test('an unknown reference, a recipe without TOOLCHAIN and one naming an unknown toolchain are refused', async () => {
  const cx = contextFromEnv({}, TMP);
  assert.deepEqual(await toolchainReferenceNames(cx), []);
  await assert.rejects(buildToolchainReference(cx, 'none', deps, {}), BenchError);
  for (const [name, text, message] of [
    ['bare', 'NAME := bare\n', /names no TOOLCHAIN \(known: agbcc\)/],
    ['other', 'NAME := other\nTOOLCHAIN := mwcc\n', /the unknown TOOLCHAIN mwcc \(known: agbcc\)/],
  ] as const) {
    mkdirSync(join(toolchainDir(cx), name), { recursive: true });
    writeFileSync(join(toolchainDir(cx), name, 'build.mk'), text);
    await assert.rejects(buildToolchainReference(cx, name, deps, {}), message);
  }
  assert.deepEqual(await toolchainReferenceNames(cx), ['bare', 'other']);
});
