// `romlift init <rom> [dir] [--name <name>] [--module-size <bytes>] [--json]` (architecture §2.1, §6.3 to §6.5, D17,
// D74 c): a new project from a ROM. `dir` defaults to the working directory; it is accepted when it is absent or
// empty, when it holds only the given ROM plus `.git` and dot-files, or when it is a romlift project whose
// romlift.toml, decomp.yaml and baserom.gba init would write unchanged (an interrupted init run again); anything else
// is E_DIR_NOT_EMPTY. The workflow (core/workflow/init.ts) plans everything first: the build name, the discover
// analysis and its config, the TOML, decomp.yaml, the checked generate over that config and the scaffold; a refusal
// writes nothing (exit 1, or 3 for a failed self-check). Then, holding the project lock: the ROM is copied to
// baserom.gba when it has another name (the original stays), romlift.toml and decomp.yaml are saved
// (shell/project/write-project.ts), the tree and the scaffold are planned (planWrites: generated files in the
// manifest, scaffold files written when absent) and applied, and setup.sh made executable. Last, the lock step writes package-lock.json
// (shell/toolchain/npm.ts), or defers it with W_LOCKFILE_DEFERRED. Output: the diagnostics, then a summary with the
// counts (functions, modules, files written); with --json, NDJSON. Never reads stdin.
import { DECOMP_YAML_FILE, ROMLIFT_CONFIG_FILE } from '../../api/config.ts';
import type { Diagnostic } from '../../api/rom.ts';
import { init, initDirVerdict, wantsLockStep } from '../../core/workflow/init.ts';
import type { InitOptions } from '../../core/workflow/types.ts';
import { readInitDir, readScaffoldInputs, resolveFrom } from '../../shell/project/read-inputs.ts';
import { hasPackageLock, writeInitProject } from '../../shell/project/write-project.ts';
import { readRom } from '../../shell/rom.ts';
import { writePackageLock } from '../../shell/toolchain/npm.ts';
import { ExitCode } from '../exit-codes.ts';
import type { RunSummary } from '../exit-codes.ts';
import type { CliIo, CommandSpec } from '../registry.ts';
import { diagnosticLine, summaryLine } from '../reporters/ndjson.ts';
import { formatDiagnosticText, formatSummaryText } from '../reporters/text.ts';
import { opCounts, printDiagnosticsOnly, refusedExitCode, usageError } from './command-common.ts';

/** `--module-size`: `0x` and hex digits, or decimal; a positive multiple of 4 (a legal border is word-aligned). */
export function parseModuleSize(text: string): number | undefined {
  const value = /^0[xX][0-9A-Fa-f]{1,8}$/.test(text) ? Number.parseInt(text.slice(2), 16) : /^\d{1,10}$/.test(text) ? Number.parseInt(text, 10) : Number.NaN;
  return Number.isSafeInteger(value) && value > 0 && value % 4 === 0 && value <= 0x0200_0000 ? value : undefined;
}

function print(io: CliIo, json: boolean, diagnostics: readonly Diagnostic[], summary: RunSummary, lines: readonly string[] = []): void {
  if (json) {
    io.stdout([...diagnostics.map(diagnosticLine), summaryLine(summary)].join(''));
    return;
  }
  if (diagnostics.length > 0) io.stderr(diagnostics.map((d) => `${formatDiagnosticText(d)}\n`).join(''));
  io.stdout([...lines, `init: ${formatSummaryText(summary)}\n`].join(''));
}

export const initCommand: CommandSpec = {
  name: 'init',
  summary: 'Creates a matching-decompilation project from a ROM: romlift.toml, decomp.yaml, the scaffold, src/*.c and the generated tree',
  usage: 'init <rom> [dir] [--name <name>] [--module-size <bytes>] [--json]',
  positionals: [{ name: '<rom>' }, { name: '[dir]', optional: true }],
  options: [
    { name: 'name', kind: 'string', summary: 'The build name (<name>.gba, <name>.elf, <name>.sha1); default the header game code in lower case', value: '<name>' },
    { name: 'module-size', kind: 'string', summary: 'The size past which a C module closes at the next legal border (0x… or decimal); default 0x10000', value: '<bytes>' },
    { name: 'json', kind: 'boolean', summary: 'Prints NDJSON: the diagnostics, then a summary' },
  ],
  async run(args, io) {
    const json = args.flags['json'] === true;
    const romArg = args.positionals[0] ?? '';
    const sizeText = args.options['module-size'];
    const moduleSize = sizeText === undefined ? undefined : parseModuleSize(sizeText);
    if (sizeText !== undefined && moduleSize === undefined) return usageError(io, 'init', `--module-size is a positive multiple of 4 (0x… or decimal), not '${sizeText}'`);
    const name = args.options['name'];
    const options: InitOptions = { ...(name === undefined ? {} : { name }), ...(moduleSize === undefined ? {} : { moduleSize }) };
    const romPath = resolveFrom(io.cwd, romArg);
    const dirArg = args.positionals[1];
    const refuse = (diagnostics: readonly Diagnostic[], exitCode: ExitCode = ExitCode.errors): ExitCode => {
      printDiagnosticsOnly(io, json, 'init', diagnostics, { ok: false, exitCode });
      return exitCode;
    };

    const listing = await readInitDir(resolveFrom(io.cwd, dirArg ?? '.'), romPath);
    if (!listing.ok) return refuse(listing.diagnostics);
    const verdict = initDirVerdict(listing.value);
    if (!verdict.ok) return refuse(verdict.diagnostics);
    const dir = listing.value.dir;
    const rom = await readRom(romPath);
    if (!rom.ok) return refuse([rom.diagnostic]);
    const scaffold = await readScaffoldInputs();
    if (!scaffold.ok) return refuse(scaffold.diagnostics);
    const plan = init({ rom: rom.value, romFile: listing.value.romInside ?? romArg, options, templates: scaffold.value.templates, romliftVersion: scaffold.value.romliftVersion, agbcc: scaffold.value.agbcc });
    if (!plan.ok) return refuse(plan.diagnostics, refusedExitCode(plan.diagnostics));
    // writeInitProject checks init's own files under the lock (absent or what init writes); a refusal wrote nothing.
    const files = { romPath, tomlText: plan.tomlText, decompYamlText: plan.decompYamlText };
    const written = await writeInitProject(dir, files, { result: plan.result, rom: rom.value, extra: plan.scaffold }, scaffold.value.romliftVersion);
    if (!written.ok && written.refused) return refuse(written.diagnostics);
    let diagnostics: readonly Diagnostic[] = [...plan.diagnostics, ...(written.ok ? written.value.diagnostics : written.diagnostics)];
    if (wantsLockStep(diagnostics, await hasPackageLock(dir))) {
      const lock = await writePackageLock(dir, { env: io.env });
      if (!lock.ok) diagnostics = [...diagnostics, lock.diagnostic];
    }
    const failed = diagnostics.some((d) => d.severity === 'error');
    const exitCode = failed ? ExitCode.errors : ExitCode.ok;
    const ops = written.ok ? written.value.plan.ops : [];
    const summary: RunSummary = { ok: !failed, exitCode, counts: { ...opCounts(ops), functions: plan.config.functions.size, modules: plan.config.modules.length } };
    const lines = failed ? [] : [`initialised ${plan.config.build.name} in ${dir}: ${ROMLIFT_CONFIG_FILE}, ${DECOMP_YAML_FILE}, the scaffold and the tree; run ./setup.sh, then make\n`];
    print(io, json, diagnostics, summary, lines);
    return exitCode;
  },
};
