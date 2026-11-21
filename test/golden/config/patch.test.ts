// Golden patches (architecture §6.5, D9, D23, g4.toml-canonical): each patch/<case>/ holds a real-shaped
// romlift.toml with hand comments (input.toml) and the proposals applied to it (proposals.json, addresses as
// "0x…" strings); planPatch's result is output.toml when it patches and refused.txt (one diagnostic per line)
// when it refuses. A patched file keeps every comment line and trailing comment of the input, re-parses to
// applyProposals of the input's config, and the only lines it adds are those of the entries the proposals change.
// UPDATE_GOLDEN=1 rewrites the outputs.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseConfig } from '../../../src/core/config/parse.ts';
import { applyProposals, planPatch } from '../../../src/core/config/patch.ts';
import type { RomliftConfig } from '../../../src/core/config/schema.ts';
import { entryPointLine, functionLine, serializeConfig, symbolLine } from '../../../src/core/config/serialize.ts';
import type { Proposal } from '../../../src/core/proposals/types.ts';

const DIR = fileURLToPath(new URL('./patch/', import.meta.url));
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';
const CASES = readdirSync(DIR).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** proposals.json with its "0x…" addresses as numbers (a span's start and end too). */
function readProposals(file: string): Proposal[] {
  return JSON.parse(readFileSync(file, 'utf8'), (key, value: unknown) =>
    ['addr', 'start', 'end', 'runsAt'].includes(key) && typeof value === 'string' ? Number.parseInt(value, 16) : value,
  ) as Proposal[];
}

/** The comments of a text: whole comment lines and trailing comments (from the first ` #` outside a string). */
function comments(text: string): string[] {
  return text.split('\n').flatMap((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) return [trimmed];
    const at = line.indexOf(' #');
    return at >= 0 ? [line.slice(at).trim()] : [];
  });
}

/** The canonical lines of the entries whose line `intended` changes, functions, entry points then symbols, by address. */
function changedLines(config: RomliftConfig, intended: RomliftConfig): string[] {
  const out: string[] = [];
  for (const [addr, fn] of [...intended.functions].sort((a, b) => a[0] - b[0])) {
    const was = config.functions.get(addr);
    if (was === undefined || functionLine(addr, was) !== functionLine(addr, fn)) out.push(functionLine(addr, fn));
  }
  for (const [addr, e] of [...intended.entryPoints].sort((a, b) => a[0] - b[0])) {
    const was = config.entryPoints.get(addr);
    if (was === undefined || entryPointLine(addr, was) !== entryPointLine(addr, e)) out.push(entryPointLine(addr, e));
  }
  for (const [addr, symbol] of [...intended.symbols].sort((a, b) => a[0] - b[0])) {
    const was = config.symbols.get(addr);
    if (was === undefined || symbolLine(addr, was) !== symbolLine(addr, symbol)) out.push(symbolLine(addr, symbol));
  }
  return out;
}

function withoutComment(line: string): string {
  const at = line.indexOf(' #');
  return (at >= 0 ? line.slice(0, at) : line).trim();
}

test('the patch goldens cover a rename, an added function, a refused restructured table and the startup label', () => {
  assert.deepEqual(CASES, ['add-function', 'rename', 'restructured-refused', 'startup-label']);
});

for (const name of CASES) {
  test(`patch golden ${name}`, () => {
    const dir = join(DIR, name);
    const input = readFileSync(join(dir, 'input.toml'), 'utf8');
    const proposals = readProposals(join(dir, 'proposals.json'));
    const parsed = parseConfig(input);
    assert.ok(parsed.ok, `${name}: input.toml does not parse`);
    const result = planPatch(input, parsed.value, proposals);
    const okFile = join(dir, 'output.toml');
    const refusedFile = join(dir, 'refused.txt');
    const refusedText = result.ok ? '' : `${result.diagnostics.map((d) => `${d.code} ${d.message}`).join('\n')}\n`;
    if (UPDATE) {
      rmSync(okFile, { force: true });
      rmSync(refusedFile, { force: true });
      writeFileSync(result.ok ? okFile : refusedFile, result.ok ? result.text : refusedText);
    }
    if (!result.ok) {
      assert.equal(
        refusedText,
        readFileSync(refusedFile, 'utf8'),
        `${name}/refused.txt differs; UPDATE_GOLDEN=1 rewrites it`,
      );
      assert.ok(result.diagnostics.every((d) => d.code === 'E_TOML_PATCH_REFUSED'));
      return;
    }
    assert.equal(result.text, readFileSync(okFile, 'utf8'), `${name}/output.toml differs; UPDATE_GOLDEN=1 rewrites it`);
    assert.deepEqual(comments(result.text), comments(input), `${name}: every comment is kept verbatim`);
    const intended = applyProposals(parsed.value, proposals);
    const reparsed = parseConfig(result.text);
    assert.ok(reparsed.ok);
    assert.equal(serializeConfig(reparsed.value), serializeConfig(intended));
    const inputLines = new Set(input.split('\n'));
    const added = result.text
      .split('\n')
      .filter((line) => !inputLines.has(line))
      .map(withoutComment);
    assert.deepEqual(added, changedLines(parsed.value, intended), `${name}: exactly the changed entries' lines change`);
  });
}
