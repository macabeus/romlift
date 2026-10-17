# Benchmark ROMs

romlift is judged against matching decompilations: a ROM together with an ELF that rebuilds it byte for byte. The ELF's `FUNC` symbols are the truth for function entries and extents (see the Benchmark and regression gate section of [plan.md](plan.md)). Symbol lists without types, such as `pokeemerald.sym`, are not enough.

## ROMs are never committed

ROMs are copyrighted. No ROM, ELF, map file or any other file derived from ROM bytes is ever committed to this repository. What may be committed is only what identifies or scores them: ROM SHA-1 hashes, the checkout commit of each ELF, the authored exception lists (`bench/dataset/real/<rom>.json`) and the results artifact (`bench/results.json`). The real benchmark tier therefore runs locally, where the ROMs are; CI checks the provenance of the committed artifact instead of re-running it.

All paths below are relative to `/Users/macabeus/ApenasMeu/decompiler` (the benchmark root, `benchRoot` in the PoC's `bench/results.json`).

## Tuning set: the five ROMs the proof of concept was tuned on, and tmc

The rules of the proof of concept (`/Users/macabeus/ApenasMeu/decompiler/romlift-poc`) were fixed against these five pairs, so their scores are not held-out scores. Since the owner's decision of 17 October 2026 (decision D60: "Tune on tmc, no new ROM") `tmc` is tuning data too: it was revealed (`npm run bench -- run --reveal tmc`, commit `306eaf2`, recorded in its dataset's `revealed` log) and romlift's rules were tuned on it. The PoC's pinned results never covered `tmc`, so it has no baseline row or parity digest; `export-poc --mode scored` runs the pinned PoC on it (from romlift's dataset, without writing into the PoC checkout), and that run's own row is its PoC reference and its scaffold verdict (D60 l). The parity and queries modes cover the five.

| Dataset name | Game | ROM | ELF | Map | Checkout (upstream) | ELF commit | ROM SHA-1 | ELF functions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `klonoa` | Klonoa: Empire of Dreams (USA) | `kleod/baserom.gba` | `kleod/kleod.elf` | `kleod/kleod.map` | testyourmine/kleod | `a57c1f0` | `a0a298d9dba1ba15d04a42fc2eb35893d1a9569b` | 559 |
| `sa2` | Sonic Advance 2 | `sa2/sa2.gba` | `sa2/sa2.elf` | `sa2/sa2.map` | SAT-R/sa2 | `393357f7c` | `7bcd6a07af7c894746fa28073fe0c0e34408022d` | 2,892 |
| `sa3` | Sonic Advance 3 | `sa3/sa3.gba` | `sa3/sa3.elf` | `sa3/sa3.map` | SAT-R/sa3 | `59df6083` | `685af3a2dc0f1b3f8922e73ec42c1dc92e210e39` | 4,693 |
| `fe7j` | Fire Emblem 7 (Japan) | `FireEmblem7J/FireEmblem7J.gba` | `FireEmblem7J/FireEmblem7J.elf` | `FireEmblem7J/FireEmblem7J.map` | MokhaLeee/FireEmblem7J | `f27a029` | `037702b1febd5c9535262165bf030551d153de81` | 7,735 |
| `pokeemerald` | Pokémon Emerald | `pokeemerald/pokeemerald.gba` | `pokeemerald/pokeemerald.elf` | `pokeemerald/pokeemerald.map` | pret/pokeemerald | `731ad5bfd` | `f3ae088181bf583e55daf962a92bb46f4f1d07b7` | 15,856 |
| `tmc` (revealed, D60) | The Legend of Zelda: The Minish Cap | `tmc/tmc.gba` | `tmc/tmc.elf` | `tmc/build/USA/tmc.map` | zeldaret/tmc | `6fb6dfb` | `b4bd50e4131b027c334547b4524e2dbbd4227130` | 8,636 |

ROM and ELF paths, SHA-1s and ELF commits of the five are those recorded in the PoC's `bench/dataset/real/*.json` and `bench/results.json` (generated 2026-10-16). ELF function counts are the PoC's scored truth after its startup-region rule (tmc's: romlift's scorer, same rule). tmc's, klonoa's and fe7j's ELFs give their last function no size; the scorer ends an unsized function where it starts (the largest addr + size), for every ROM, so tmc's code end is +148 (D60 j, owner question Q5).

## Held-out set: two unseen ROMs (three until tmc's reveal)

These pairs are the held-out gate of phase 2 ("the same gates on at least two ROMs never used to tune the rules"). The romlift rules must never be tuned on them: do not inspect their misses to invent or adjust a rule. They are run only to measure, and a failure there is fixed by finding the general compiler behaviour behind it and checking the fix on the tuning set first.

| Dataset name (proposed) | Game | Checkout (upstream) | Checkout commit | ROM | ELF | Map |
| --- | --- | --- | --- | --- | --- | --- |
| `pokefirered` | Pokémon FireRed | `pokefirered/` (pret/pokefirered) | `037335f` | `pokefirered/pokefirered.gba` | `pokefirered/pokefirered.elf` | `pokefirered/pokefirered.map` |
| `pokeruby` | Pokémon Ruby | `pokeruby/` (pret/pokeruby) | `5784633` | `pokeruby/pokeruby.gba` | `pokeruby/pokeruby.elf` | `pokeruby/pokeruby.map` |
| `tmc` (revealed on 2026-10-17, now tuning data) | The Legend of Zelda: The Minish Cap | `tmc/` (zeldaret/tmc) | `6fb6dfb` | `tmc/tmc.gba` | `tmc/tmc.elf` | `tmc/build/USA/tmc.map` |

Status on 2026-10-17: all three held-out builds (`pokefirered`, `pokeruby`, `tmc`) reproduce their checkout's own SHA-1 file, so all three pairs are ready. `tmc` writes its ELF at the checkout root (`tmc/tmc.elf`) and its map under the build directory (`tmc/build/USA/tmc.map`), not beside the ELF. Their ROM SHA-1s, ELF digests and ELF commits are recorded in their sealed dataset files (`bench/dataset/real/{pokefirered,pokeruby,tmc}.json`, phase 2), created by `node --conditions=source bench/tools/seal-dataset.ts`, which hashes the files, reads the checkout's `git rev-parse --short HEAD` and never reads a symbol; the measured commits equal the table above. This document records only the paths, so nobody opens, hashes or inspects a held-out file to keep it current.

## Codebase families and the reserve pool

Every dataset records its codebase family (architecture §8.2; the term is D55's, replacing "engine family"). `g2.held-out` needs two passing sealed ROMs
from at least two families, one of them absent from the tuning set (decision D53), so the two pret Gen-3
siblings of Emerald cannot pass the gate alone. Since tmc's reveal no sealed ROM of a family absent from
the tuning set remains; by the owner's decision of 17 October 2026 (D60) the gate waives its two family
conditions while that is so, and prints each waiver. An admitted reserve pair of a fresh family ends the
waiver, and is still needed before release 1 claims generality.

| Dataset | Family | In the tuning set? |
| --- | --- | --- |
| `klonoa` | `kleod` | yes |
| `sa2`, `sa3` | `sat-r` | yes |
| `fe7j` | `fe-gba` | yes |
| `pokeemerald` | `pret-gen3` | yes |
| `pokefirered`, `pokeruby` | `pret-gen3` | family yes, ROMs no |
| `tmc` | `zeldaret-tmc` | yes, since its reveal (D60) |

**Reserve pool.** Candidate checkouts for a fresh sealed pair when a held-out ROM is revealed or fails,
preferring families absent from the tuning set (now every family but `kleod`, `sat-r`, `fe-gba`,
`pret-gen3` and `zeldaret-tmc`). None is admitted yet: each counts only when its build
reproduces its own SHA-1 file and its ELF types functions, and it is then sealed on creation like the
three above. Candidates to evaluate, in order of preference: Kirby & the Amazing Mirror (a HAL codebase),
Pokémon Pinball: Ruby & Sapphire (a non-Gen-3 pret project), then siblings of tuning ROMs that count only
as their family (Fire Emblem 8, Fire Emblem 6, Sonic Advance).

## Other local resources

- agbcc builds: `/Users/macabeus/ApenasMeu/decompiler/pokeemerald/tools/agbcc` and `/Users/macabeus/ApenasMeu/decompiler/agbcc`.
- Build notes for the tuning-set checkouts on macOS are at the end of [research-notes.md](research-notes.md) ("What the proof of concept changed").
