// The rule registry as the driver sees it (architecture §2: only driver/ imports rules/index.ts): RULES
// re-exported for the barrels, and the profile's pipeline resolved against a registry once per run.
// A pipeline id without an implementation throws RomliftInvariantError; a disabled id is skipped.
import { RomliftInvariantError } from '../../../foundation/diagnostics/diagnostic.ts';
import type { Addr } from '../../../foundation/rom/span.ts';
import { compareCodeUnits } from '../../../foundation/util/sorted.ts';
import type { CompilerProfile, Pipeline } from '../../profile/types.ts';
import type { RuleId } from '../../provenance/rule-id.ts';
import type { Origin } from '../../provenance/vocabulary.ts';
import type {
  AcceptRule,
  AcceptVeto,
  AnalysisTuning,
  BlVerdictRule,
  ClaimRule,
  GapAbsorb,
  GapHead,
  GapPrefer,
  GapProposer,
  GapSkip,
  HarvestRule,
  QueueRule,
  ReadingShape,
  RegionRule,
  RuleKind,
  RuleOfKind,
  RuleRegistry,
  SeedRule,
  ValidityRule,
} from '../types.ts';
import type { ResolvedPolicy } from '../walk/cursor.ts';

export { RULES } from '../rules/index.ts';

/** A rule with its id, resolved from a pipeline slot. */
export interface Resolved<R> {
  readonly id: RuleId;
  readonly rule: R;
}

export interface ResolvedRules {
  readonly seed: readonly Resolved<SeedRule>[];
  readonly harvest: readonly Resolved<HarvestRule>[];
  readonly queue: readonly Resolved<QueueRule>[];
  readonly walk: readonly ResolvedPolicy[];
  readonly blVerdict: readonly Resolved<BlVerdictRule>[];
  readonly blRefine: readonly Resolved<BlVerdictRule>[];
  readonly validity: readonly Resolved<ValidityRule>[];
  readonly accept: readonly Resolved<AcceptRule>[];
  readonly veto: readonly Resolved<AcceptVeto>[];
  readonly claim: readonly Resolved<ClaimRule>[];
  /** The extent rule: the first claim rule with extentEnd; the code end when no claim rule has one. */
  readonly extentEnd: (shape: ReadingShape, profile: CompilerProfile) => Addr;
  readonly gap: {
    readonly absorb?: Resolved<GapAbsorb>;
    readonly head?: Resolved<GapHead>;
    /** Positional: forward[0] and forward[1] are the pair; undefined where a rule is disabled. */
    readonly forward: readonly (Resolved<GapProposer> | undefined)[];
    readonly prefer?: Resolved<GapPrefer>;
    readonly skip?: Resolved<GapSkip>;
    readonly endAnchor?: Resolved<GapProposer>;
    readonly backward?: Resolved<GapProposer>;
  };
  readonly region: readonly Resolved<RegionRule>[];
  /** Each slot's index of every id, for the worklist's rule rank. */
  readonly rank: ReadonlyMap<RuleId, number>;
  /** The origin of every proposing rule: its meta.origin. */
  readonly origin: ReadonlyMap<RuleId, Origin>;
}

function originsOf(registry: RuleRegistry): ReadonlyMap<RuleId, Origin> {
  const out = new Map<RuleId, Origin>();
  for (const id of (Object.keys(registry) as RuleId[]).sort(compareCodeUnits)) {
    const origin = registry[id]?.meta.origin;
    if (origin !== undefined) out.set(id, origin);
  }
  return out;
}

function kinds<K extends RuleKind>(...k: K[]): readonly K[] {
  return k;
}

/** Resolves the profile's pipeline against `registry`, honouring tuning.disabled. */
export function resolveRules(profile: CompilerProfile, registry: RuleRegistry, tuning: AnalysisTuning): ResolvedRules {
  const disabled = new Set<RuleId>(tuning.disabled);
  const rank = new Map<RuleId, number>();
  const one = <K extends RuleKind>(id: RuleId, allowed: readonly K[], index: number): Resolved<RuleOfKind<K>> | undefined => {
    rank.set(id, index);
    if (disabled.has(id)) return undefined;
    const rule = Object.hasOwn(registry, id) ? registry[id] : undefined;
    if (rule === undefined) throw new RomliftInvariantError(`profile ${profile.id}: pipeline rule ${id} has no implementation`);
    if (!(allowed as readonly string[]).includes(rule.kind)) {
      throw new RomliftInvariantError(`profile ${profile.id}: rule ${id} is a '${rule.kind}' rule, not one of ${allowed.join(', ')}`);
    }
    return { id, rule: rule as RuleOfKind<K> };
  };
  const many = <K extends RuleKind>(ids: readonly RuleId[], allowed: readonly K[]): Resolved<RuleOfKind<K>>[] =>
    ids.flatMap((id, i) => {
      const r = one(id, allowed, i);
      return r === undefined ? [] : [r];
    });
  const p: Pipeline = profile.pipeline;
  const bl = many(p.bl, kinds('bl'));
  const accept = many(p.accept, kinds('accept', 'accept-veto'));
  const claim = many(p.claim, kinds('claim'));
  const extent = claim.find((c) => c.rule.extentEnd !== undefined)?.rule.extentEnd;
  const absorb = one(p.gap.absorb, kinds('gap-absorb'), 0);
  const head = one(p.gap.head, kinds('gap-head'), 0);
  const prefer = one(p.gap.prefer, kinds('gap-prefer'), 0);
  const skip = one(p.gap.skip, kinds('gap-skip'), 0);
  const endAnchor = one(p.gap.endAnchor, kinds('gap'), 0);
  const backward = one(p.gap.backward, kinds('gap'), 0);
  const walk = many(p.walk, kinds('walk'));
  return {
    seed: many(p.seed, kinds('seed')),
    harvest: many(p.harvest, kinds('harvest')),
    queue: many(p.queue, kinds('queue')),
    walk,
    blVerdict: bl.filter((b) => b.rule.refines !== true),
    blRefine: bl.filter((b) => b.rule.refines === true),
    validity: many(p.validity, kinds('valid')),
    accept: accept.flatMap((a) => (a.rule.kind === 'accept' ? [{ id: a.id, rule: a.rule }] : [])),
    veto: accept.flatMap((a) => (a.rule.kind === 'accept-veto' ? [{ id: a.id, rule: a.rule }] : [])),
    claim,
    extentEnd: extent ?? ((shape) => shape.codeEnd),
    gap: {
      ...(absorb === undefined ? {} : { absorb }),
      ...(head === undefined ? {} : { head }),
      forward: p.gap.forward.map((id, i) => one(id, kinds('gap'), i)),
      ...(prefer === undefined ? {} : { prefer }),
      ...(skip === undefined ? {} : { skip }),
      ...(endAnchor === undefined ? {} : { endAnchor }),
      ...(backward === undefined ? {} : { backward }),
    },
    region: many(p.region, kinds('region')),
    rank,
    origin: originsOf(registry),
  };
}
