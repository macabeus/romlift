// g2.second-profile (architecture §4.3, §13, R6): a second analysis profile, with other numbers and a
// reordered validity slot, typechecks and runs on every committed fixture. The dummy profile of
// test/helpers/dummy-profile.ts must exist and typecheck (the whole tsconfig program is checked); because a
// gate may import only the package entry points (D37), the gate derives its own dummy from agbcc the same
// way and runs it: each analysis must complete, record the dummy's id and list its functions in entry order.
//
// Calls the phase-2 API as frozen in architecture §3.3 and §4.3: PROFILES/profileById('agbcc'),
// romFromBytes, sha1Of, analyze(rom, profile, {mode: 'discover', seeds: [], overrides: [], trail: 'off'}).
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult } from './gate.ts';

interface ProfileLike {
  readonly id: string;
  readonly pipeline: { readonly validity: readonly string[] };
  readonly density: { readonly minHoles: number; readonly holeShift: number };
  readonly pointerTableRun: number;
  readonly tinyFunctionInsns: number;
}

interface AnalysisResult {
  readonly schema: string;
  readonly profile: string;
  readonly functions: readonly { readonly entry: number }[];
}

interface Rom {
  readonly sha1: string;
}

type RomFromBytes = (bytes: Uint8Array, sha1: string) => Rom;
type Sha1Of = (data: Uint8Array) => string;
type ProfileById = (id: string) => ProfileLike | undefined;
type Analyze = (rom: Rom, profile: ProfileLike, options: { readonly mode: 'discover'; readonly seeds: readonly never[]; readonly overrides: readonly never[]; readonly trail: 'off' }) => AnalysisResult;

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

/** agbcc with other numbers and its last two validity rules swapped. */
function dummyFrom(agbcc: ProfileLike): ProfileLike {
  const validity = [...agbcc.pipeline.validity];
  const last = validity.length - 1;
  if (last >= 1) [validity[last - 1], validity[last]] = [validity[last] ?? '', validity[last - 1] ?? ''];
  return {
    ...agbcc,
    id: 'dummy',
    pipeline: { ...agbcc.pipeline, validity },
    density: { ...agbcc.density, minHoles: agbcc.density.minHoles * 2, holeShift: agbcc.density.holeShift + 1 },
    pointerTableRun: agbcc.pointerTableRun + 1,
    tinyFunctionInsns: agbcc.tinyFunctionInsns + 1,
  };
}

gate({
  id: 'g2.second-profile',
  phase: 2,
  tier: 'ci',
  needs: ['PROFILES', 'profileById', 'romFromBytes', 'sha1Of', 'analyze'],
  async run(cx) {
    const helper = path.join(cx.repoRoot, 'test', 'helpers', 'dummy-profile.ts');
    try {
      if (!(await stat(helper)).isFile()) throw new Error('not a file');
    } catch {
      throw new Error('test/helpers/dummy-profile.ts is missing');
    }
    const tsc = await cx.exec('npx', ['--no', '--', 'tsc', '--noEmit', '-p', 'tsconfig.json'], { cwd: cx.repoRoot });
    if (tsc.code !== 0) throw new Error(`tsc --noEmit exited ${tsc.code}:\n${tail(tsc)}`);

    if (cx.fixtures.length === 0) throw new Error('no committed fixture under bench/dataset/synthetic');
    const agbcc = cx.need<ProfileById>('profileById')('agbcc');
    if (agbcc === undefined) throw new Error("profileById('agbcc') returned undefined");
    const dummy = dummyFrom(agbcc);
    const romFromBytes = cx.need<RomFromBytes>('romFromBytes');
    const sha1Of = cx.need<Sha1Of>('sha1Of');
    const analyze = cx.need<Analyze>('analyze');

    const problems: string[] = [];
    let functions = 0;
    for (const fixture of cx.fixtures) {
      const bytes = new Uint8Array(await readFile(fixture.rom));
      let result: AnalysisResult;
      try {
        result = analyze(romFromBytes(bytes, sha1Of(bytes)), dummy, { mode: 'discover', seeds: [], overrides: [], trail: 'off' });
      } catch (error) {
        problems.push(`${fixture.name}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (result.schema !== 'romlift/analysis@1') problems.push(`${fixture.name}: schema '${result.schema}'`);
      if (result.profile !== 'dummy') problems.push(`${fixture.name}: the result records profile '${result.profile}'`);
      if (result.functions.some((f, i) => i > 0 && (result.functions[i - 1]?.entry ?? -1) >= f.entry)) problems.push(`${fixture.name}: functions not in entry order`);
      functions += result.functions.length;
    }
    if (problems.length > 0) throw new Error(`the second profile fails: ${problems.join('; ')}`);
    cx.note(`dummy profile ran on ${cx.fixtures.length} fixtures (${functions} functions); test/helpers/dummy-profile.ts typechecks`);
  },
});
