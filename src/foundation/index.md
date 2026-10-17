# src/foundation

Building blocks with no knowledge of romlift projects: `rom/` (spans, the ROM value, the cartridge
header, the memory map), `isa/` (the Thumb and ARM table, decoder, encoder, GNU `as` formatter and
parser), `asm/` (the shared assembler dialect and statement layout), `formats/` (pure parsers of ELF,
GNU map, canonical JSON and the legacy files), `diagnostics/` (the mechanism, never the codes) and
`util/`.

Imports nothing outside `foundation/`: no npm package and no `node:*` module, so `romlift/isa` can be
shared with other tools and runs in a browser (architecture §2, D3, D44).
