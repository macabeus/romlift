// The in-memory config of a discover run (architecture §6.1, §6.2, D62 c): what phase 3's generate, model and
// verify run on, and what phase 4's init will serialise. Every function the analysis found is listed with its
// mode and default name (an entry inside another found function's extent with `label = true`, the startup code
// inside the cartridge entry's included, so the confirm run equals the discover run: coveredEntries); the modules are
// inferModules' proposals, every code module of kind 'asm' in phase 3 (§6.1: the agbcc-shaped ones become 'c'
// when the c-stub writer lands in phase 4). Nothing comes from a path: the build name is the header's game code.
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import type { AnalysisResult } from '../analysis/types.ts';
import { DEFAULT_BUILD_COMPILER } from '../config/compilers.ts';
import type { FunctionConfig, ModuleConfig, RomliftConfig } from '../config/schema.ts';
import { coveredEntries } from '../layout/borders.ts';
import { inferModules } from '../layout/infer-modules.ts';
import type { ConfigFromDiscoverOptions } from '../layout/types.ts';
import { functionName } from '../model/names.ts';

/** Where the project keeps its copy of the ROM. */
export const BASEROM_PATH = 'baserom.gba';

/** The build name when the header's game code is not four letters or digits. */
export const FALLBACK_BUILD_NAME = 'rom';

/** The build name: the header's game code lower-cased when it is four letters or digits, else 'rom'. */
export function buildNameOf(rom: Pick<Rom, 'header'>): string {
  const code = rom.header.gameCode;
  return /^[A-Za-z0-9]{4}$/.test(code) ? code.toLowerCase() : FALLBACK_BUILD_NAME;
}

/** The config of a ROM and its discover analysis: every found entry listed, the inferred modules, no symbols or overrides. */
export function configFromDiscover(rom: Rom, analysis: AnalysisResult, options: ConfigFromDiscoverOptions = {}): RomliftConfig {
  const modules = inferModules(rom, analysis, options).flatMap((p): ModuleConfig[] => {
    if (p.kind !== 'module') return [];
    return [
      {
        name: p.name,
        start: p.start,
        kind: p.moduleKind === 'data' ? 'data' : 'asm',
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
