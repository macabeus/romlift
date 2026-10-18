// The one shape every proposer returns (architecture §3.4, D9, D20, D62): signatures, evidence, legacy
// files, the analysis and module inference all propose functions, symbols, modules and overrides; the TOML
// decides, and records where an accepted entry came from in its `from` key, spelled by sourceKey.
import type { Addr, Mode, Span } from '../../foundation/rom/span.ts';
import type { RuleId } from '../provenance/rule-id.ts';

/** Why module inference (core/layout/infer-modules.ts) proposed a module. */
export type LayoutReason = 'header' | 'startup' | 'asm-only' | 'module-size' | 'data';

export type ProposalSource =
  | { readonly kind: 'signature'; readonly library: string; readonly version: string; readonly rule: RuleId }
  | { readonly kind: 'evidence'; readonly id: 'trace' | 'elf' | 'map' }
  | { readonly kind: 'legacy' }
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

/** A recognised library's range, as the signature matcher reports it (phase 6) and module inference reads it. */
export interface LibraryRegion {
  readonly span: Span;
  readonly library: string;
  readonly version: string;
}

/**
 * The TOML `from` spelling of a source: 'sig:<library>@<version>', 'evidence:<id>' or 'legacy'. The analysis
 * and module inference are never persisted (an entry without `from` was written by the analysis or by
 * hand), so their key is undefined.
 */
export function sourceKey(source: ProposalSource): string | undefined {
  switch (source.kind) {
    case 'signature':
      return `sig:${source.library}@${source.version}`;
    case 'evidence':
      return `evidence:${source.id}`;
    case 'legacy':
      return 'legacy';
    case 'analysis':
    case 'layout':
      return undefined;
  }
}
