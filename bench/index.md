# bench

The benchmark and regression harness (architecture §8). Development only: it is not published and
imports romlift only through `romlift`, `romlift/node`, `romlift/isa` and `romlift/internal` (D37).

It scores a seedless discover run of every dataset against the `FUNC` symbols of an ELF that rebuilds
the ROM, judges signatures afterwards, and runs the gates. ROMs, ELFs and maps are read from
`ROMLIFT_BENCH_ROOT` and are never committed; what is committed is `dataset/` (authored exception lists,
SHA-1s and ELF digests), `baseline/` and `results.json`, which only a phase lead regenerates (D43).
Held-out datasets run sealed: counts and verdicts only (D25, D53).

Run it with `npm run bench -- <command>` (the commands are listed in AGENTS.md and architecture §8.5).
The harness landed in phase 1 (component 1.D) and rescored the proof of concept's dumps; from phase 2
`bench run` scores romlift's own discover run, with a `parity` digest per row against the PoC's
(`baseline/poc-digests.json`), and runs the sealed datasets for counts only. `baseline/` holds the PoC's
rows (`poc-2026-10-16.json`), the improvements accepted against them (`accepted-diffs.json`, each with
its commit), the parity digests, the pinned PoC source and the speed baseline (`speed.json`, written by
`bench speed --write-baseline`); `results.json` keeps the PoC-parity evidence of milestone M1 (the
`parity` member: digests, row diffs and the lockstep of every rule family, recorded before the PoC's LIFO
worklist was deleted). docs/phase-2.md records the numbers.
