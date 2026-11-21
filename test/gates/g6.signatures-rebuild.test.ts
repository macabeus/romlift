// g6.signatures-rebuild (architecture §7.1, §7.2, §13, D31, D40): signature files are rebuilt from specs
// deterministically and reproduce what was validated before.
//   ci:   the library fixture's spec (bench/dataset/synthetic/library/spec.json) built twice gives identical
//         files, equal to the committed golden bench/dataset/synthetic/library/signatures.golden.json;
//   real: every signatures/specs/<library>.json built twice gives identical files, and each equals the PoC's
//         file of that library converted to schema 3 (bench/tools/convert-poc-signatures.ts), apart from
//         the names the spec reviews; a library the PoC had no file for is only built twice.
// Every field is compared but `builtWith` (the romlift version), which is left out of every comparison with a
// committed or converted file. Built files go to temporary directories: nothing is written into signatures/.
//
// Expected interfaces, aligned by the phase-6 lead (architecture §2.1, §7.1, §8.5, D93; all p6-signatures-build's):
//   npm run signatures -- build <spec> --out <dir> --json   exit 0; writes <dir>/<library>.json, a SignatureFile of
//     schema 3 (src/core/signatures/schema.ts, frozen by D93)
//   node --conditions=source bench/tools/convert-poc-signatures.ts --out <dir>   exit 0; writes
//     <dir>/<library>.json for each PoC signature file, in schema 3
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { type ExecResult, type GateContext, gate } from './gate.ts';

interface Member {
  readonly id: string;
  readonly name: string;
}

interface SignatureFile {
  readonly schema: number;
  readonly library: string;
  readonly builtWith?: string;
  readonly versions: readonly {
    readonly id: string;
    readonly functions: readonly Member[];
    readonly tables: readonly Member[];
  }[];
}

interface Spec {
  readonly library: string;
  readonly reviewedNames?: Readonly<Record<string, { readonly name: string }>>;
}

const FIXTURE = 'library';

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

function withoutBuiltWith(file: SignatureFile): string {
  const { builtWith: _ignored, ...rest } = file;
  return JSON.stringify(rest);
}

/** The converted PoC file with the spec's reviewed names applied, as the builder applies them. */
function reviewed(file: SignatureFile, spec: Spec): SignatureFile {
  const names = spec.reviewedNames ?? {};
  const rename = (m: Member): Member => ({ ...m, name: names[m.id]?.name ?? m.name });
  return {
    ...file,
    versions: file.versions.map((v) => ({ ...v, functions: v.functions.map(rename), tables: v.tables.map(rename) })),
  };
}

async function build(
  cx: GateContext,
  spec: string,
  label: string,
): Promise<{ readonly text: string; readonly file: SignatureFile }> {
  const out = await cx.tmpDir(`romlift-signatures-${label}-`);
  const tool = path.join(cx.repoRoot, 'bench', 'tools', 'signatures.ts');
  const run = await cx.exec(process.execPath, ['--conditions=source', tool, 'build', spec, '--out', out, '--json'], {
    cwd: cx.repoRoot,
  });
  if (run.code !== 0)
    throw new Error(`signatures build ${path.relative(cx.repoRoot, spec)} exited ${run.code}:\n${tail(run)}`);
  const names = (await readdir(out)).filter((n) => n.endsWith('.json'));
  if (names.length !== 1 || names[0] === undefined)
    throw new Error(`signatures build ${path.relative(cx.repoRoot, spec)} wrote ${names.length} files, expected one`);
  const text = await readFile(path.join(out, names[0]), 'utf8');
  return { text, file: JSON.parse(text) as SignatureFile };
}

async function twice(cx: GateContext, spec: string, label: string): Promise<SignatureFile> {
  const first = await build(cx, spec, `${label}-1`);
  const second = await build(cx, spec, `${label}-2`);
  if (first.text !== second.text)
    throw new Error(`building ${path.relative(cx.repoRoot, spec)} twice gives two different files`);
  if (first.file.schema !== 3)
    throw new Error(`${path.relative(cx.repoRoot, spec)} built schema ${first.file.schema}, not 3`);
  return first.file;
}

gate({
  id: 'g6.signatures-rebuild',
  phase: 6,
  tier: 'both',
  realInputs: ['roms', 'elfs', 'poc'],
  needs: ['buildSignatures', 'extractSignatures', 'locateSignatures'],
  async run(cx) {
    const fixture = cx.fixtures.find((f) => f.name === FIXTURE);
    if (fixture === undefined) throw new Error(`no ${FIXTURE} fixture under bench/dataset/synthetic`);
    const fixtureFile = await twice(cx, path.join(fixture.dir, 'spec.json'), 'fixture');
    const golden = JSON.parse(
      await readFile(path.join(fixture.dir, 'signatures.golden.json'), 'utf8'),
    ) as SignatureFile;
    if (withoutBuiltWith(fixtureFile) !== withoutBuiltWith(golden))
      throw new Error(`the ${FIXTURE} fixture's signature file differs from its golden`);
    cx.note(`the ${FIXTURE} fixture's signatures build deterministically and equal the golden`);
    if (cx.tier !== 'real') return;

    const specDir = path.join(cx.repoRoot, 'signatures', 'specs');
    const specs = (await readdir(specDir))
      .filter((n) => n.endsWith('.json'))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (specs.length === 0) throw new Error('signatures/specs holds no spec');
    const converted = await cx.tmpDir('romlift-signatures-poc-');
    const convert = await cx.exec(
      process.execPath,
      [
        '--conditions=source',
        path.join(cx.repoRoot, 'bench', 'tools', 'convert-poc-signatures.ts'),
        '--out',
        converted,
      ],
      {
        cwd: cx.repoRoot,
        env: { ROMLIFT_BENCH_ROOT: cx.benchRoot, ROMLIFT_POC: cx.pocRoot },
      },
    );
    if (convert.code !== 0) throw new Error(`convert-poc-signatures exited ${convert.code}:\n${tail(convert)}`);
    const pocFiles = new Set(await readdir(converted));
    const problems: string[] = [];
    const compared: string[] = [];
    for (const name of specs) {
      const spec = JSON.parse(await readFile(path.join(specDir, name), 'utf8')) as Spec;
      const built = await twice(cx, path.join(specDir, name), spec.library);
      const pocName = `${spec.library}.json`;
      if (!pocFiles.has(pocName)) {
        cx.note(`${spec.library}: no PoC file to compare with; built twice identically`);
        continue;
      }
      const poc = reviewed(JSON.parse(await readFile(path.join(converted, pocName), 'utf8')) as SignatureFile, spec);
      if (withoutBuiltWith(built) !== withoutBuiltWith(poc))
        problems.push(`${spec.library}: the local build differs from the PoC's converted file`);
      else compared.push(spec.library);
    }
    if (problems.length > 0) throw new Error(`signature rebuild: ${problems.join('; ')}`);
    cx.note(
      `${specs.length} specs build deterministically; ${compared.join(', ') || 'none'} equal the PoC's converted files`,
    );
  },
});
