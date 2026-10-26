// The one shape every proposer returns (architecture §3.4, §7.3, §7.4, D9, D20, D62, D91, D92): library signatures,
// the analysis and module inference propose functions, symbols, modules and overrides; the TOML decides, and records
// where an accepted entry came from in its `from` key, spelled by sourceKey. Signatures are the only source that is
// persisted: the evidence importers (trace, ELF, map) and legacy import were dropped by the owner (D91, D92), and
// with them the `evidence` and `legacy` sources and their `from` spellings.
import type { Addr, Mode, Span } from '../../foundation/rom/span.ts';
import type { RuleId } from '../provenance/rule-id.ts';

/**
 * Why module inference (core/layout/infer-modules.ts) proposed a module, or, for 'runs-at', analyze --update: a border
 * of a hand-written runs_at range, which is its own module (§6.7).
 */
export type LayoutReason = 'header' | 'startup' | 'asm-only' | 'module-size' | 'data' | 'runs-at';

export type ProposalSource =
  | { readonly kind: 'signature'; readonly library: string; readonly version: string; readonly rule: RuleId }
  | { readonly kind: 'analysis'; readonly rule: RuleId }
  /** Module inference: not an analysis rule, so it carries no RuleId (D62); never persisted. */
  | { readonly kind: 'layout'; readonly reason: LayoutReason };

export type Proposal =
  | {
      readonly kind: 'function';
      readonly addr: Addr;
      readonly mode: Mode;
      readonly name?: string;
      readonly size?: number;
      readonly label?: boolean;
      readonly source: ProposalSource;
    }
  | {
      readonly kind: 'symbol';
      readonly addr: Addr;
      readonly name: string;
      readonly size?: number;
      readonly type?: 'pointers' | 'bytes';
      readonly source: ProposalSource;
    }
  | {
      readonly kind: 'module';
      readonly name: string;
      readonly start: Addr;
      readonly moduleKind: 'asm' | 'c' | 'data';
      readonly library?: { readonly name: string; readonly version: string };
      readonly source: ProposalSource;
    }
  | {
      readonly kind: 'override';
      readonly span: Span;
      readonly overrideKind: 'code' | 'data';
      readonly mode?: Mode;
      readonly runsAt?: Addr;
      readonly source: ProposalSource;
    };

/** A module proposal (module inference, the runs_at borders, the library modules of analyze --update). */
export type ModuleProposal = Extract<Proposal, { readonly kind: 'module' }>;

/** A recognised library's range, as the signature matcher reports it (phase 6) and module inference reads it. */
export interface LibraryRegion {
  readonly span: Span;
  readonly library: string;
  readonly version: string;
}

/** The prefix of a signature's `from` key. */
const SIGNATURE_KEY_PREFIX = 'sig:';

/**
 * The TOML `from` spelling of a source: 'sig:<library>@<version>'. The analysis and module inference are never
 * persisted (an entry without `from` was written by the analysis or by hand), so their key is undefined.
 */
export function sourceKey(source: ProposalSource): string | undefined {
  switch (source.kind) {
    case 'signature':
      return `${SIGNATURE_KEY_PREFIX}${source.library}@${source.version}`;
    case 'analysis':
    case 'layout':
      return undefined;
  }
}

/**
 * sourceKey's inverse for a signature (architecture-12: each spelling and its parser together): the library and version
 * a `from` key `sig:<library>@<version>` names (split at its first `@`, both parts non-empty); undefined for any other
 * key.
 */
export function parseSourceKey(from: string | undefined): { readonly library: string; readonly version: string } | undefined {
  if (from === undefined || !from.startsWith(SIGNATURE_KEY_PREFIX)) return undefined;
  const key = from.slice(SIGNATURE_KEY_PREFIX.length);
  const at = key.indexOf('@');
  if (at <= 0 || at === key.length - 1) return undefined;
  return { library: key.slice(0, at), version: key.slice(at + 1) };
}
