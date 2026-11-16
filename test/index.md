# test

Tests run with `node --test` on the TypeScript sources (`--conditions=source`); there is no test
framework dependency (D2). Layout (architecture §10):

| Path | Contents | Needs a ROM | Run by |
| --- | --- | --- | --- |
| `repository.test.ts` | repository invariants: Node floor, required compiler options, no ROM-derived file tracked | no | `npm test` |
| `architecture.test.ts` | tsc, and ESLint (`eslint.config.js`: layer edges, globals allowlist, `Map` iteration, rule-file isolation, barrels) with no problem (D5, D117) | no | `npm test` |
| `unit/` | one directory per `src/` module; `*.prop.test.ts` are seeded property tests | no | `npm test` |
| `golden/` | printer, writers, TOML serializer and patcher, reconciler, explain; `UPDATE_GOLDEN=1` rewrites | no | `npm test` |
| `mutation/` | fault injection proving every checker fails with the right code | no | `npm test` |
| `gates/` | one file per phase gate `gN.<name>.test.ts`, plus `gate.ts` and `phase.json` | per gate | `npm run bench -- gates` |
| `local/` | the PoC decoder differential, `epoch-reuse` against `epoch`, the committed PoC-parity and lockstep evidence; report `unavailable` when an input is absent | yes | `npm run test:local` |
| `corpus/`, `fixtures/`, `helpers/` | the `as` round-trip corpus generator, tiny self-authored parser fixtures, shared helpers | no | the tests above |

`gates/`, `local/` and the bench import romlift only through its package entry points (D37).
