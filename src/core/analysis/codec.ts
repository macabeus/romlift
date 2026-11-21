// The analysis codec (architecture §3.3, D19): an AnalysisResult as canonical JSON of schema
// 'romlift/analysis@1' (sorted keys, addresses as '0x' and eight upper-case hex digits, other numbers
// as numbers), streamed as string chunks, and its strict reader. One codec per type below describes
// both directions, so encoding and decoding cannot drift: decodeAnalysis(encodeAnalysis(r)) equals r,
// and the encoding of equal results is the same text whatever their key order in memory. Members that
// are undefined are left out, as exactOptionalPropertyTypes requires.
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic, Severity } from '../../foundation/diagnostics/diagnostic.ts';
import { canonicalJson } from '../../foundation/formats/canonical-json.ts';
import type { JsonValue } from '../../foundation/formats/types.ts';
import type { Addr, Mode, Span } from '../../foundation/rom/span.ts';
import { hexAddr, parseHexAddr } from '../../foundation/util/hex.ts';
import type { Provenance, Rejection } from '../provenance/provenance.ts';
import { isRuleId } from '../provenance/rule-id.ts';
import type { RuleId } from '../provenance/rule-id.ts';
import type { TrailLevel } from '../provenance/trail.ts';
import { isMissReason, isOrigin } from '../provenance/vocabulary.ts';
import type { MissReason, Origin } from '../provenance/vocabulary.ts';
import { AnalysisCodes } from './codes.ts';
import { CLAIM_KINDS } from './types.ts';
import type {
  AnalysisOptionsRecord,
  AnalysisResult,
  BlVerdict,
  BlVerdictRecord,
  CallSite,
  ClaimKind,
  ClaimRun,
  Exit,
  FunctionFact,
  JumpTable,
  ListedInvalid,
  OverrideFact,
  Seed,
  StartupRegion,
  UnlistedFinding,
} from './types.ts';

export const ANALYSIS_SCHEMA = 'romlift/analysis@1';

/** What decodeAnalysis returns: the result, or the diagnostic that says why the text is not one. */
export type DecodedAnalysis =
  | { readonly ok: true; readonly result: AnalysisResult }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

// ---------------------------------------------------------------------------------------------------
// The codec combinators. A decoder throws Malformed, which decodeAnalysis turns into its diagnostic.

class Malformed extends Error {
  readonly at: string;
  constructor(at: string, message: string) {
    super(message);
    this.at = at;
  }
}

interface Codec<T> {
  readonly enc: (value: T) => JsonValue;
  readonly dec: (json: unknown, at: string) => T;
}

/** A member codec; `optional` members are left out when undefined and may be absent. */
interface Member<T> {
  readonly codec: Codec<T>;
  readonly optional: boolean;
}

type JsonObject = { readonly [key: string]: JsonValue | undefined };

function isObject(json: unknown): json is Readonly<Record<string, unknown>> {
  return typeof json === 'object' && json !== null && !Array.isArray(json);
}

const addr: Codec<Addr> = {
  enc: (a) => hexAddr(a),
  dec(json, at) {
    const a = typeof json === 'string' ? parseHexAddr(json) : undefined;
    if (a === undefined)
      throw new Malformed(at, `expected an address ('0x' and up to eight hex digits), got ${JSON.stringify(json)}`);
    return a;
  },
};

/** A non-negative integer that is not an address (rounds, counts, sizes). */
const count: Codec<number> = {
  enc: (n) => n,
  dec(json, at) {
    if (typeof json !== 'number' || !Number.isSafeInteger(json) || json < 0)
      throw new Malformed(at, `expected a non-negative integer, got ${JSON.stringify(json)}`);
    return json;
  },
};

const bool: Codec<boolean> = {
  enc: (b) => b,
  dec(json, at) {
    if (typeof json !== 'boolean') throw new Malformed(at, `expected true or false, got ${JSON.stringify(json)}`);
    return json;
  },
};

/** The literal true of a flag that is absent when false. */
const yes: Codec<true> = {
  enc: (b) => b,
  dec(json, at) {
    if (json !== true) throw new Malformed(at, `expected true, got ${JSON.stringify(json)}`);
    return json;
  },
};

const text: Codec<string> = {
  enc: (s) => s,
  dec(json, at) {
    if (typeof json !== 'string') throw new Malformed(at, `expected a string, got ${JSON.stringify(json)}`);
    return json;
  },
};

/** A string accepted by `is`. */
function textOf<T extends string>(what: string, is: (s: string) => s is T): Codec<T> {
  return {
    enc: (s) => s,
    dec(json, at) {
      if (typeof json !== 'string' || !is(json))
        throw new Malformed(at, `expected ${what}, got ${JSON.stringify(json)}`);
      return json;
    },
  };
}

/** One of a closed set of strings or numbers. */
function oneOf<const T extends string | number>(values: readonly T[]): Codec<T> {
  return {
    enc: (v) => v,
    dec(json, at) {
      const found = values.find((v) => v === json);
      if (found === undefined)
        throw new Malformed(
          at,
          `expected one of ${values.map((v) => JSON.stringify(v)).join(', ')}, got ${JSON.stringify(json)}`,
        );
      return found;
    },
  };
}

function list<T>(item: Codec<T>): Codec<readonly T[]> {
  return {
    enc: (items) => items.map((v) => item.enc(v)),
    dec(json, at) {
      if (!Array.isArray(json)) throw new Malformed(at, 'expected an array');
      return json.map((v: unknown, i) => item.dec(v, `${at}[${i}]`));
    },
  };
}

const required = <T>(codec: Codec<T>): Member<T> => ({ codec, optional: false });
const optional = <T>(codec: Codec<T>): Member<T> => ({ codec, optional: true });

/** The member codecs of T: every key, optional exactly where T's member is optional. */
type Members<T> = { readonly [K in keyof T]-?: Member<Exclude<T[K], undefined>> };

/** A strict object codec: the members of T, nothing else. */
function record<T extends object>(members: Members<T>): Codec<T> {
  const keys = Object.keys(members) as (keyof T & string)[];
  return {
    enc(value) {
      const out: Record<string, JsonValue> = {};
      for (const key of keys) {
        const v = value[key];
        if (v === undefined) continue;
        out[key] = members[key].codec.enc(v as Exclude<T[typeof key], undefined>);
      }
      return out as JsonObject;
    },
    dec(json, at) {
      if (!isObject(json)) throw new Malformed(at, 'expected an object');
      for (const key of Object.keys(json))
        if (!Object.hasOwn(members, key)) throw new Malformed(`${at}.${key}`, 'not a member of this object');
      const out: Record<string, unknown> = {};
      for (const key of keys) {
        const member = members[key];
        if (!Object.hasOwn(json, key)) {
          if (member.optional) continue;
          throw new Malformed(`${at}.${key}`, 'missing');
        }
        out[key] = member.codec.dec(json[key], `${at}.${key}`);
      }
      return out as T;
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// The analysis types.

const mode = oneOf<Mode>(['thumb', 'arm']);
const ruleId = textOf<RuleId>('a rule id', isRuleId);
const origin = textOf<Origin>('an origin id', isOrigin);
const missReason = textOf<MissReason>('a miss reason id', isMissReason);
const span = record<Span>({ start: required(addr), end: required(addr) });
const addrs = list(addr);
const spans = list(span);

const provenance = record<Provenance>({
  rule: required(ruleId),
  round: required(count),
  cites: required(addrs),
  note: optional(text),
});

const rejection = record<Rejection>({
  at: required(addr),
  mode: required(mode),
  rule: required(ruleId),
  reason: required(missReason),
  intrinsic: required(bool),
  round: required(count),
  detail: required(text),
  count: required(count),
});

const diagnosticCodec = record<Diagnostic>({
  code: required(text),
  severity: required(oneOf<Severity>(['error', 'warning', 'info'])),
  addr: optional(addr),
  span: optional(span),
  path: optional(text),
  message: required(text),
  cites: optional(addrs),
  rule: optional(text),
});

const jumpTable = record<JumpTable>({ base: required(addr), targets: required(addrs), thumbBit: required(bool) });
const callSite = record<CallSite>({ site: required(addr), target: required(addr), mode: required(mode) });
const blVerdictRecord = record<BlVerdictRecord>({
  site: required(addr),
  target: required(addr),
  verdict: required(oneOf<BlVerdict>(['call', 'far', 'noreturn'])),
  rule: required(ruleId),
});
const exit = record<Exit>({
  at: required(addr),
  rule: required(ruleId),
  kind: required(oneOf<Exit['kind']>(['return', 'tail', 'noreturn-call', 'swi-end', 'reg-jump'])),
});

const functionFact = record<FunctionFact>({
  entry: required(addr),
  mode: required(mode),
  runAt: optional(addr),
  extent: required(span),
  codeEnd: required(addr),
  code: required(spans),
  dead: required(spans),
  pools: required(addrs),
  farPools: required(addrs),
  tables: required(list(jumpTable)),
  calls: required(list(callSite)),
  blVerdicts: required(list(blVerdictRecord)),
  exits: required(list(exit)),
  branchTargets: required(addrs),
  adrs: required(addrs),
  veneers: required(addrs),
  absorbed: required(spans),
  holes: required(spans),
  origin: required(origin),
  accepted: required(provenance),
  also: required(list(provenance)),
});

const seed = record<Seed>({
  entry: required(addr),
  mode: required(mode),
  rule: required(oneOf<Seed['rule']>(['seed.listed', 'seed.override'])),
  name: optional(text),
  size: optional(count),
  label: optional(bool),
  validate: optional(yes),
});

const overrideFact = record<OverrideFact>({
  span: required(span),
  kind: required(oneOf<OverrideFact['kind']>(['code', 'data'])),
  mode: optional(mode),
  runsAt: optional(addr),
});

const options = record<AnalysisOptionsRecord>({
  mode: required(oneOf<AnalysisOptionsRecord['mode']>(['discover', 'confirm'])),
  seeds: required(list(seed)),
  overrides: required(list(overrideFact)),
  trail: required(oneOf<TrailLevel>(['off', 'decisions', 'full'])),
  trailFilter: optional(span),
});

const claimRun = record<ClaimRun>({
  span: required(span),
  kind: required(oneOf<ClaimKind>(CLAIM_KINDS)),
  owner: optional(addr),
});
const startup = record<StartupRegion>({ span: required(span), entries: required(addrs) });
const unlistedFinding = record<UnlistedFinding>({
  entry: required(addr),
  mode: required(mode),
  origin: required(origin),
  provenance: required(provenance),
});
const listedInvalid = record<ListedInvalid>({ entry: required(addr), rejection: required(rejection) });

type Discover = Extract<AnalysisResult, { readonly mode: 'discover' }>;
type Confirm = Extract<AnalysisResult, { readonly mode: 'confirm' }>;

const common = {
  schema: required(oneOf<typeof ANALYSIS_SCHEMA>([ANALYSIS_SCHEMA])),
  rom: required(record<AnalysisResult['rom']>({ sha1: required(text), end: required(addr) })),
  profile: required(text),
  options: required(options),
  functions: required(list(functionFact)),
  claims: required(list(claimRun)),
  startup: required(startup),
  codeEnd: required(addr),
  rejections: required(list(rejection)),
  diagnostics: required(list(diagnosticCodec)),
} as const;

const discover = record<Discover>({ ...common, mode: required(oneOf<'discover'>(['discover'])) });
const confirm = record<Confirm>({
  ...common,
  mode: required(oneOf<'confirm'>(['confirm'])),
  unlisted: required(list(unlistedFinding)),
  listedInvalid: required(list(listedInvalid)),
});

const analysisResult: Codec<AnalysisResult> = {
  enc: (r) => (r.mode === 'discover' ? discover.enc(r) : confirm.enc(r)),
  dec(json, at) {
    if (!isObject(json)) throw new Malformed(at, 'expected an object');
    if (json['schema'] !== ANALYSIS_SCHEMA)
      throw new Malformed(
        `${at}.schema`,
        `expected ${JSON.stringify(ANALYSIS_SCHEMA)}, got ${JSON.stringify(json['schema'])}`,
      );
    if (json['mode'] === 'discover') return discover.dec(json, at);
    if (json['mode'] === 'confirm') return confirm.dec(json, at);
    throw new Malformed(`${at}.mode`, `expected "discover" or "confirm", got ${JSON.stringify(json['mode'])}`);
  },
};

// ---------------------------------------------------------------------------------------------------
// The API.

/** The canonical JSON of `result` (schema romlift/analysis@1), as chunks whose concatenation is the whole text. */
export function encodeAnalysis(result: AnalysisResult): Iterable<string> {
  return canonicalJson(analysisResult.enc(result));
}

/** Reads a romlift/analysis@1 document; the diagnostic names the first member that is not as the schema says. */
export function decodeAnalysis(source: string): DecodedAnalysis {
  let json: unknown;
  try {
    json = JSON.parse(source) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      diagnostics: [diagnostic(AnalysisCodes, 'E_ANALYSIS_JSON', `the analysis is not JSON: ${message}`)],
    };
  }
  try {
    return { ok: true, result: analysisResult.dec(json, '$') };
  } catch (error) {
    if (!(error instanceof Malformed)) throw error;
    return {
      ok: false,
      diagnostics: [diagnostic(AnalysisCodes, 'E_ANALYSIS_JSON', `${error.at}: ${error.message}`, { path: error.at })],
    };
  }
}
