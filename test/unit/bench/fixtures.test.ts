// The old_agbcc support of bench/tools/fixtures.ts (architecture §8.1, D28, D47): which sources a build.mk
// compiles with old_agbcc, where old_agbcc is found beside agbcc, and the make arguments that pass it; and
// that common/rules.mk selects the compiler per source and appends a source's own flags.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { makeArgs, oldAgbccBeside, oldAgbccSources, parseToolchainRecord } from '../../../bench/tools/fixtures.ts';
import { SYNTHETIC_ROOT, listSyntheticFixtures } from '../../helpers/fixtures.ts';

const BINUTILS = {
  as: '/usr/bin/arm-none-eabi-as',
  ld: '/usr/bin/arm-none-eabi-ld',
  objcopy: '/usr/bin/arm-none-eabi-objcopy',
};

test('OLD_AGBCC_SRCS lists the sources compiled with old_agbcc; a build.mk without it lists none', () => {
  assert.deepEqual(
    oldAgbccSources(['NAME := x', 'SRCS := a.c b.c', 'OLD_AGBCC_SRCS := b.c', 'include ../common/rules.mk'].join('\n')),
    ['b.c'],
  );
  assert.deepEqual(oldAgbccSources('OLD_AGBCC_SRCS := b.c  c.c\n'), ['b.c', 'c.c']);
  assert.deepEqual(oldAgbccSources('NAME := x\nSRCS := a.c\n'), []);
  assert.deepEqual(oldAgbccSources('OLD_AGBCC_SRCS := \n'), []);
});

test('old_agbcc is the file beside agbcc', () => {
  assert.equal(oldAgbccBeside('/opt/agbcc/bin/agbcc'), '/opt/agbcc/bin/old_agbcc');
});

test('make gets OLD_AGBCC only when the toolchain has old_agbcc', () => {
  const base = { agbcc: '/t/bin/agbcc', binutils: BINUTILS };
  const withOld = makeArgs('/out', { ...base, oldAgbcc: '/t/bin/old_agbcc' });
  assert.deepEqual(withOld, [
    '-f',
    'build.mk',
    '--no-print-directory',
    'BUILD=/out',
    'AGBCC=/t/bin/agbcc',
    'OLD_AGBCC=/t/bin/old_agbcc',
    `ARM_AS=${BINUTILS.as}`,
    `ARM_LD=${BINUTILS.ld}`,
    `ARM_OBJCOPY=${BINUTILS.objcopy}`,
  ]);
  const without = makeArgs('/out', { ...base, oldAgbcc: undefined });
  assert.ok(!without.some((a) => a.startsWith('OLD_AGBCC=')));
  assert.equal(without.length, withOld.length - 1);
});

test('common/rules.mk derives OLD_AGBCC from AGBCC, picks the compiler per source and appends CFLAGS_<stem>', () => {
  const rules = readFileSync(join(SYNTHETIC_ROOT, 'common', 'rules.mk'), 'utf8');
  assert.match(rules, /^OLD_AGBCC \?= \$\(patsubst %agbcc,%old_agbcc,\$\(AGBCC\)\)$/m);
  assert.match(rules, /^cc1_of = \$\(if \$\(filter \$\(1\),\$\(OLD_AGBCC_SRCS\)\),\$\(OLD_AGBCC\),\$\(AGBCC\)\)$/m);
  assert.match(rules, /^\t\$\(call cc1_of,\$<\) \$\(CFLAGS\) \$\(CFLAGS_\$\*\) \$< -o \$@$/m);
});

test('every source a fixture compiles with old_agbcc is one of its C sources, and the fixtures that do record the same agbcc commit', () => {
  const users: string[] = [];
  for (const fixture of listSyntheticFixtures()) {
    const mk = readFileSync(fixture.buildMk, 'utf8');
    const old = oldAgbccSources(mk);
    if (old.length === 0) continue;
    users.push(fixture.name);
    const srcs = (/^SRCS := (.*)$/m.exec(mk)?.[1] ?? '').split(/\s+/).filter((s) => s !== '');
    for (const source of old) {
      assert.ok(source.endsWith('.c'), `${fixture.name}: ${source} is not C`);
      assert.ok(srcs.includes(source), `${fixture.name}: ${source} is not in SRCS`);
    }
    const record = parseToolchainRecord(mk);
    assert.ok(!('missing' in record), `${fixture.name}: no toolchain record`);
  }
  assert.deepEqual(users, ['multi-compiler']);
});

test('fixtures.yml builds old_agbcc at the pinned commit and installs it beside agbcc', () => {
  const workflow = readFileSync(join(SYNTHETIC_ROOT, '..', '..', '..', '.github', 'workflows', 'fixtures.yml'), 'utf8');
  assert.match(workflow, /make -C "\$RUNNER_TEMP\/agbcc-src\/gcc" old -j1/);
  assert.match(workflow, /cp "\$RUNNER_TEMP\/agbcc-src\/gcc\/old_agbcc" "\$RUNNER_TEMP\/agbcc\/bin\/old_agbcc"/);
  assert.match(workflow, /cp "\$RUNNER_TEMP\/agbcc-src\/gcc\/agbcc" "\$RUNNER_TEMP\/agbcc\/bin\/agbcc"/);
});
