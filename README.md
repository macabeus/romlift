# romlift

romlift turns a Game Boy Advance ROM into a matching-decompilation project in one run:

```sh
npx romlift init baserom.gba && ./setup.sh && make
```

ends at the ROM's SHA-1 with no file edited by hand. It carries its own Thumb and ARM decoder and GNU
`as` printer, recovers function boundaries with rules measured against matching ELFs, recognises known
libraries through signatures, and writes one `romlift.toml`, a `decomp.yaml`, regenerated `asm/` and
`data/`, C stubs, the linker script, objdiff targets and the build scaffold. It is written in TypeScript
and needs only Node.js and the GBA toolchain.

## Status

Phase 1 of 6 (Decoder) is in progress: the repository infrastructure is in place (layer checker, gate
framework, CLI command types); the decoder, `doctor` and the bench harness are being built. No command
works yet.

| Phase | Delivers |
| --- | --- |
| 1 Decoder | instruction table, decoder, encoder, formatter and parser; `doctor`; the bench harness |
| 2 Analysis | function-boundary rules, compiler profile, `analyze`, `explain`, held-out runs |
| 3 Emission | the ROM model, writers, write plan, `verify`, `model --json` |
| 4 One shot | config, scaffold, C stubs, `init`, `generate` |
| 5 Migration | `import-legacy`, the `INCLUDE_ASM` reconciler, `rename`, objdiff targets |
| 6 Evidence | library signatures, `trace`, code run from RAM, full `explain` |

## Documentation

| Document | Contents |
| --- | --- |
| [docs/plan.md](docs/plan.md) | the plan: requirements R1–R9, phases, gates, risks |
| [docs/architecture.md](docs/architecture.md) | the definitive architecture: layers, types, analysis, printer, emission, signatures, bench, gates |
| [docs/decisions.md](docs/decisions.md) | architecture decision records D1–D54 with the alternatives rejected |
| [docs/roadmap.md](docs/roadmap.md) | build order, file ownership and exit commands of each phase |
| [docs/architecture-review.md](docs/architecture-review.md) | the disposition of the 60 review findings against revision 1 |
| [docs/benchmark-roms.md](docs/benchmark-roms.md) | the tuning and held-out ROM + ELF pairs, and the rule that ROMs are never committed |
| [docs/proof-of-concept.md](docs/proof-of-concept.md) | the proof of concept's rules, numbers and lessons |
| [docs/prototype.md](docs/prototype.md) | the prototype generations the proof of concept grew from |
| [docs/research-notes.md](docs/research-notes.md) | source-level findings behind the plan |

Contributors and agents: read [AGENTS.md](AGENTS.md).

## Development

```sh
npm ci
npm run typecheck
npm test
```

## License

[MIT](LICENSE)
