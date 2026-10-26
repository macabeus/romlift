// `romlift generate` over the reviewers' symbolic-link layouts (phase 6; roadmap "Carried from phase 4": D89 a, D90 a,
// gate-honesty-d2-2, correctness-d2-1, architecture-d2-1, gate-honesty-e1-1): a `c` module renamed with `git mv`
// whose INCLUDE_ASM comes from a header that the scaffold's `cpp -nostdinc -I include` reaches through a link gains no
// second `#include "include_asm.h"`, with no diagnostic, and a second run changes nothing. Through a link above the
// project only the files an #include names are read, so an unreadable file there that none names is no E_IO_READ.
// Phase 4's code fails the first three layouts (it added the header, and the user's macros.inc then came twice: the
// assembler refused) and the last two (E_IO_READ on the unrelated file).
import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { ExitCode } from '../../../src/cli/exit-codes.ts';
import { main } from '../../../src/cli/main.ts';
import { listSyntheticFixtures } from '../../helpers/fixtures.ts';
import { capturingIo } from './fake.ts';

const TMP = await mkdtemp(path.join(tmpdir(), 'romlift-cli-generate-links-'));
after(async () => {
  await rm(TMP, { recursive: true, force: true });
});
const COMPOSITE = listSyntheticFixtures().find((f) => f.name === 'composite') ?? assert.fail('composite');
const AS_ROOT = process.getuid?.() === 0;
let fresh = 0;

async function run(cwd: string, argv: readonly string[]): Promise<{ readonly code: ExitCode; readonly stdout: string }> {
  const io = { ...capturingIo(), cwd };
  const code = await main(argv, io);
  return { code, stdout: io.out.join('') };
}

function diagnostics(stdout: string): Record<string, unknown>[] {
  return stdout
    .trimEnd()
    .split('\n')
    .map((text) => JSON.parse(text) as Record<string, unknown>)
    .filter((l) => l['type'] === 'diagnostic');
}

/** A project `init` wrote at `<outer>/proj`, `outer` a fresh directory of its own (a link `../..` reaches it). */
async function initProject(): Promise<{ readonly outer: string; readonly dir: string }> {
  const outer = path.join(TMP, `o${fresh++}`);
  const dir = path.join(outer, 'proj');
  await mkdir(dir, { recursive: true });
  await copyFile(COMPOSITE.rom, path.join(dir, 'baserom.gba'));
  const out = await run(dir, ['init', 'baserom.gba', '--module-size', '0x200']);
  assert.equal(out.code, ExitCode.ok, out.stdout);
  // The layouts below are projects that brought their own headers: init's starter global.h and gba/ are replaced.
  await rm(path.join(dir, 'include', 'global.h'));
  await rm(path.join(dir, 'include', 'gba'), { recursive: true });
  return { outer, dir };
}

function stubIn(module: string, name: string): string {
  return `INCLUDE_ASM("asm/nonmatchings/${module}", ${name});`;
}

/** The layouts: each lays out the defining header (`own`, which includes macros.inc itself) and returns the line main_3.c includes it by. */
const LAYOUTS: readonly { readonly name: string; readonly lay: (outer: string, dir: string, own: string) => Promise<string> }[] = [
  {
    // "../defs.h" in a header behind include/gba -> <outer>/shared/gba is <outer>/shared/defs.h, as cpp opens it; the
    // link's own path names include/defs.h, a header of types alone.
    name: 'a .. behind a linked directory',
    lay: async (outer, dir, own) => {
      await mkdir(path.join(outer, 'shared', 'gba'), { recursive: true });
      await writeFile(path.join(outer, 'shared', 'gba', 'macro.h'), '#include "../defs.h"\n');
      await writeFile(path.join(outer, 'shared', 'defs.h'), own);
      await writeFile(path.join(dir, 'include', 'defs.h'), 'typedef unsigned char u8;\n');
      await symlink(path.join(outer, 'shared', 'gba'), path.join(dir, 'include', 'gba'));
      await writeFile(path.join(dir, 'include', 'global.h'), '#include "gba/macro.h"\n');
      return '#include "global.h"\n';
    },
  },
  {
    // include -> .: the headers live at the project's top, which cpp -I include reads through the link.
    name: 'include -> .',
    lay: async (_outer, dir, own) => {
      for (const name of ['include_asm.h', 'macros.inc']) await rename(path.join(dir, 'include', name), path.join(dir, name));
      await rm(path.join(dir, 'include'), { recursive: true });
      await symlink('.', path.join(dir, 'include'));
      await writeFile(path.join(dir, 'global.h'), own);
      return '#include "global.h"\n';
    },
  },
  {
    name: 'a linked include/gba',
    lay: async (outer, dir, own) => {
      await mkdir(path.join(outer, 'shared', 'gba'), { recursive: true });
      await writeFile(path.join(outer, 'shared', 'gba', 'macro.h'), own);
      await symlink(path.join(outer, 'shared', 'gba'), path.join(dir, 'include', 'gba'));
      await writeFile(path.join(dir, 'include', 'global.h'), '#include "gba/macro.h"\n');
      return '#include "global.h"\n';
    },
  },
  {
    name: 'a linked include/',
    lay: async (outer, dir, own) => {
      await writeFile(path.join(dir, 'include', 'global.h'), own);
      await mkdir(path.join(outer, 'shared'), { recursive: true });
      await rename(path.join(dir, 'include'), path.join(outer, 'shared', 'include'));
      await symlink(path.join(outer, 'shared', 'include'), path.join(dir, 'include'));
      return '#include "global.h"\n';
    },
  },
  {
    // src/up -> ../..: "up/lib/defs.h" from src/main_3.c is <outer>/lib/defs.h; <outer>/locked.h, which no #include
    // names, cannot be read.
    name: 'src/up -> ../..',
    lay: async (outer, dir, own) => {
      await mkdir(path.join(outer, 'lib'), { recursive: true });
      await writeFile(path.join(outer, 'lib', 'defs.h'), own);
      await writeFile(path.join(outer, 'locked.h'), 'unrelated\n');
      await chmod(path.join(outer, 'locked.h'), 0o000);
      await symlink(path.join('..', '..'), path.join(dir, 'src', 'up'));
      return '#include "up/lib/defs.h"\n';
    },
  },
  {
    name: 'include/up -> ../..',
    lay: async (outer, dir, own) => {
      await mkdir(path.join(outer, 'lib'), { recursive: true });
      await writeFile(path.join(outer, 'lib', 'defs.h'), own);
      await writeFile(path.join(outer, 'locked.h'), 'unrelated\n');
      await chmod(path.join(outer, 'locked.h'), 0o000);
      await symlink(path.join('..', '..'), path.join(dir, 'include', 'up'));
      return '#include <up/lib/defs.h>\n';
    },
  },
];

for (const layout of LAYOUTS) {
  const locks = layout.name.endsWith('-> ../..');
  test(`a c module renamed with git mv whose INCLUDE_ASM comes from a header reached through ${layout.name}: no second header, no diagnostic, idempotent`, { skip: locks && AS_ROOT ? 'root reads through mode 000' : false }, async () => {
    const { outer, dir } = await initProject();
    try {
      const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
      const main3 = await readFile(path.join(dir, 'src', 'main_3.c'), 'utf8');
      const header = await readFile(path.join(dir, 'include', 'include_asm.h'), 'utf8');
      assert.ok(main3.startsWith('#include "include_asm.h"\n') && main3.includes(stubIn('main_3', 'sub_08000508')) && header.includes('macros.inc'), 'the composite as this test knows it');
      // The reviewers' klonoa layouts: a header that defines INCLUDE_ASM and includes macros.inc under its own guard.
      const own = header.replace(/GUARD_INCLUDE_ASM_H/g, 'GUARD_GLOBAL_H');
      const include = await layout.lay(outer, dir, own);
      const text = main3.replace('#include "include_asm.h"\n', include).replace(stubIn('main_3', 'sub_08000508'), 'void sub_08000508(void) {\n}');
      await writeFile(path.join(dir, 'src', 'main_3.c'), text);
      const first = await run(dir, ['generate', '--json']);
      assert.equal(first.code, ExitCode.ok, first.stdout);
      assert.deepEqual(diagnostics(first.stdout), [], first.stdout);
      assert.equal(await readFile(path.join(dir, 'src', 'main_3.c'), 'utf8'), text, 'a file that needs no stub inserted is kept');
      // `git mv src/main_3.c src/boot.c` and the TOML rename: every stub of the file is replaced.
      await writeFile(path.join(dir, 'romlift.toml'), toml.replace('name = "main_3"', 'name = "boot"'));
      await writeFile(path.join(dir, 'src', 'boot.c'), text);
      await rm(path.join(dir, 'src', 'main_3.c'));
      const out = await run(dir, ['generate', '--json']);
      assert.equal(out.code, ExitCode.ok, out.stdout);
      assert.deepEqual(diagnostics(out.stdout), [], out.stdout);
      assert.equal(await readFile(path.join(dir, 'src', 'boot.c'), 'utf8'), text.replaceAll('asm/nonmatchings/main_3', 'asm/nonmatchings/boot'), 'no #include "include_asm.h" added');
      const again = await run(dir, ['generate', '--json']);
      assert.equal(again.code, ExitCode.ok, again.stdout);
      assert.deepEqual(diagnostics(again.stdout), [], 'idempotent');
    } finally {
      if (locks) await chmod(path.join(outer, 'locked.h'), 0o644);
    }
  });
}

test('a header behind a linked directory that does not define INCLUDE_ASM: the renamed module gains the header, from the link target\'s directory', async () => {
  // The control of the first layout: "../defs.h" from the target is a header of types alone, while the link's own path
  // names a defining include/defs.h; cpp reads the target's, so the file needs include_asm.h.
  const { outer, dir } = await initProject();
  const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
  const main3 = await readFile(path.join(dir, 'src', 'main_3.c'), 'utf8');
  const header = await readFile(path.join(dir, 'include', 'include_asm.h'), 'utf8');
  await mkdir(path.join(outer, 'shared', 'gba'), { recursive: true });
  await writeFile(path.join(outer, 'shared', 'gba', 'macro.h'), '#include "../defs.h"\n');
  await writeFile(path.join(outer, 'shared', 'defs.h'), 'typedef unsigned char u8;\n');
  await writeFile(path.join(dir, 'include', 'defs.h'), header.replace(/GUARD_INCLUDE_ASM_H/g, 'GUARD_GLOBAL_H'));
  await symlink(path.join(outer, 'shared', 'gba'), path.join(dir, 'include', 'gba'));
  await writeFile(path.join(dir, 'include', 'global.h'), '#include "gba/macro.h"\n');
  const text = main3.replace('#include "include_asm.h"\n', '#include "global.h"\n').replace(stubIn('main_3', 'sub_08000508'), 'void sub_08000508(void) {\n}');
  await writeFile(path.join(dir, 'romlift.toml'), toml.replace('name = "main_3"', 'name = "boot"'));
  await writeFile(path.join(dir, 'src', 'boot.c'), text);
  await rm(path.join(dir, 'src', 'main_3.c'));
  const out = await run(dir, ['generate', '--json']);
  assert.equal(out.code, ExitCode.ok, out.stdout);
  assert.deepEqual(diagnostics(out.stdout), [], out.stdout);
  assert.equal(await readFile(path.join(dir, 'src', 'boot.c'), 'utf8'), `#include "include_asm.h"\n\n${text.replaceAll('asm/nonmatchings/main_3', 'asm/nonmatchings/boot')}`);
});
