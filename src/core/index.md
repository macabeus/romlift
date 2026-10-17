# src/core

The pure core. Every decision romlift makes lives here: provenance, compiler profiles, analysis and its
rules (one file per rule), proposals, layout, evidence, legacy import, signatures, config, the model,
reconciliation, emission, verification, the write plan, the scaffold and the workflows.

- Bytes and plain data in, plain data out. No files, processes, clocks, hashing or environment: the
  shell injects digests and reads inputs (D3, D44).
- Only the globals of the allowlist in architecture §2; no `Map`/`Set` iteration except through
  `sortedKeys`/`sortedEntries` where the architecture requires it (D5).
- Content errors are returned as diagnostics, never thrown; each module that raises codes owns a
  `codes.ts` (D45).
- `workflow/` composes the other modules; nothing in core imports it (D36).
