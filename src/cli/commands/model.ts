// `romlift model --rom <rom> [--json]` (architecture §2.1, §3.4, D19, D62 d): the Model `generate` emits for a
// ROM. Phase 3 has no project, so the config is the one configFromDiscover builds from the ROM's discover
// analysis and the model comes from the confirm run over it (generate's confirmModel). --json prints the public
// NDJSON of encodeModel (the ModelJsonHeader line, then one ModelJsonChunk line per chunk in ROM order, built
// lazily), then the analysis diagnostics (the model's own are in the header) and the summary line. Text mode
// prints one line per module and the summary (modules, chunks, items, functions); diagnostics on stderr. Exit
// codes: 0 ok, 1 an error diagnostic (an unreadable file, E_ROM_NOT_GBA, a model error such as E_MODULE_BORDER),
// 2 usage.
import { readRom } from '../../api/files.ts';
import { encodeModel } from '../../api/model.ts';
import type { Model } from '../../api/model.ts';
import { hexAddr } from '../../api/rom.ts';
import type { Diagnostic } from '../../api/rom.ts';
import { initModel } from '../../core/workflow/generate.ts';
import { ExitCode } from '../exit-codes.ts';
import type { RunSummary } from '../exit-codes.ts';
import type { CommandSpec } from '../registry.ts';
import { diagnosticLine, summaryLine } from '../reporters/ndjson.ts';
import { columns, formatDiagnosticText, formatSummaryText } from '../reporters/text.ts';
import { exitCodeOf, printDiagnosticsOnly, usageError } from './analysis-records.ts';

/** The summary of a model run: the exit code and the model's counts. */
export function modelSummary(model: Model, exitCode: ExitCode): RunSummary {
  return {
    ok: exitCode === ExitCode.ok,
    exitCode,
    counts: { modules: model.modules.length, chunks: model.chunks.length, items: model.items.count, functions: model.functions.length },
  };
}

const MODULE_HEADER = ['module', 'kind', 'span', 'chunks', 'compiler'];

/** The text output: one row per module on stdout, then the summary line. */
export function modelText(model: Model, summary: RunSummary): string {
  const rows = model.modules.map((m) => [m.name, m.kind, `${hexAddr(m.span.start)}..${hexAddr(m.span.end)}`, String(m.chunks.count), m.compiler]);
  return `${model.modules.length === 0 ? '' : columns([MODULE_HEADER, ...rows])}model: ${formatSummaryText(summary)}\n`;
}

export const modelCommand: CommandSpec = {
  name: 'model',
  summary: 'Prints the model romlift emits for a ROM: modules, chunks and items (--json: the public NDJSON, header then one line per chunk)',
  usage: 'model --rom <rom> [--json]',
  positionals: [],
  options: [
    { name: 'rom', kind: 'string', summary: 'The ROM to model (required in phase 3: the config is built from its discover analysis)', value: '<rom>' },
    { name: 'json', kind: 'boolean', summary: 'Prints NDJSON: the model header, one line per chunk, the diagnostics, then a summary' },
  ],
  async run(args, io) {
    const json = args.flags['json'] === true;
    const path = args.options['rom'];
    if (path === undefined) return usageError(io, 'model', 'needs --rom <rom> (phase 3 has no project)');
    const loaded = await readRom(path);
    if (!loaded.ok) {
      printDiagnosticsOnly(io, json, 'model', [loaded.diagnostic], { ok: false, exitCode: ExitCode.errors });
      return ExitCode.errors;
    }
    const rom = loaded.value;
    const init = initModel(rom);
    if (!init.ok) {
      printDiagnosticsOnly(io, json, 'model', init.diagnostics, { ok: false, exitCode: ExitCode.errors });
      return ExitCode.errors;
    }
    const { analysis, model } = init;
    const diagnostics: readonly Diagnostic[] = [...analysis.diagnostics, ...model.diagnostics];
    const summary = modelSummary(model, exitCodeOf(diagnostics));
    if (json) {
      for (const line of encodeModel(model, rom)) io.stdout(line);
      io.stdout([...analysis.diagnostics.map(diagnosticLine), summaryLine(summary)].join(''));
    } else {
      if (diagnostics.length > 0) io.stderr(diagnostics.map((d) => `${formatDiagnosticText(d)}\n`).join(''));
      io.stdout(modelText(model, summary));
    }
    return summary.exitCode;
  },
};
