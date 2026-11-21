// The objdiff ceilings (D102, the owner's answer of 25 October 2026 to phase-6.md Q6 and Q15): per tuning ROM, the most
// differences D34 as amended gates (objdiff-classes.ts isGated) that g6.objdiff accepts, bench/baseline/objdiff-ceiling.json.
// The first ceilings are the counts measured on the final product of the step that applied the answer; a ceiling may
// be lowered (bench/tools/objdiff-classes.ts --write-ceiling writes a ROM's count only when it is lower, and refuses a ROM
// without a ceiling), never raised without the owner; g6.objdiff pins the owner's values as the most a ceiling may be.
import { join } from 'node:path';
import { compareCodeUnits } from 'romlift';

import { type BenchContext, baselineDir } from './context.ts';
import { BenchError, exists, isRecord, readJson } from './files.ts';

export const CEILING_SCHEMA = 'romlift-bench/objdiff-ceiling@1';

export interface ObjdiffCeilings {
  readonly schema: typeof CEILING_SCHEMA;
  /** Per tuning ROM, its ceiling: a non-negative integer. */
  readonly roms: Readonly<Record<string, number>>;
}

export const ceilingPath = (cx: BenchContext): string => join(baselineDir(cx), 'objdiff-ceiling.json');

export function parseCeilings(value: unknown, where: string): ObjdiffCeilings {
  if (!isRecord(value) || value['schema'] !== CEILING_SCHEMA)
    throw new BenchError(`${where}: schema must be '${CEILING_SCHEMA}'`);
  const roms = value['roms'];
  if (!isRecord(roms)) throw new BenchError(`${where}: roms must be an object`);
  const out: Record<string, number> = {};
  for (const name of Object.keys(roms).sort(compareCodeUnits)) {
    const n = roms[name];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0)
      throw new BenchError(`${where}: roms.${name} must be a non-negative integer`);
    out[name] = n;
  }
  return { schema: CEILING_SCHEMA, roms: out };
}

/** bench/baseline/objdiff-ceiling.json, or undefined when it is not committed. */
export async function readCeilings(cx: BenchContext): Promise<ObjdiffCeilings | undefined> {
  const path = ceilingPath(cx);
  return (await exists(path)) ? parseCeilings(await readJson(path), path) : undefined;
}

/**
 * The ceilings after a measurement: each ROM's ceiling lowered to its measured count, never raised. A measured ROM
 * without a ceiling (or no ceiling file at all) is refused: setting a ceiling is the owner's (D102, D104 b), so the tool
 * never adds one. ROMs in code-unit order.
 */
export function lowerCeilings(
  existing: ObjdiffCeilings | undefined,
  measured: Readonly<Record<string, number>>,
): ObjdiffCeilings {
  const missing = Object.keys(measured)
    .filter((name) => existing?.roms[name] === undefined)
    .sort(compareCodeUnits);
  if (missing.length > 0)
    throw new BenchError(`no ceiling to lower for ${missing.join(', ')}: a new ceiling is the owner's (D102)`);
  const roms: Record<string, number> = {};
  for (const name of Object.keys(existing?.roms ?? {}).sort(compareCodeUnits)) {
    const had = existing?.roms[name] ?? 0;
    const now = measured[name];
    roms[name] = now === undefined ? had : Math.min(had, now);
  }
  return { schema: CEILING_SCHEMA, roms };
}
