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
header's, and the C sources' `C_SOURCE_DIR`, `isCSource`, `cSourceOf`), each defined there only and imported from
there by every layer, never re-exported.

Imports nothing outside `foundation/`: no npm package and no `node:*` module, so `romlift/isa` can be
shared with other tools and runs in a browser (architecture §2, D3, D44).
