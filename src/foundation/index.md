# src/foundation

Building blocks with no knowledge of romlift projects: `rom/` (spans, the ROM value, the cartridge
header, the memory map), `isa/` (the Thumb and ARM table, decoder, encoder, GNU `as` formatter and
parser), `corpus/` (the `as` round-trip corpus: its cases, file layout and comparison, counts only, and the
threshold a run must meet, D55), `asm/` (the shared assembler dialect, statement layout and R_ARM_ABS32 rule, `relocation.ts`), `formats/` (pure parsers of ELF,
GNU map, canonical JSON and the legacy files), `diagnostics/` (the mechanism, never the codes) and
`util/`.

One recorded exception holds project knowledge (architecture §2, D76 h, D83 c): `util/project-files.ts`, the
spellings a project's files share across layers (the ROM, config and decomp.yaml names, `BASEROM_FILE`,
`ROMLIFT_CONFIG_FILE`, `DECOMP_YAML_FILE`, `DECOMP_YAML_NAMES`; romlift's default names `defaultFunctionName`,
`orphanName`, `localName`, `dataName` and their one parser, `isDefaultSpelling` and `defaultSpellingAddress`; the C
stubs' paths `NONMATCHINGS_ROOT`, `nonmatchingDir`, `chunkFileOf`, `isChunkFile`, `stubNameOf`, the include header's,
and the C sources' `C_SOURCE_DIR`, `isCSource`, `cSourceOf`), each defined there only. The internal layers, the bench
and the tests import them from there, under no other name (phase 6 removed the aliases architecture-r1-2 carried:
`BASEROM_PATH`, `SCAFFOLD_ROM_FILE`, decomp-yaml's `TARGET`, `locate.ts`'s `DECOMP_YAML_NAMES` re-export and
`core/model/names.ts`'s `functionName`). The exceptions (fix round 8, architecture-c0-4) are the public entry points,
which re-export some of them (`api/reconcile.ts` `isCSource`, `api/model.ts` `nonmatchingDir`, `api/one-shot-types.ts`
`BASEROM_FILE`, `INCLUDE_ASM_HEADER_PATH` and `NONMATCHINGS_ROOT`, `api/config.ts` `DECOMP_YAML_FILE` and
`ROMLIFT_CONFIG_FILE`, `api/config-files.ts` `DECOMP_YAML_NAMES`, `api/internal-emit.ts` `defaultSpellingAddress`).

Imports nothing outside `foundation/`: no npm package and no `node:*` module, so `romlift/isa` can be
shared with other tools and runs in a browser (architecture §2, D3, D44).
