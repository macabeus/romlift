# bench

The benchmark and regression harness (architecture §8). Development only: it is not published and
imports romlift only through `romlift`, `romlift/node`, `romlift/isa` and `romlift/internal` (D37).

It scores a seedless discover run of every dataset against the `FUNC` symbols of an ELF that rebuilds
the ROM, judges signatures afterwards, and runs the gates. ROMs, ELFs and maps are read from
`ROMLIFT_BENCH_ROOT` and are never committed; what is committed is `dataset/` (authored exception lists,
SHA-1s and ELF digests), `baseline/` and `results.json`, which only a phase lead regenerates (D43).
Held-out datasets run sealed: counts and verdicts only (D25, D53).

Run it with `npm run bench -- <command>`. The harness lands in phase 1 (component 1.D).
