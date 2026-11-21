// The binding of an owner's scoping to the dataset it was decided on (D61 c, d; overfitting-r0-4), in one
// place: g2.poc-parity (poc-parity-check.ts SCOPED_OUT) and g2.baseline-rows (baseline-rows-verdict.ts
// BENCHMARK_ROWS) each hold tmc by name, ROM SHA-1 and ELF SHA-256 (g2.confirm-equals-discover's, D61 e, ended
// with D114), as held-out-verdict.ts FAMILY_WAIVER holds the sealed pair. A dataset
// of that name with another ROM or ELF (another build, another region) is not what the owner decided on:
// the scoping ends, fails as stale, and the ROM is judged as without it until the owner decides anew.

/** The files a scoping was decided on. */
export interface DatasetBinding {
  readonly sha1: string;
  readonly elfSha256: string;
}

/** A dataset as a scoping is checked against it: its ROM SHA-1 and, when it has one, its ELF SHA-256. */
export interface DatasetIdentity {
  readonly sha1: string;
  readonly elfSha256?: string | undefined;
}

/** tmc as the owner's answers of 18 October 2026 (D61) were given on: bench/dataset/real/tmc.json then. */
export const TMC_AT_D61: DatasetBinding = {
  sha1: 'b4bd50e4131b027c334547b4524e2dbbd4227130',
  elfSha256: '7d27e8d999c5f14b11885e530fc99669b08880deda79e98f3e3e8411482005d6',
};

/**
 * Why the scoping `decision` of `name`, bound to `bound`, does not hold for `dataset`, or undefined when it
 * does. A dataset without an ELF digest never matches.
 */
export function bindingMismatch(
  name: string,
  decision: string,
  bound: DatasetBinding,
  dataset: DatasetIdentity,
): string | undefined {
  if (dataset.sha1 === bound.sha1 && dataset.elfSha256 === bound.elfSha256) return undefined;
  return (
    `${name}: the ${decision} scoping was decided on ROM SHA-1 ${bound.sha1} and ELF SHA-256 ${bound.elfSha256}, ` +
    `the dataset has ${dataset.sha1} and ${dataset.elfSha256 ?? 'none'}: the scoping is stale, a new owner decision is needed`
  );
}
