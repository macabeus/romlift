# Benchmark ROMs

romlift is judged against matching decompilations: a ROM together with an ELF that rebuilds it byte for byte. The ELF's `FUNC` symbols are the truth for function entries and extents (see the Benchmark and regression gate section of [plan.md](plan.md)). Symbol lists without types, such as `pokeemerald.sym`, are not enough.

## ROMs are never committed

ROMs are copyrighted. No ROM, ELF, map file or any other file derived from ROM bytes is ever committed to this repository. What may be committed is only what identifies or scores them: ROM SHA-1 hashes, the checkout commit of each ELF, the authored exception lists (`bench/dataset/real/<rom>.json`) and the results artifact (`bench/results.json`). The real benchmark tier therefore runs locally, where the ROMs are; CI checks the provenance of the committed artifact instead of re-running it.

All paths below are relative to `/Users/macabeus/ApenasMeu/decompiler` (the benchmark root, `benchRoot` in the PoC's `bench/results.json`).

## Tuning set: the five ROMs the proof of concept was tuned on

The rules of the proof of concept (`/Users/macabeus/ApenasMeu/decompiler/romlift-poc`) were fixed against these five pairs, so their scores are not held-out scores.

| Dataset name | Game | ROM | ELF | Map | Checkout (upstream) | ELF commit | ROM SHA-1 | ELF functions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `klonoa` | Klonoa: Empire of Dreams (USA) | `kleod/baserom.gba` | `kleod/kleod.elf` | `kleod/kleod.map` | testyourmine/kleod | `a57c1f0` | `a0a298d9dba1ba15d04a42fc2eb35893d1a9569b` | 559 |
| `sa2` | Sonic Advance 2 | `sa2/sa2.gba` | `sa2/sa2.elf` | `sa2/sa2.map` | SAT-R/sa2 | `393357f7c` | `7bcd6a07af7c894746fa28073fe0c0e34408022d` | 2,892 |
| `sa3` | Sonic Advance 3 | `sa3/sa3.gba` | `sa3/sa3.elf` | `sa3/sa3.map` | SAT-R/sa3 | `59df6083` | `685af3a2dc0f1b3f8922e73ec42c1dc92e210e39` | 4,693 |
| `fe7j` | Fire Emblem 7 (Japan) | `FireEmblem7J/FireEmblem7J.gba` | `FireEmblem7J/FireEmblem7J.elf` | `FireEmblem7J/FireEmblem7J.map` | MokhaLeee/FireEmblem7J | `f27a029` | `037702b1febd5c9535262165bf030551d153de81` | 7,735 |
| `pokeemerald` | Pokémon Emerald | `pokeemerald/pokeemerald.gba` | `pokeemerald/pokeemerald.elf` | `pokeemerald/pokeemerald.map` | pret/pokeemerald | `731ad5bfd` | `f3ae088181bf583e55daf962a92bb46f4f1d07b7` | 15,856 |

ROM and ELF paths, SHA-1s and ELF commits are those recorded in the PoC's `bench/dataset/real/*.json` and `bench/results.json` (generated 2026-10-16). ELF function counts are the PoC's scored truth after its startup-region rule.

## Held-out set: three unseen ROMs

These three pairs are the held-out gate of phase 2 ("the same gates on at least two ROMs never used to tune the rules"). The romlift rules must never be tuned on them: do not inspect their misses to invent or adjust a rule. They are run only to measure, and a failure there is fixed by finding the general compiler behaviour behind it and checking the fix on the tuning set first.

| Dataset name (proposed) | Game | Checkout (upstream) | Checkout commit | Expected ROM | Expected ELF | Map |
| --- | --- | --- | --- | --- | --- | --- |
| `pokefirered` | Pokémon FireRed | `pokefirered/` (pret/pokefirered) | `037335f` | `pokefirered/pokefirered.gba` | `pokefirered/pokefirered.elf` | `pokefirered/pokefirered.map` |
| `pokeruby` | Pokémon Ruby | `pokeruby/` (pret/pokeruby) | `5784633` | `pokeruby/pokeruby.gba` | `pokeruby/pokeruby.elf` | `pokeruby/pokeruby.map` |
| `tmc` | The Legend of Zelda: The Minish Cap | `tmc/` (zeldaret/tmc) | `6fb6dfb` | `tmc/tmc.gba` | `tmc/tmc.elf` | `tmc/tmc.map` |

Status on 2026-10-17: another agent is preparing these builds. `pokefirered` and `pokeruby` already have a built ELF, ROM and map in their checkouts; `tmc` has only `baserom.gba` and no ELF yet. Each pair counts as ready only when its build reproduces the checkout's own SHA-1 file; its ROM SHA-1 and ELF commit are then recorded in its dataset file, like the tuning set.

## Engine families and the reserve pool

Every dataset records its engine family (architecture §8.2). `g2.held-out` needs two passing sealed ROMs
from at least two families, one of them absent from the tuning set (decision D53), so the two pret Gen-3
siblings of Emerald cannot pass the gate alone.

| Dataset | Family | In the tuning set? |
| --- | --- | --- |
| `klonoa` | `kleod` | yes |
| `sa2`, `sa3` | `sat-r` | yes |
| `fe7j` | `fe-gba` | yes |
| `pokeemerald` | `pret-gen3` | yes |
| `pokefirered`, `pokeruby` | `pret-gen3` | family yes, ROMs no |
| `tmc` | `zeldaret-tmc` | no |

**Reserve pool.** Candidate checkouts for a fresh sealed pair when a held-out ROM is revealed or fails,
preferring families absent from the tuning set. None is admitted yet: each counts only when its build
reproduces its own SHA-1 file and its ELF types functions, and it is then sealed on creation like the
three above. Candidates to evaluate, in order of preference: Kirby & the Amazing Mirror (a HAL engine),
Pokémon Pinball: Ruby & Sapphire (a non-Gen-3 pret project), then siblings of tuning ROMs that count only
as their family (Fire Emblem 8, Fire Emblem 6, Sonic Advance).

## Other local resources

- agbcc builds: `/Users/macabeus/ApenasMeu/decompiler/pokeemerald/tools/agbcc` and `/Users/macabeus/ApenasMeu/decompiler/agbcc`.
- Build notes for the tuning-set checkouts on macOS are at the end of [research-notes.md](research-notes.md) ("What the proof of concept changed").
