// `romlift explain <addr> --rom <rom> [--json]` (architecture §2.1, §9.2, D35): what the discover
// analysis decided about one address of a bare ROM. In phase 2 `--rom` is required (finding the project's
// ROM through decomp.yaml arrives with the projects). Text: the claim, the owner with its provenance, the
// trail events grouped by kind (rejections with their miss reason, bl verdicts and waits always shown),
// then the summary, restsOn and recovers of every rule that appears, and the summary line; diagnostics on
// stderr. --json: one {"type":"explain"} line holding the report (addresses as hexAddr strings, the
// claim by name), the diagnostics, then the summary line. Exit codes: 0 ok, 1 an error diagnostic, 2 usage.
import { Claim } from '../../api/analysis.ts';
import type { ClaimKind } from '../../api/analysis.ts';
import type { RuleMeta, TrailEvent, TrailKind } from '../../api/profile.ts';
import { hexAddr, parseHexAddr } from '../../api/rom.ts';
import type { Addr, Diagnostic } from '../../api/rom.ts';
import { explainOutcome } from '../../core/workflow/explain.ts';
import type { ExplainReport } from '../../core/workflow/explain.ts';
import { ExitCode } from '../exit-codes.ts';
import type { RunSummary } from '../exit-codes.ts';
import type { CommandSpec } from '../registry.ts';
import { diagnosticLine, recordLine, summaryLine } from '../reporters/ndjson.ts';
import type { RecordFields } from '../reporters/ndjson.ts';
import { formatDiagnosticText, formatSummaryText } from '../reporters/text.ts';
import { exitCodeOf, loadRom, printDiagnosticsOnly, provenanceJson, usageError } from './analyze.ts';

/** The address argument: '0x' and one to eight hex digits, or a decimal number; undefined otherwise. */
export function parseAddrArg(text: string): Addr | undefined {
  if (/^0[xX]/.test(text)) return parseHexAddr(text);
  if (!/^\d{1,10}$/.test(text)) return undefined;
  const n = Number.parseInt(text, 10);
  return n <= 0xffff_ffff ? n : undefined;
}

const CLAIM_NAMES: ReadonlyMap<number, string> = new Map(Object.entries(Claim).map(([name, kind]) => [kind, name] as const));

/** The name of a claim kind ('code', 'pool', …). */
export function claimName(kind: ClaimKind): string {
  return CLAIM_NAMES.get(kind) ?? String(kind);
}

function eventJson(e: TrailEvent): RecordFields {
  return { kind: e.kind, at: hexAddr(e.at), rule: e.rule, round: e.round, cites: e.cites.map(hexAddr), detail: e.detail };
}

function ruleJson(m: RuleMeta): RecordFields {
  return { id: m.id, summary: m.summary, restsOn: m.restsOn, recovers: m.recovers, reads: [...m.reads], adds: [...m.adds], origin: m.origin };
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
  { kind: 'verdict', label: 'bl verdicts', always: true },
  { kind: 'wait', label: 'waits', always: true },
  { kind: 'absorb', label: 'absorbs', always: false },
  { kind: 'claim', label: 'claims', always: false },
  { kind: 'place', label: 'placements', always: false },
];

function cites(list: readonly Addr[]): string {
  return list.length === 0 ? '' : ` cites ${list.map(hexAddr).join(', ')}`;
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

export const explainCommand: CommandSpec = {
  name: 'explain',
  summary: 'Explains what the analysis decided about one address: claim, owner, provenance, rejections, bl verdicts, rules',
  usage: 'explain <addr> --rom <rom> [--json]',
  positionals: [{ name: '<addr>' }],
  options: [
    { name: 'rom', kind: 'string', summary: 'The ROM to analyse (required)', value: '<rom>' },
    { name: 'json', kind: 'boolean', summary: 'Prints NDJSON: the report line, the diagnostics, then a summary' },
  ],
  async run(args, io) {
    const json = args.flags['json'] === true;
    const text = args.positionals[0] ?? '';
    const addr = parseAddrArg(text);
    if (addr === undefined) return usageError(io, 'explain', `'${text}' is not an address (0x and hex digits, or decimal)`);
    const path = args.options['rom'];
    if (path === undefined) return usageError(io, 'explain', 'needs --rom <rom>');
    const loaded = await loadRom(path);
    if (!loaded.ok) {
      printDiagnosticsOnly(io, json, 'explain', [loaded.diagnostic], { ok: false, exitCode: ExitCode.errors });
      return ExitCode.errors;
    }
    const outcome = explainOutcome(loaded.rom, addr);
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
