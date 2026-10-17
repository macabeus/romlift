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

Phase 1 of 6 (Decoder) has landed ([docs/phase-1.md](docs/phase-1.md)): the Thumb and ARM instruction
table with its decoder, encoder, formatter and parser round-trips 100% of printed mnemonics through GNU
`as`, `romlift doctor` checks the user's toolchain, and the bench harness rescores the proof of concept.

Phase 2 (Analysis) is built but has not landed ([docs/phase-2.md](docs/phase-2.md)): romlift's own
function-boundary analysis reproduces the proof of concept's results on the five ROMs the PoC was tuned on
(parity digests and the lockstep of every rule family), then switches to an order-independent worklist,
register-tracked jump tables and a few measured improvements, with every rule cited and load-bearing on a
synthetic fixture or exempted by a decision. The sealed held-out gate failed on The Minish Cap; the owner
decided to tune on it ("Tune on tmc, no new ROM", D60), so it is the sixth tuning ROM (recall 99.37% to
99.94%, its code end now exact, IWRAM code included) and the two Pokémon held-out ROMs still pass sealed.
Three gates the decision does not cover fail on The Minish Cap (PoC parity, rows against the PoC's own run
of it, confirm equals discover), and the phase waits for the owner's answers. The
commands so far are `doctor`, `analyze` and `explain`.

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
| [docs/decisions.md](docs/decisions.md) | architecture decision records D1–D58 with the alternatives rejected |
| [docs/roadmap.md](docs/roadmap.md) | build order, file ownership and exit commands of each phase |
| [docs/phase-1.md](docs/phase-1.md) | the record of phase 1: what it delivered, the gate run, deviations and known limitations |
| [docs/phase-2.md](docs/phase-2.md) | the record of phase 2: components, commands, the milestones M1–M7 with their numbers, the closing gate run, deviations, and why the phase has not landed |
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
node --conditions=source src/cli/main.ts doctor
```

## License

[MIT](LICENSE)
