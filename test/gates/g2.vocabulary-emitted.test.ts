// g2.vocabulary-emitted (architecture §8.3, §13): every miss reason in MISS_REASONS and every origin in
// ORIGINS is emitted by some analysis rule (a validity rule's `reason`, a rule's `meta.origin`), so the
// closed lists hold no id that nothing can produce.
//
// Expected exports: MISS_REASONS and ORIGINS (romlift, phase 1; a list of ids, a list of {id}, or a record
// keyed by id), and RULES (romlift/internal, see g2.rule-registry).
import { gate } from './gate.ts';

interface RegisteredRule {
  readonly meta: { readonly id: string; readonly origin?: string };
  readonly kind: string;
  readonly reason?: string;
  readonly origin?: string;
}

type Rules = Readonly<Record<string, RegisteredRule>>;

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The ids of a closed vocabulary, whichever of the three shapes it has. */
function idsOf(name: string, value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return (value as readonly unknown[]).map((item) => {
      if (typeof item === 'string') return item;
      if (typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string') return (item as { id: string }).id;
      throw new Error(`${name} holds an entry that is neither an id nor {id}`);
    });
  }
  if (typeof value === 'object' && value !== null) return Object.keys(value);
  throw new Error(`${name} is neither a list nor a record`);
}

gate({
  id: 'g2.vocabulary-emitted',
  phase: 2,
  tier: 'ci',
  needs: ['RULES', 'MISS_REASONS', 'ORIGINS'],
  async run(cx) {
    const rules = cx.need<Rules>('RULES');
    const reasons = new Set<string>();
    const origins = new Set<string>();
    for (const id of Object.keys(rules).sort(byCodeUnit)) {
      const rule = rules[id];
      if (rule === undefined) continue;
      if (typeof rule.reason === 'string') reasons.add(rule.reason);
      for (const origin of [rule.meta.origin, rule.origin]) if (typeof origin === 'string') origins.add(origin);
    }
    const missReasons = idsOf('MISS_REASONS', cx.need<unknown>('MISS_REASONS'));
    const originIds = idsOf('ORIGINS', cx.need<unknown>('ORIGINS'));
    const silentReasons = missReasons.filter((id) => !reasons.has(id));
    const silentOrigins = originIds.filter((id) => !origins.has(id));
    const problems: string[] = [];
    if (silentReasons.length > 0) problems.push(`miss reasons no rule emits: ${silentReasons.join(', ')}`);
    if (silentOrigins.length > 0) problems.push(`origins no rule emits: ${silentOrigins.join(', ')}`);
    if (problems.length > 0) throw new Error(problems.join('; '));
    cx.note(`${missReasons.length} miss reasons and ${originIds.length} origins, each emitted by a rule`);
  },
});
