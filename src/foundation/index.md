# src/foundation

Building blocks with no knowledge of romlift projects: `rom/` (spans, the ROM value, the cartridge
header, the memory map), `isa/` (the Thumb and ARM table, decoder, encoder, GNU `as` formatter and
parser), `corpus/` (the `as` round-trip corpus: its cases, file layout and comparison, counts only,
D55), `asm/` (the shared assembler dialect and statement layout), `formats/` (pure parsers of ELF,
GNU map, canonical JSON and the legacy files), `diagnostics/` (the mechanism, never the codes) and
`util/`.

One recorded exception holds project knowledge (architecture §2, D76 h, D83 c): `util/project-files.ts`, the
spellings a project's files share across layers (the ROM, config and decomp.yaml names, the default function name, the
C stubs' paths `NONMATCHINGS_ROOT`, `nonmatchingDir`, `chunkFileOf`, `isChunkFile`, `stubNameOf`, the include
header's, and the C sources' `C_SOURCE_DIR`, `isCSource`, `cSourceOf`), each defined there only. The internal layers
import them from there (since fix round 9 `core/config/decomp-yaml.ts` re-exports none, architecture-c1-2); the
exceptions (fix round 8, architecture-c0-4) are the public entry points, which re-export some of them
(`api/reconcile.ts` `isCSource`, `api/model.ts` `nonmatchingDir`, `api/one-shot-types.ts` `INCLUDE_ASM_HEADER_PATH`
and `NONMATCHINGS_ROOT`, `api/config.ts` `DECOMP_YAML_FILE` and `ROMLIFT_CONFIG_FILE`), and the aliases architecture-r1-2 carries to phase 6
(roadmap.md, "Carried from phase 4": `shell/project/locate.ts`'s `DECOMP_YAML_NAMES` re-export,
`core/model/paths.ts`'s `BASEROM_PATH`, `core/scaffold/vars.ts`'s `SCAFFOLD_ROM_FILE` and `core/config/decomp-yaml.ts`'s
`TARGET`, each `BASEROM_FILE`).

Imports nothing outside `foundation/`: no npm package and no `node:*` module, so `romlift/isa` can be
shared with other tools and runs in a browser (architecture §2, D3, D44).
