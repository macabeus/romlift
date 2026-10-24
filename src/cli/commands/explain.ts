// `romlift explain <addr> [--rom <rom>] [--json]` (architecture §2.1, §9.2, D35): what romlift decided about one
// address. With --rom, the discover analysis of a bare ROM and the model built from it (phases 2 and 3); inside a
// project without --rom (phase 4), the confirm analysis `generate` runs over the project's ROM and romlift.toml and the
// model it emitted, so it explains what `generate` wrote (another ROM than [rom] sha1 records is E_ROM_SHA1_MISMATCH).
// Text: the claim, the owner with its provenance, the chunk and item, the name of the function holding the address
// and its source (phase 4: `toml`, with the entry's `from` key when it has one, or `analysis` for the default
// spelling), the trail events grouped by kind (rejections with their miss reason, verdicts of bl sites, walk steps
// and the gap's prefer and skip slots, and waits always shown), then the summary, restsOn and recovers of every rule
// that appears, and the summary line; diagnostics on stderr. --json: one {"type":"explain"} line holding the report
// (addresses as hexAddr strings, the claim by name, an instruction item with its spec id and its `.inst` text, the
// name as {value, source, from?}), the diagnostics, then the summary line. Exit codes: 0 ok, 1 an error diagnostic,
// 2 usage.
import { claimName } from '../../api/analysis.ts';
import { readRom } from '../../api/files.ts';
import { formatRaw } from '../../api/isa.ts';
import type { Insn } from '../../api/isa.ts';
import type { Item } from '../../api/model.ts';
import type { RuleMeta, TrailEvent, TrailKind } from '../../api/profile.ts';
import { hexAddr, parseHexAddr } from '../../api/rom.ts';
import type { Addr, Diagnostic } from '../../api/rom.ts';
import { explainOutcome, explainProject } from '../../core/workflow/explain.ts';
import type { ExplainChunk, ExplainName, ExplainOutcome, ExplainReport } from '../../core/workflow/explain.ts';
import { readProject, resolveFrom } from '../../shell/project/read-inputs.ts';
import { ExitCode } from '../exit-codes.ts';
import type { RunSummary } from '../exit-codes.ts';
import type { CommandSpec } from '../registry.ts';
import { diagnosticLine, recordLine, summaryLine } from '../reporters/ndjson.ts';
import type { RecordFields } from '../reporters/ndjson.ts';
import { formatDiagnosticText, formatSummaryText } from '../reporters/text.ts';
import { exitCodeOf, printDiagnosticsOnly, provenanceJson, spanJson, usageError } from './command-common.ts';

/** The address argument: '0x' and one to eight hex digits, or a decimal number; undefined otherwise. */
export function parseAddrArg(text: string): Addr | undefined {
  if (/^0[xX]/.test(text)) return parseHexAddr(text);
  if (!/^\d{1,10}$/.test(text)) return undefined;
  const n = Number.parseInt(text, 10);
  return n <= 0xffff_ffff ? n : undefined;
}

function eventJson(e: TrailEvent): RecordFields {
  return { kind: e.kind, at: hexAddr(e.at), rule: e.rule, round: e.round, cites: e.cites.map(hexAddr), detail: e.detail };
}

function ruleJson(m: RuleMeta): RecordFields {
  return { id: m.id, summary: m.summary, restsOn: m.restsOn, recovers: m.recovers, reads: [...m.reads], adds: [...m.adds], origin: m.origin };
}

function insnJson(insn: Insn): RecordFields {
  return { mode: insn.mode, size: insn.size, specId: insn.specId, text: formatRaw(insn) };
}

/** An item as JSON: its kind and span, and what its kind carries (addresses and words as hexAddr strings). */
export function itemJson(item: Item): RecordFields {
  const base = { kind: item.kind, span: spanJson(item.span) };
  switch (item.kind) {
    case 'insn':
      return { ...base, insn: insnJson(item.insn) };
    case 'raw-insn':
      return { ...base, reason: item.reason, insn: item.insn === undefined ? undefined : insnJson(item.insn) };
    case 'pool':
      return { ...base, value: hexAddr(item.value) };
    case 'table-entry':
      return { ...base, target: hexAddr(item.target), thumbBit: item.thumbBit };
    case 'padding':
      return base;
    case 'data':
      return { ...base, note: item.note };
  }
}

function chunkJson(chunk: ExplainChunk): RecordFields {
  return { name: chunk.name, kind: chunk.kind, module: chunk.module };
}

/** Where a name comes from, as explain prints it: `toml` (the [functions] entry) or `analysis` (the default spelling). */
export function nameSourceText(name: ExplainName): 'toml' | 'analysis' {
  return name.source.kind === 'toml' ? 'toml' : 'analysis';
}

function nameJson(name: ExplainName): RecordFields {
  return { value: name.value, source: nameSourceText(name), from: name.source.kind === 'toml' ? name.source.from : undefined };
}

/** The {"type":"explain"} record of a report. */
export function explainRecord(report: ExplainReport): RecordFields {
  return {
    addr: hexAddr(report.addr),
    claim: claimName(report.claim),
    owner:
      report.owner === undefined
        ? undefined
        : { entry: hexAddr(report.owner.entry), origin: report.owner.origin, provenance: report.owner.provenance.map(provenanceJson) },
    chunk: report.chunk === undefined ? undefined : chunkJson(report.chunk),
    item: report.item === undefined ? undefined : itemJson(report.item),
    name: report.name === undefined ? undefined : nameJson(report.name),
    events: report.events.map(eventJson),
    rules: report.rules.map(ruleJson),
  };
}

/** The --json output: the report line, the diagnostics, then the summary. */
export function explainNdjson(report: ExplainReport, diagnostics: readonly Diagnostic[], summary: RunSummary): string {
  return [recordLine('explain', explainRecord(report)), ...diagnostics.map(diagnosticLine), summaryLine(summary)].join('');
}

/** The event groups of the text output, in order; the always-shown ones print "none" when empty. */
const GROUPS: readonly { readonly kind: TrailKind; readonly label: string; readonly always: boolean }[] = [
  { kind: 'propose', label: 'proposals', always: false },
  { kind: 'accept', label: 'accepts', always: false },
  { kind: 'reject', label: 'rejections', always: true },
  { kind: 'verdict', label: 'verdicts', always: true },
  { kind: 'wait', label: 'waits', always: true },
  { kind: 'absorb', label: 'absorbs', always: false },
  { kind: 'claim', label: 'claims', always: false },
  { kind: 'place', label: 'placements', always: false },
];

function cites(list: readonly Addr[]): string {
  return list.length === 0 ? '' : ` cites ${list.map(hexAddr).join(', ')}`;
}

/** What an item holds, after its kind and span. */
function itemDetail(item: Item): string {
  switch (item.kind) {
    case 'insn':
      return `: ${formatRaw(item.insn)}`;
    case 'raw-insn':
      return ` (${item.reason})${item.insn === undefined ? '' : `: ${formatRaw(item.insn)}`}`;
    case 'pool':
      return `: value ${hexAddr(item.value)}`;
    case 'table-entry':
      return `: target ${hexAddr(item.target)}${item.thumbBit ? ' (thumb bit set)' : ''}`;
    case 'padding':
      return '';
    case 'data':
      return item.note === undefined ? '' : ` (${item.note})`;
  }
}

/** The chunk and item lines of the text output (phase 3). */
function modelText(report: ExplainReport): string {
  const chunk = report.chunk === undefined ? 'none (outside the model)' : `${report.chunk.name} (${report.chunk.kind}) in module ${report.chunk.module}`;
  const item = report.item === undefined ? 'none' : `${report.item.kind} ${hexAddr(report.item.span.start)}..${hexAddr(report.item.span.end)}${itemDetail(report.item)}`;
  const name = report.name === undefined ? 'none' : `${report.name.value} (${nameSourceText(report.name)}${report.name.source.kind === 'toml' && report.name.source.from !== undefined ? `, from ${report.name.source.from}` : ''})`;
  return `  chunk: ${chunk}\n  item: ${item}\n  name: ${name}\n`;
}

function eventText(e: TrailEvent): string {
  return `    ${hexAddr(e.at)} ${e.rule} round ${e.round}${cites(e.cites)}${e.detail === undefined ? '' : `: ${e.detail}`}\n`;
}

/** The text output of a report: the explanation and the summary line on stdout. */
export function explainText(report: ExplainReport, summary: RunSummary): string {
  let out = `${hexAddr(report.addr)}\n  claim: ${claimName(report.claim)}\n`;
  if (report.owner === undefined) {
    out += '  owner: none (no function extent covers it)\n';
  } else {
    out += `  owner: ${hexAddr(report.owner.entry)} (origin ${report.owner.origin})\n  provenance:\n`;
    for (const p of report.owner.provenance) out += `    ${p.rule} round ${p.round}${cites(p.cites)}${p.note === undefined ? '' : `: ${p.note}`}\n`;
  }
  out += modelText(report);
  for (const group of GROUPS) {
    const events = report.events.filter((e) => e.kind === group.kind);
    if (events.length === 0) {
      if (group.always) out += `  ${group.label}: none\n`;
      continue;
    }
    out += `  ${group.label} (${events.length}):\n${events.map(eventText).join('')}`;
  }
  if (report.rules.length === 0) out += '  rules: none\n';
  else {
    out += `  rules (${report.rules.length}):\n`;
    for (const m of report.rules) out += `    ${m.id}: ${m.summary}\n      rests on: ${m.restsOn}\n      recovers: ${m.recovers}\n`;
  }
  return `${out}explain: ${formatSummaryText(summary)}\n`;
}

/** The explanation of `addr` in the project that holds `from`, or on the bare ROM at `romPath`. */
async function explainAt(from: string, romPath: string | undefined, addr: Addr): Promise<ExplainOutcome | { readonly refused: readonly Diagnostic[] }> {
  if (romPath === undefined) {
    const read = await readProject(from, { withoutC: true });
    if (!read.ok) return { refused: read.diagnostics };
    const explained = explainProject(read.value.inputs, addr);
    return explained.ok ? explained : { refused: explained.diagnostics };
  }
  const loaded = await readRom(resolveFrom(from, romPath));
  if (!loaded.ok) return { refused: [loaded.diagnostic] };
  return explainOutcome(loaded.value, addr);
}

export const explainCommand: CommandSpec = {
  name: 'explain',
  summary: 'Explains what romlift decided about one address: claim, owner, provenance, chunk, item, rejections, verdicts, rules',
  usage: 'explain <addr> [--rom <rom>] [--json]',
  positionals: [{ name: '<addr>' }],
  options: [
    { name: 'rom', kind: 'string', summary: "A bare ROM to analyse (discover mode); default the project's ROM and romlift.toml (confirm mode)", value: '<rom>' },
    { name: 'json', kind: 'boolean', summary: 'Prints NDJSON: the report line, the diagnostics, then a summary' },
  ],
  async run(args, io) {
    const json = args.flags['json'] === true;
    const text = args.positionals[0] ?? '';
    const addr = parseAddrArg(text);
    if (addr === undefined) return usageError(io, 'explain', `'${text}' is not an address (0x and hex digits, or decimal)`);
    const outcome = await explainAt(io.cwd, args.options['rom'], addr);
    if ('refused' in outcome) {
      printDiagnosticsOnly(io, json, 'explain', outcome.refused, { ok: false, exitCode: ExitCode.errors });
      return ExitCode.errors;
    }
    const exitCode = exitCodeOf(outcome.diagnostics);
    const summary: RunSummary = { ok: exitCode === ExitCode.ok, exitCode };
    if (json) {
      io.stdout(explainNdjson(outcome.report, outcome.diagnostics, summary));
    } else {
      if (outcome.diagnostics.length > 0) io.stderr(outcome.diagnostics.map((d) => `${formatDiagnosticText(d)}\n`).join(''));
      io.stdout(explainText(outcome.report, summary));
    }
    return exitCode;
  },
};
