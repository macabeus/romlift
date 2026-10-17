// g1.doctor (architecture §2.1, §13): `romlift doctor --json` reports the binutils version, re-assembles
// the corpus with the user's `as`, probes R_ARM_THM_JUMP11, and reports agbcc and old_agbcc either way.
//
// FROZEN output (NDJSON on stdout, exit 0):
//   {"type":"check","id":"binutils"|"corpus"|"thumb-jump11"|"agbcc"|"old_agbcc","status":"ok"|"missing"|"fail","detail":string}
//   {"type":"diagnostic",...}                       (optional, any number)
//   {"type":"summary","ok":boolean,"exitCode":number}   (last line)
import path from 'node:path';
import { gate, type ExecResult } from './gate.ts';

type CheckId = 'binutils' | 'corpus' | 'thumb-jump11' | 'agbcc' | 'old_agbcc';
type Status = 'ok' | 'missing' | 'fail';

type DoctorLine =
  | { readonly type: 'check'; readonly id: CheckId; readonly status: Status; readonly detail: string }
  | { readonly type: 'diagnostic' }
  | { readonly type: 'summary'; readonly ok: boolean; readonly exitCode: number };

const CHECK_IDS: readonly CheckId[] = ['binutils', 'corpus', 'thumb-jump11', 'agbcc', 'old_agbcc'];
const STATUSES: readonly Status[] = ['ok', 'missing', 'fail'];
const REQUIRED_OK: readonly CheckId[] = ['binutils', 'corpus', 'thumb-jump11'];
const REPORTED: readonly CheckId[] = ['agbcc', 'old_agbcc'];

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

gate({
  id: 'g1.doctor',
  phase: 1,
  tier: 'ci',
  inputs: ['toolchain'],
  needs: ['runDoctor'],
  async run(cx) {
    const run = await cx.exec(process.execPath, ['--conditions=source', path.join(cx.repoRoot, 'src', 'cli', 'main.ts'), 'doctor', '--json'], {
      cwd: cx.repoRoot,
    });
    if (run.code !== 0) throw new Error(`romlift doctor --json exited ${run.code}:\n${tail(run)}`);
    const lines = cx.jsonLines<DoctorLine>(run.stdout);
    const last = lines[lines.length - 1];
    if (last?.type !== 'summary') throw new Error('the last line of doctor --json is not a summary');
    if (!last.ok || last.exitCode !== 0) throw new Error(`doctor summary: ok ${String(last.ok)}, exitCode ${last.exitCode}`);

    const checks = new Map<CheckId, Extract<DoctorLine, { type: 'check' }>>();
    for (const line of lines.slice(0, -1)) {
      if (line.type === 'summary') throw new Error('doctor --json printed a summary before its last line');
      if (line.type !== 'check') {
        if (line.type !== 'diagnostic') throw new Error(`doctor --json printed a line of unknown type '${String((line as { type: unknown }).type)}'`);
        continue;
      }
      if (!CHECK_IDS.includes(line.id)) throw new Error(`doctor reported an unknown check '${line.id}'`);
      if (!STATUSES.includes(line.status)) throw new Error(`doctor check ${line.id} has status '${String(line.status)}'`);
      if (checks.has(line.id)) throw new Error(`doctor reported check ${line.id} twice`);
      checks.set(line.id, line);
    }
    for (const id of REQUIRED_OK) {
      const check = checks.get(id);
      if (check === undefined) throw new Error(`doctor did not report the ${id} check`);
      if (check.status !== 'ok') throw new Error(`doctor check ${id} is ${check.status}: ${check.detail}`);
    }
    for (const id of REPORTED) {
      if (!checks.has(id)) throw new Error(`doctor did not report ${id} (present or not)`);
    }
    const describe = (id: CheckId): string => {
      const check = checks.get(id);
      return check === undefined ? `${id} ?` : `${id} ${check.status}${check.detail === '' ? '' : ` (${check.detail})`}`;
    };
    cx.note(CHECK_IDS.map(describe).join('; '));
  },
});
