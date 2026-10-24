# signatures

Library signatures: masked byte patterns that recognise known libraries (m4a, libgcc, the serial
libraries, the BIOS call stubs) and name their functions (architecture §7, phase 6).

- `specs/<library>.json` is committed and ships: per version its reference datasets, objects and tables, and the
  reviewed names, no bytes (`SignatureSpec`, `parseSignatureSpec` in `src/core/signatures/spec.ts`, D93).
- `<library>.json` is built locally by `romlift signatures build` from reference checkouts and is
  gitignored until the owner decides otherwise (D40); its shape is schema 3 (`SignatureFile`, `parseSignatureFile` in
  `src/core/signatures/schema.ts`, D93). The closing list builds each spec with `node --conditions=source
  src/cli/main.ts signatures build <spec>` while romlift is unpublished.

Held-out ROMs are never signature references (`g6.no-heldout-references`).
