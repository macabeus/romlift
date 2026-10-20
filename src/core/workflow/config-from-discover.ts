// The in-memory config of a discover run (architecture §6.1, §6.2, D62 c): what `generate`, `model` and `verify --rom`
// run on, and what phase 4's init serialises. Every function the analysis found is listed with its mode and default
// name (an entry inside another found function's extent with `label = true`, the startup code inside the cartridge
// entry's included, so the confirm run equals the discover run: coveredEntries); the modules are inferModules'
// proposals. Since phase 4 (§6.1 rung 2, D62 c, D74 b) a module inferModules proposes as agbcc-shaped (moduleKind
// 'c') and that carries no library is kind 'c', built from the c-stub writer's src/<module>.c; the header, the
// startup region, asm-only ranges and library regions stay 'asm', the data module 'data'. Nothing comes from a path:
// the build name is the header's game code.
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import type { AnalysisResult } from '../analysis/types.ts';
import { DEFAULT_BUILD_COMPILER } from '../config/compilers.ts';
import type { FunctionConfig, ModuleConfig, RomliftConfig } from '../config/schema.ts';
import type { Proposal } from '../proposals/types.ts';
import { coveredEntries } from '../layout/borders.ts';
import { inferModules } from '../layout/infer-modules.ts';
import type { ConfigFromDiscoverOptions } from '../layout/types.ts';
import { functionName } from '../model/names.ts';
import { BASEROM_PATH } from '../model/paths.ts';

/** The build name when the header's game code is not four letters or digits. */
const FALLBACK_BUILD_NAME = 'rom';

/** The build name: the header's game code lower-cased when it is four letters or digits, else 'rom'. */
export function buildNameOf(rom: Pick<Rom, 'header'>): string {
  const code = rom.header.gameCode;
  return /^[A-Za-z0-9]{4}$/.test(code) ? code.toLowerCase() : FALLBACK_BUILD_NAME;
}

/** The kind of the module a module proposal names: 'c' for an agbcc-shaped one without a library, else its own. */
function moduleKindOf(p: Extract<Proposal, { kind: 'module' }>): ModuleConfig['kind'] {
  if (p.moduleKind === 'c') return p.library === undefined ? 'c' : 'asm';
  return p.moduleKind;
}

/** The config of a ROM and its discover analysis: every found entry listed, the inferred modules, no symbols or overrides. */
export function configFromDiscover(rom: Rom, analysis: AnalysisResult, options: ConfigFromDiscoverOptions = {}): RomliftConfig {
  const modules = inferModules(rom, analysis, options).flatMap((p): ModuleConfig[] => {
    if (p.kind !== 'module') return [];
    return [
      {
        name: p.name,
        start: p.start,
        kind: moduleKindOf(p),
        generated: true,
        ...(p.library === undefined ? {} : { library: p.library.name, version: p.library.version }),
      },
    ];
  });
  const nested = coveredEntries(analysis.functions);
  const functions = new Map<Addr, FunctionConfig>(
    analysis.functions.map((f) => [f.entry, { name: functionName(f.entry), mode: f.mode, aliases: [], ...(nested.has(f.entry) ? { label: true } : {}) }] as const),
  );
  return {
    schema: 1,
    rom: { path: BASEROM_PATH, sha1: rom.sha1 },
    build: { name: buildNameOf(rom), compiler: DEFAULT_BUILD_COMPILER },
    signatures: { enabled: false },
    modules,
    functions,
    symbols: new Map(),
    overrides: [],
  };
}
