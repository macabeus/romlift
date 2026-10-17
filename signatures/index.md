# signatures

Library signatures: masked byte patterns that recognise known libraries (m4a, libgcc, the serial
libraries, the BIOS call stubs) and name their functions (architecture §7, phase 6).

- `specs/<library>.json` is committed and ships: references, object globs and reviewed names, no bytes.
- `<library>.json` is built locally by `romlift signatures build` from reference checkouts and is
  gitignored until the owner decides otherwise (D40).

Held-out ROMs are never signature references (`g6.no-heldout-references`).
