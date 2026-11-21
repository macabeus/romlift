// `romlift update [--write] [--json]` (architecture §2.1, §6.5): inside a project, what the analysis proposes for its
// romlift.toml (core/workflow/update.ts): one line per proposal (text) or
// {"type":"proposal","kind","addr","mode","entryPoint"?,"rule"} (--json; entryPoint: an [entry_points] entry, D116), the reports (W_LISTED_INVALID), the patch as a
// unified diff ({"type":"patch","path","changed","diff"} with --json), then the summary. While the config's
// [signatures] is enabled, the built signature files are located (shell/signatures/locate.ts) and the workflow adds
// their screened proposals (a function or symbol with its name and `from`, a library module); a proposal record then
// carries `from` (`sig:<library>@<version>`) and a module its `library`. The patch keeps every comment and re-parses;
// --write saves it (shell/config/save.ts, under the project lock), and nothing else writes the TOML but `init` and
// `rename`. Exit codes: 0 ok, 1 an error diagnostic (no project, another ROM, E_TOML_PATCH_REFUSED, a write that
// failed), 2 usage (an argument).
import type { Proposal } from '../../api/config-types.ts';
import { sourceKey } from '../../api/config-types.ts';
import type { Diagnostic } from '../../api/rom.ts';
import { hexAddr } from '../../api/rom.ts';
import { unifiedDiff } from '../../api/workflow-one-shot.ts';
import { staleConfigProblems, updateProject } from '../../core/workflow/update.ts';
import { saveConfig } from '../../shell/config/save.ts';
import { withProjectLock } from '../../shell/project/lock.ts';
import { readProject, readProjectTexts } from '../../shell/project/read-inputs.ts';
import { loadSignatureFiles } from '../../shell/signatures/locate.ts';
import { ExitCode } from '../exit-codes.ts';
import type { RunSummary } from '../exit-codes.ts';
import type { CliIo } from '../registry.ts';
import type { CommandSpec } from '../registry.ts';
import { diagnosticLine, recordLine, summaryLine } from '../reporters/ndjson.ts';
import type { RecordFields } from '../reporters/ndjson.ts';
import { formatDiagnosticText, formatSummaryText } from '../reporters/text.ts';
import { exitCodeOf, printDiagnosticsOnly, writeLines } from './command-common.ts';

/** The {"type":"proposal"} record of one proposal. */
export function proposalRecord(p: Proposal): RecordFields {
  switch (p.kind) {
    case 'function':
      return {
        kind: p.kind,
        addr: hexAddr(p.addr),
        mode: p.mode,
        name: p.name,
        size: p.size,
        entryPoint: p.entryPoint,
        source: p.source.kind,
        rule: 'rule' in p.source ? p.source.rule : undefined,
        from: sourceKey(p.source),
      };
    case 'symbol':
      return {
        kind: p.kind,
        addr: hexAddr(p.addr),
        name: p.name,
        size: p.size,
        symbolType: p.type,
        source: p.source.kind,
        rule: 'rule' in p.source ? p.source.rule : undefined,
        from: sourceKey(p.source),
      };
    case 'module':
      return {
        kind: p.kind,
        addr: hexAddr(p.start),
        name: p.name,
        moduleKind: p.moduleKind,
        library: p.library === undefined ? undefined : `${p.library.name}@${p.library.version}`,
        source: p.source.kind,
      };
    case 'override':
      return { kind: p.kind, addr: hexAddr(p.span.start), end: hexAddr(p.span.end), source: p.source.kind };
  }
}

function proposalText(p: Proposal): string {
  const record = proposalRecord(p);
  const rule = typeof record['rule'] === 'string' ? ` (${record['rule']})` : '';
  const label = record['entryPoint'] === true ? ', entry point' : '';
  const name = typeof record['name'] === 'string' && p.kind !== 'module' ? ` ${record['name']}` : '';
  const from = typeof record['from'] === 'string' ? `, from ${record['from']}` : '';
  const library =
    typeof record['library'] === 'string' ? ` ${String(record['name'])}, library ${record['library']}` : '';
  return `${p.kind} ${String(record['addr'])}${typeof record['mode'] === 'string' ? ` ${record['mode']}` : ''}${name}${library}${label}${from}${rule}\n`;
}

/** Runs `update [--write]` in the project that holds `io.cwd`. */
async function runUpdate(io: CliIo, json: boolean, write: boolean): Promise<ExitCode> {
  const read = await readProject(io.cwd, { withoutC: true });
  if (!read.ok) {
    printDiagnosticsOnly(io, json, 'update', read.diagnostics, { ok: false, exitCode: ExitCode.errors });
    return ExitCode.errors;
  }
  const project = read.value;
  const located = await loadSignatureFiles(io);
  const plan = updateProject({ ...project.inputs, signatureFiles: located.files, signatureNotes: located.diagnostics });
  if (!plan.ok) {
    printDiagnosticsOnly(io, json, 'update', plan.diagnostics, { ok: false, exitCode: ExitCode.errors });
    return ExitCode.errors;
  }
  const path = project.config.project.config;
  let diagnostics: readonly Diagnostic[] = plan.diagnostics;
  let written = false;
  if (write && plan.changed) {
    // Under the lock: the config on disk must still be the text the plan was made from (D75 m).
    const saved = await withProjectLock(project.dir, async () => {
      const now = await readProjectTexts(project.dir, [path]);
      const problem = now.ok
        ? staleConfigProblems(path, project.inputs.configText, now.value.get(path) ?? '')[0]
        : now.diagnostics[0];
      return problem === undefined
        ? saveConfig(project.dir, plan.text, path)
        : ({ ok: false, diagnostic: problem } as const);
    });
    if (!saved.ok) diagnostics = [...diagnostics, ...saved.diagnostics];
    else {
      diagnostics = [...diagnostics, ...saved.diagnostics];
      if (saved.value.ok) written = true;
      else diagnostics = [...diagnostics, saved.value.diagnostic];
    }
  }
  const exitCode = exitCodeOf(diagnostics);
  const diff = unifiedDiff(project.inputs.configText, plan.text, path);
  const summary: RunSummary = {
    ok: exitCode === ExitCode.ok,
    exitCode,
    counts: { proposals: plan.proposals.length, written: written ? 1 : 0, diagnostics: diagnostics.length },
  };
  if (json) {
    await writeLines(io, [
      ...plan.proposals.map((p) => recordLine('proposal', proposalRecord(p))),
      recordLine('patch', { path, changed: plan.changed, written, diff }),
      ...diagnostics.map(diagnosticLine),
      summaryLine(summary),
    ]);
    return exitCode;
  }
  if (diagnostics.length > 0) io.stderr(diagnostics.map((d) => `${formatDiagnosticText(d)}\n`).join(''));
  const verdict = !plan.changed
    ? `${path} is up to date`
    : written
      ? `wrote ${path}`
      : `run \`romlift update --write\` to apply the patch to ${path}`;
  await writeLines(io, [
    ...plan.proposals.map(proposalText),
    diff,
    `${verdict}\n`,
    `update: ${formatSummaryText(summary)}\n`,
  ]);
  return exitCode;
}

export const updateCommand: CommandSpec = {
  name: 'update',
  summary:
    'Inside a project: proposes what the analysis finds that romlift.toml lacks, as a patch that keeps its comments',
  usage: 'update [--write] [--json]',
  positionals: [],
  options: [
    { name: 'write', kind: 'boolean', summary: 'Saves the patched romlift.toml' },
    {
      name: 'json',
      kind: 'boolean',
      summary: 'Prints NDJSON: one line per proposal, the patch, the diagnostics, then a summary',
    },
  ],
  run(args, io) {
    return runUpdate(io, args.flags['json'] === true, args.flags['write'] === true);
  },
};
