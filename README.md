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

Phase 2 (Analysis) passes its closing gate ([docs/phase-2.md](docs/phase-2.md)): romlift's own
function-boundary analysis reproduces the proof of concept's results on the five ROMs the PoC was tuned on
(parity digests and the lockstep of every rule family), then switches to an order-independent worklist,
register-tracked jump tables and a few measured improvements, with every rule cited and load-bearing on a
synthetic fixture or exempted by a decision. The sealed held-out gate failed on The Minish Cap; the owner
decided to tune on it ("Tune on tmc, no new ROM", D60), so it is the sixth tuning ROM (recall 99.37% to
99.94%, IWRAM code included) and the two Pokémon held-out ROMs still pass sealed. The owner then answered
the five questions that decision left open (D61): The Minish Cap is a benchmark row at its current numbers
(not held to the PoC-comparison gates), both held-out family conditions are waived, the code end of an
unsized function ends at its `$d`, and its six known confirm/discover differences are a recorded
limitation. Confirm equals discover then differed on two more Minish Cap functions than the six the owner
was told of; the owner's answer to that question (Q6, "Yes, cover all 8") adds them to the recorded
limitation. With that answer every command of the closing list exits 0 at `landed` 2, and phase 2 has landed:
its pull request (#2) is merged to `main`, tagged `phase-2`.

Phase 3 (Emission) passes its closing gate and is not merged yet ([docs/phase-3.md](docs/phase-3.md)): the model,
both printers, the writers, the write plan, `model --json` and `verify` turn every committed fixture and all six
tuning ROMs into trees that pass the four self-checks and link to the ROM's SHA-1 with both the raw and the readable
printer, with pokeemerald's `generate` within its speed budget. The owner answered the phase's six questions (D68,
D69): the objdiff gate moves to phase 5 (`g5.objdiff`), the `romlift` bin and `g3.large-rom` run Node with
`--max-old-space-size=384` (the 32 MiB synthetic ROM does not complete under the 256 MiB first chosen), with the
memory budget set from the runs under that cap (1,088 MiB), unflushed generated files and the narrowed raw-printer
parity are accepted, and two limitations become phase-4 work. The review of that landing found the bin's own
`verify`, `model` and `analyze --json` running out of memory on the 32 MiB synthetic ROM under the cap; fix round 4
(D70) makes them fit, and a local test runs every bin command on that ROM under the cap. Every command of the
closing list exits 0 at `landed` 3 after that round; the merge waits for the phase's pull request and its CI. The commands so far are `doctor`, `analyze`, `explain`,
`model` and `verify`.

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
| [docs/decisions.md](docs/decisions.md) | architecture decision records D1–D70 with the alternatives rejected |
| [docs/roadmap.md](docs/roadmap.md) | build order, file ownership and exit commands of each phase |
| [docs/phase-1.md](docs/phase-1.md) | the record of phase 1: what it delivered, the gate run, deviations and known limitations |
| [docs/phase-2.md](docs/phase-2.md) | the record of phase 2: components, commands, the milestones M1–M7 with their numbers, the closing gate run, deviations, and the owner's answers that let the phase land |
| [docs/phase-3.md](docs/phase-3.md) | the record of phase 3: components in three waves, the closing fix round, the measured numbers, the closing gate runs, deviations, the owner questions Q1 to Q6 with the owner's answers to Q1 to Q6, the review fix rounds, and known limitations |
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
