# romlift

romlift turns a Game Boy Advance ROM into a matching-decompilation project in one run that ends at the ROM's SHA-1
with no file edited by hand. Once romlift is published to npm, that run is:

```sh
npx romlift init baserom.gba && ./setup.sh && make
```

It carries its own Thumb and ARM decoder and GNU `as` printer, recovers function boundaries with rules measured
against matching ELFs, recognises known libraries through signatures (when signature files are built, below), and
writes one `romlift.toml`, a `decomp.yaml`, regenerated `asm/` and `data/`, C stubs, the linker script, objdiff targets
and the build scaffold. It is written in TypeScript and needs only Node.js and the GBA toolchain.

## Try it before it is published

romlift is not on the npm registry yet (`package.json` is `private`, version `0.0.0`), so `npx romlift` and the npm
install that `./setup.sh` runs both fail with a 404. Run it from a checkout instead:

```sh
git clone https://github.com/macabeus/romlift.git && cd romlift
npm ci && npm run build
cd /path/to/new-project-dir            # an empty directory holding only your ROM
export ROMLIFT_CLI="node /path/to/romlift/dist/cli/main.js"
$ROMLIFT_CLI init baserom.gba
./setup.sh && make
```

`ROMLIFT_CLI` makes `./setup.sh` (and the messages of the generated `Makefile`) use that command instead of `npx
romlift`, and set while `init` runs it skips the npm lock step, which would wait for the registry's 404 and warn
`W_LOCKFILE_DEFERRED`; run every other romlift command of the project the same way (`$ROMLIFT_CLI generate`). Run `git init` in the project before `./setup.sh` if you want it in Git: `setup.sh` then registers
`tools/agbcc` as a submodule. `romlift --version` prints the version.

You need GNU binutils for ARM (`arm-none-eabi-as`, `-ld`, `-objcopy`), `make`, `git`, a C compiler and Node.js 24.7 or
later. objdiff 3.7.2 or later opens the generated `objdiff.json`.

**Library signatures are not shipped.** Built signature files are local (gitignored, decision D40), so a plain
checkout, like an installed package, names no library: `init` warns `W_SIGNATURES_ABSENT` and leaves m4a, libgcc and
the BIOS call stubs unnamed in ordinary modules. Building them needs this repository and the reference decomp
checkouts each spec names (sa2, pokeemerald, fe7j, klonoa; [docs/benchmark-roms.md](docs/benchmark-roms.md)) with
their ROMs, ELFs and maps under `ROMLIFT_BENCH_ROOT`:

```sh
for s in signatures/specs/*.json; do npm run signatures -- build "$s" || exit 1; done
```

They land in this checkout's `signatures/`, which a romlift run from it reads; point any other romlift at them with
`ROMLIFT_SIGNATURES=/path/to/romlift/signatures`.

Whether built files ship with the package is the owner's open decision (D40, architecture §12 item 1).

## Status

**Phases 1 to 4 and 6 landed; phase 5 skipped by the owner** (D92). Final review run: 2026-10-26, on `main` at
`2499afa`; the report is [docs/final-review.md](docs/final-review.md). Every gate of phases 1 to 6 passes on both
tiers, all six tuning ROMs and both sealed held-out ROMs go from `init` through `./setup.sh` and `make` to their SHA-1,
and the five ROMs of the proof of concept reproduce its function boundaries exactly. Nine minor findings stay open
(among them: the "Try it before it is published" commands need bash, not zsh), with the owner questions O1 to O5. After
the review the owner cut the CLI to the five commands a project's user runs, `init`, `generate`, `update`,
`rename` and `explain`, and CI to Linux (D108); then let a module start between hand-written functions and an `asm`
module build from a hand-written source, `[[modules]] source` (D109); and sized an unsized RAM symbol by what its
accesses prove, so the words inside it print `name + offset` (D110); gave every RAM address the code loads a default name, made
function labels global unless their name repeats, and warned of a hand-restored stub (D111); made INCLUDE_ASM select `.text`, so a stub after a `const` stays code,
and explained the data range's failures (D112); and left the BIOS's top of IWRAM without default names, as C spells it
with constants (D113); and made every reading the one the final function set gives, in both modes, so confirm equals
discover on every tuning ROM with no recorded exception (D114); made Node 24.7 the engines floor (D115); gave the entries inside a function's code their own table, `[entry_points]` (D116); made the architecture rules ESLint rules (D117); and made the tests faster by faster code, not caches: a linear `holesOf` and `joinAtOffsets`, and the gates' fixtures at once (D118); and formatted the code with Prettier and gba-kit's settings (D119). The history of each phase follows.

Phase 1 of 6 (Decoder) has landed ([docs/phase-1.md](docs/phase-1.md)): the Thumb and ARM instruction
table with its decoder, encoder, formatter and parser round-trips 100% of printed mnemonics through GNU
`as`, and the bench harness rescores the proof of concept.

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

Phase 3 (Emission) has landed ([docs/phase-3.md](docs/phase-3.md)): its pull request (#3) is merged to `main`, tagged
`phase-3`. The model, both printers, the writers, the
write plan and the tree checks turn every committed fixture and all six tuning ROMs into trees that pass the
four self-checks and link to the ROM's SHA-1 with both the raw and the readable printer, with pokeemerald's `generate`
within its speed budget. The owner answered the phase's eight questions (D68, D69, D72, D73): the objdiff gate moves to phase
5 (`g5.objdiff`); the `romlift` bin and `g3.large-rom` run Node with `--max-old-space-size=1024` (Q7's answer; the 256
MiB first chosen did not hold the 32 MiB synthetic ROM, and Q6's 384 MiB did not hold a 32 MiB ROM of real code
density, pokeemerald twice over), with the memory budget set again from the runs under that cap (1,536 MiB);
unflushed generated files and the narrowed raw-printer parity are accepted; and three limitations become phase-4 work,
among them the readable printer's `adr` naming a function label, which made the readable tree of that doubled ROM fail
its text-layout check (its raw tree links to its SHA-1). Under the 1,024 MiB cap every command of the bin completes on the synthetic
ROM, the six tuning ROMs and the doubled ROM. The landing run after Q7's answer failed one phase-2 timing gate,
`g2.speed`, by 0.5 ms on sa2 with the analysis unchanged; the owner's answer to Q8, "Re-run the gate list", ran the
whole closing list again unchanged with no gate change, and every command exited 0 at `landed` 3 (`0784b4e`), and the
phase pull request's CI passed before the merge.

Phase 4 (One shot) has landed ([docs/phase-4.md](docs/phase-4.md)): its closing gate passed at `landed` 4, last re-run
after fix round 14 (D90) at `76eacdb`, and its pull request (#4) is merged to `main` (`89deb54`), tagged `phase-4`. The owner answered its questions (D76, D79): `g2.speed` takes the median of nine runs per
ROM, the scaffold gitignores the generated tree as R4 says (a clone gets it from `setup.sh`), and the `env -S` launcher, `ROMLIFT_CLI` until romlift is published, listed entries without `from` taken without
validation, tmc's `W_UNLISTED_FUNCTION` after `init`, the 0x46C0 nop-pad orphans and the zero pads kept at a `c` module's end are recorded limitations. He also
skipped phase 5 (D92): rename, the reconciler, `expected/`, `objdiff.json`, the C data ranges and the objdiff gate move into
phase 6, and legacy import and the Klonoa switch-over are dropped. `romlift init <rom>` writes `romlift.toml`, `decomp.yaml`, the build
scaffold (`Makefile`, `setup.sh`, …), `INCLUDE_ASM` C stubs and the generated tree, and `./setup.sh && make` then
rebuilds the ROM to its SHA-1 with no file edited, on 50 committed fixtures and all six tuning ROMs (from the source
tree, the packed tarball and fresh git worktrees); `generate` regenerates the tree from the TOML without ever writing
it and keeps the `INCLUDE_ASM` lines of `src/*.c` in line with it, so every seeded legal TOML edit still builds with
`make` (one of its five kinds, a code override over a found function, changes nothing until phase 6 and warns
`W_OVERRIDE_IGNORED`), and `make` stops on a tree older than the TOML, as after a pull, until `generate` runs;
`update` proposes TOML patches that keep comments. Every gate of phases 1 to 4 passes on both tiers.

Phase 5 (Migration) was skipped by the owner and never lands (D92). Phase 6 (Evidence) has landed
(pull request #5, tag `phase-6`, [docs/phase-6.md](docs/phase-6.md)): library signatures (built with `npm run signatures
-- build <spec>`) that propose names, sizes and library modules to `init` (`--no-signatures` skips them) and `update`,
screened for conflicts with the analysis and the config; code run from RAM through hand-written `runs_at`
overrides (the owner dropped the gba-kit trace, D91); the full `explain`; and from phase 5 the reconciler, `rename <old>
<new>`, the `expected/` and `objdiff.json` writers, C data ranges (`data_start`) and the objdiff gate. Its closing list
passed every signature gate (the matcher refined at the closing round, D94) and the other gates but these: `g6.objdiff`
failed on the real tier as D34 then read (phase-6.md Q6), and with it `g1.provenance` and `bench provenance`, which
read the committed artifact's failing `g6.objdiff` record until the closing run regenerates it. The owner answered every open question
of phase-6.md on 25 October 2026; the first step of fix round 4 applied his gate edits (D98): `g6.reconciler`,
`g6.rename` and `g6.evidence-conflict`, which could not pass as written (Q2, Q3, Q5), now pass on the ci tier,
`g6.signatures-judged` holds tmc to the measured floor (Q9) and `g4.toml-mutations` makes an add-override edit that
changes the model and refuses an odd `[functions]` key (Q11). Its second step applied Q10 (D100), and its third Q12
and Q16 (D101): each objdiff target is now its unit's assembly as it is, so objdiff scores every function of an
untouched project at 100%, and `g6.expected-bytes` judges each target linked at its module's address, `runs_at` modules
included. Its fourth step applied Q6 and Q15 (D102): the printer spells a word inside a named, sized entry `sym +
addend` by one rule the label scopes share, the bench's `objectWords` rewrite is gone, D34 reports the same-word
differences and the uncompared functions, and `g6.objdiff` passes on the real tier with each tuning ROM's gated count at
its committed ceiling (fe7j 7, klonoa 1, pokeemerald 12, sa2 1, sa3 4, tmc 25). Fix round 1 of the
review (D95) changed no gate threshold, but its ROM overwrite of the objdiff targets left `g6.expected-bytes` able to
catch only a wrong size; fix round 2 (D96) tightened that gate to judge each unit's object as assembled, and put the
bench's `objectWords` rewrite, which changes what `g6.objdiff` measures, to the owner as Q15. Fix round 3 (D97) refuses a `runs_at`
module whose linker-script section is another section's name, and put `g6.expected-bytes`' `runs_at` exemption to the
owner as Q16. The closing list's fifth run, in a fresh worktree at `fa5d7ab`, exits 0 on every command (both gate
tiers, `bench provenance`), so phase 6 passes its closing gate. Fix round 5 (D104) made `g4.toml-mutations`'
add-override edit a data override that changes the model (the code override changed nothing), pinned the owner's
objdiff ceilings in `g6.objdiff` and put one R_ARM_ABS32 rule under the layout and the printer; the sixth run, at
`d66d802`, exits 0 on every command too. After fix round 6 the seventh run, at `74aa225`, exited 0 on every command,
and phase 6 landed: pull request #5 merged as `7a5342f`, tagged `phase-6`. GitHub refused to start the CI jobs, so
their checks ran locally (the owner's landing answer, D103) on macOS only: the Linux jobs (`ci.yml` on Ubuntu, the apt
binutils corpus, `fixtures.yml`, `packed.yml`) have not run for phase 6, and the cross-OS digest comparison covered two
macOS runs (a known limitation, carried past phase 6). `g6.objdiff` is a no-regression ceiling, not a 100% score: on
klonoa 130 of 485 functions are not compared at all (objdiff-cli cannot read one object).

The final review of the six phases (fix round 1, [docs/final-review.md](docs/final-review.md), D106) made the
first-run path above work from a checkout, stopped shipping signature specs nobody could build from the package, kept
`bx pc` veneers out of C modules, added `include/global.h` and `include/gba/*.h` to the scaffold, gave
`[signatures] libraries` its effect, moved the tree checks' composition out of the CLI, and recorded what stays open. Fix
round 2 (D107) restored sa2's `g2.speed` headroom with result-neutral speed changes to the analysis (about 81% of its
limit, from 95 to 101%), made `bench run` refuse to drop a ROM's PoC reference, and fixed the smaller findings. Release
1 still cannot claim generality: the held-out gate passes only with both family conditions waived (D60, D61).

| Phase | Delivers |
| --- | --- |
| 1 Decoder | instruction table, decoder, encoder, formatter and parser; the bench harness |
| 2 Analysis | function-boundary rules, compiler profile, `explain`, held-out runs |
| 3 Emission | the ROM model, writers, write plan, the tree checks |
| 4 One shot | config, scaffold, C stubs, `init`, `generate` |
| 5 Migration | skipped by the owner (D92); its reconciler, `rename` and objdiff targets moved to phase 6 |
| 6 Evidence | library signatures, code run from RAM (hand-written overrides; no trace, D91), full `explain`; the reconciler, `rename`, `expected/`, `objdiff.json`, C data ranges |

## Documentation

| Document | Contents |
| --- | --- |
| [docs/plan.md](docs/plan.md) | the plan: requirements R1–R9, phases, gates, risks |
| [docs/architecture.md](docs/architecture.md) | the definitive architecture: layers, types, analysis, printer, emission, signatures, bench, gates |
| [docs/decisions.md](docs/decisions.md) | architecture decision records D1–D119 with the alternatives rejected |
| [docs/roadmap.md](docs/roadmap.md) | build order, file ownership and exit commands of each phase |
| [docs/phase-1.md](docs/phase-1.md) | the record of phase 1: what it delivered, the gate run, deviations and known limitations |
| [docs/phase-2.md](docs/phase-2.md) | the record of phase 2: components, commands, the milestones M1–M7 with their numbers, the closing gate run, deviations, and the owner's answers that let the phase land |
| [docs/phase-3.md](docs/phase-3.md) | the record of phase 3: components in three waves, the closing fix round, the measured numbers, the closing gate runs, deviations, the owner questions Q1 to Q8 with the owner's answers, the review fix rounds, and known limitations |
| [docs/phase-4.md](docs/phase-4.md) | the record of phase 4: components in three waves, what the phase delivered (commands, scaffold, C stubs, formats), the closing round and the closing gate run, deviations, the owner questions Q1 to Q9 with the owner's answers, the review fix rounds, and known limitations |
| [docs/phase-6.md](docs/phase-6.md) | the record of phase 6 (phase 5 was skipped, D92; landed by pull request #5): what it delivered (signatures, proposals, code run from RAM, the reconciler and `rename`, objdiff targets, C data ranges), components in three waves, the closing round, deviations, the owner questions Q1 to Q16, known limitations, measured numbers, the closing gate runs and the review's dispositions |
| [docs/final-review.md](docs/final-review.md) | the final report of the review of the six phases: the five lenses, the final gate numbers per ROM (held-out included), the comparison with the proof of concept, the remaining findings, the commands that reproduce it, and every finding's disposition with the fixes of rounds 1 and 2 and the gate results after each |
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
npm run corpus
```

## License

[MIT](LICENSE)
