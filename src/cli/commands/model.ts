// `romlift model [--rom <rom>] [--json]` (architecture §2.1, §3.4, D19, D62 d): the Model `generate` emits. Inside a
// project without --rom (phase 4) it is the model of the project's ROM under its romlift.toml (the confirm run over
// that config; another ROM than [rom] sha1 records is E_ROM_SHA1_MISMATCH); with --rom, as in phase 3, the config is
// the one configFromDiscover builds from the ROM's discover analysis and the model comes from the confirm run over it
// (generate's confirmModel). --json prints the public NDJSON of encodeModel (the ModelJsonHeader line, then one
// ModelJsonChunk line per chunk in ROM order, built lazily), then the analysis diagnostics (the model's own are in the
// header) and the summary line. Text mode prints one line per module and the summary (modules, chunks, items,
// functions); diagnostics on stderr. Exit codes: 0 ok, 1 an error diagnostic (an unreadable file, no project,
// E_ROM_NOT_GBA, E_ROM_SHA1_MISMATCH, a model error such as E_MODULE_BORDER), 2 usage.
import { readRom } from '../../api/files.ts';
import { encodeModel } from '../../api/model.ts';
import type { Model } from '../../api/model.ts';
import { hexAddr } from '../../api/rom.ts';
import type { Diagnostic, Rom } from '../../api/rom.ts';
import { confirmProject } from '../../core/workflow/generate.ts';
import { initModel } from '../../core/workflow/init-config.ts';
import type { InitModel } from '../../core/workflow/init-config.ts';
import { projectConfigIgnored } from '../../shell/project/locate.ts';
import { readProject, resolveFrom } from '../../shell/project/read-inputs.ts';
import { ExitCode } from '../exit-codes.ts';
import type { RunSummary } from '../exit-codes.ts';
import type { CommandSpec } from '../registry.ts';
import { diagnosticLine, summaryLine } from '../reporters/ndjson.ts';
import { columns, formatDiagnosticText, formatSummaryText } from '../reporters/text.ts';
import { exitCodeOf, printDiagnosticsOnly, writeLines } from './command-common.ts';

/** The summary of a model run: the exit code and the model's counts. */
function modelSummary(model: Model, exitCode: ExitCode): RunSummary {
  return {
    ok: exitCode === ExitCode.ok,
    exitCode,
    counts: { modules: model.modules.length, chunks: model.chunks.length, items: model.items.count, functions: model.functions.length },
  };
}

/** The model of the project that holds `from`, or of the bare ROM at `romPath`, with the ROM it was built from. */
async function modelOf(from: string, romPath: string | undefined): Promise<{ readonly rom: Rom; readonly model: InitModel; readonly notes: readonly Diagnostic[] } | { readonly refused: readonly Diagnostic[] }> {
  if (romPath === undefined) {
    const read = await readProject(from, { withoutC: true });
    if (!read.ok) return { refused: read.diagnostics };
    const confirmed = confirmProject(read.value.inputs);
    if (!confirmed.ok) return { refused: confirmed.diagnostics };
    return { rom: read.value.inputs.rom, model: { ...confirmed, config: read.value.inputs.config }, notes: [] };
  }
  const loaded = await readRom(resolveFrom(from, romPath));
  if (!loaded.ok) return { refused: [loaded.diagnostic] };
  const ignored = await projectConfigIgnored(from, 'model');
  return { rom: loaded.value, model: initModel(loaded.value), notes: ignored === undefined ? [] : [ignored] };
}

const MODULE_HEADER = ['module', 'kind', 'span', 'chunks', 'compiler'];

/**
 * The text output: one row per module on stdout, then the summary line. Only a `c` module is compiled, so the compiler
 * column of an asm or data module is `-` (end-to-end-user-r1-6; the --json header keeps the model's field).
 */
export function modelText(model: Model, summary: RunSummary): string {
  const rows = model.modules.map((m) => [m.name, m.kind, `${hexAddr(m.span.start)}..${hexAddr(m.span.end)}`, String(m.chunks.count), m.kind === 'c' ? m.compiler : '-']);
  return `${model.modules.length === 0 ? '' : columns([MODULE_HEADER, ...rows])}model: ${formatSummaryText(summary)}\n`;
}

export const modelCommand: CommandSpec = {
  name: 'model',
  summary: 'Prints the model romlift emits for a ROM: modules, chunks and items (--json: the public NDJSON, header then one line per chunk)',
  usage: 'model [--rom <rom>] [--json]',
  positionals: [],
  options: [
    { name: 'rom', kind: 'string', summary: "A bare ROM to model, with the config built from its discover analysis; default the project's ROM and romlift.toml", value: '<rom>' },
    { name: 'json', kind: 'boolean', summary: 'Prints NDJSON: the model header, one line per chunk, the diagnostics, then a summary' },
  ],
  async run(args, io) {
    const json = args.flags['json'] === true;
    const built = await modelOf(io.cwd, args.options['rom']);
    if ('refused' in built) {
      printDiagnosticsOnly(io, json, 'model', built.refused, { ok: false, exitCode: ExitCode.errors });
      return ExitCode.errors;
    }
    const { rom, model: init } = built;
    if (!init.ok) {
      printDiagnosticsOnly(io, json, 'model', init.diagnostics, { ok: false, exitCode: ExitCode.errors });
      return ExitCode.errors;
    }
    const { analysis, model } = init;
    const diagnostics: readonly Diagnostic[] = [...built.notes, ...analysis.diagnostics, ...model.diagnostics];
    const summary = modelSummary(model, exitCodeOf(diagnostics));
    if (json) {
      await writeLines(io, encodeModel(model, rom));
      await writeLines(io, [...built.notes.map(diagnosticLine), ...analysis.diagnostics.map(diagnosticLine), summaryLine(summary)]);
    } else {
      if (diagnostics.length > 0) io.stderr(diagnostics.map((d) => `${formatDiagnosticText(d)}\n`).join(''));
      io.stdout(modelText(model, summary));
    }
    return summary.exitCode;
  },
};
