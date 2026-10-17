// g2.rule-registry (architecture §4.1, §13, D7): every analysis rule has complete metadata (summary,
// restsOn, recovers, reads, adds, and origin for seed and gap rules) whose id is its registry key; every
// rule sits in exactly one pipeline slot of every shipped profile; every pipeline id has an
// implementation; and every rule has a unit test file test/unit/analysis/rules/<family>/<name>[.*].test.ts (the
// test tree mirrors src/core/analysis/rules, D59).
//
// Expected exports, for the phase-2 lead to align: `RULES` (romlift/internal; the concatenated family
// records of core/analysis/rules/index.ts, keyed by rule id, re-exported through the driver because only
// driver/ may import that index) and `PROFILES` (romlift), whose pipelines follow architecture §4.3.
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { gate } from './gate.ts';

interface RuleMeta {
  readonly id: string;
  readonly summary: string;
  readonly restsOn: string;
  readonly recovers: string;
  readonly reads: readonly string[];
  readonly adds: readonly string[];
  readonly origin?: string;
}

interface RegisteredRule {
  readonly meta: RuleMeta;
  readonly kind: string;
}

type Rules = Readonly<Record<string, RegisteredRule>>;
type Profiles = Readonly<Record<string, { readonly id: string; readonly pipeline: Readonly<Record<string, unknown>> }>>;

const ORIGIN_FAMILIES: ReadonlySet<string> = new Set(['seed', 'gap']);

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Every rule id named by a pipeline, in slot order; `passes` names passes, not rules. */
function pipelineIds(pipeline: Readonly<Record<string, unknown>>): readonly string[] {
  const ids: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') ids.push(value);
    else if (Array.isArray(value)) for (const item of value as readonly unknown[]) visit(item);
    else if (typeof value === 'object' && value !== null) {
      const record = value as Readonly<Record<string, unknown>>;
      for (const key of Object.keys(record).sort(byCodeUnit)) visit(record[key]);
    }
  };
  for (const key of Object.keys(pipeline).sort(byCodeUnit)) if (key !== 'passes') visit(pipeline[key]);
  return ids;
}

function text(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

async function testFiles(dir: string): Promise<readonly string[]> {
  try {
    const out: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) out.push(...(await testFiles(path.join(dir, entry.name))));
      else if (entry.name.endsWith('.test.ts')) out.push(entry.name);
    }
    return out;
  } catch {
    return [];
  }
}

gate({
  id: 'g2.rule-registry',
  phase: 2,
  tier: 'ci',
  needs: ['RULES', 'PROFILES'],
  async run(cx) {
    const rules = cx.need<Rules>('RULES');
    const profiles = cx.need<Profiles>('PROFILES');
    const ids = Object.keys(rules).sort(byCodeUnit);
    if (ids.length === 0) throw new Error('RULES is empty');
    const problems: string[] = [];

    for (const id of ids) {
      const rule = rules[id];
      const meta = rule?.meta;
      if (rule === undefined || meta === undefined) {
        problems.push(`${id}: no meta`);
        continue;
      }
      if (meta.id !== id) problems.push(`${id}: registered under another id than its meta.id '${String(meta.id)}'`);
      for (const field of ['summary', 'restsOn', 'recovers'] as const) if (!text(meta[field])) problems.push(`${id}: empty ${field}`);
      for (const field of ['reads', 'adds'] as const) if (!Array.isArray(meta[field])) problems.push(`${id}: ${field} is not a list`);
      const family = id.split('.')[0] ?? '';
      if (ORIGIN_FAMILIES.has(family) && !text(meta.origin)) problems.push(`${id}: a ${family} rule without origin`);
    }

    const profileIds = Object.keys(profiles).sort(byCodeUnit);
    if (profileIds.length === 0) throw new Error('PROFILES is empty');
    for (const profileId of profileIds) {
      const slots = pipelineIds(profiles[profileId]?.pipeline ?? {});
      const count = new Map<string, number>();
      for (const slotId of slots) count.set(slotId, (count.get(slotId) ?? 0) + 1);
      for (const slotId of [...new Set(slots)].sort(byCodeUnit)) {
        if (rules[slotId] === undefined) problems.push(`profile ${profileId}: pipeline id ${slotId} has no implementation`);
      }
      for (const id of ids) {
        const n = count.get(id) ?? 0;
        if (n !== 1) problems.push(`profile ${profileId}: ${id} is in ${n} pipeline slots`);
      }
    }

    for (const id of ids) {
      const family = id.split('.')[0] ?? '';
      const name = id.slice(family.length + 1);
      const files = await testFiles(path.join(cx.repoRoot, 'test', 'unit', 'analysis', 'rules', family));
      if (!files.some((file) => file === `${name}.test.ts` || (file.startsWith(`${name}.`) && file.endsWith('.test.ts')))) {
        problems.push(`${id}: no unit test test/unit/analysis/rules/${family}/${name}.test.ts`);
      }
    }

    if (problems.length > 0) throw new Error(`rule registry: ${problems.join('; ')}`);
    cx.note(`${ids.length} rules with complete metadata, each in one slot of ${profileIds.join(', ')}, each with a unit test`);
  },
});
