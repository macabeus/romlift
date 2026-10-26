// The zod building blocks the two signature schemas share (the signature file, schema.ts, and the spec, spec.ts; D95 d),
// each with the refusal text it gives (architecture-r1-8): kept apart from both file formats, so neither holds the
// other's helpers. Pure.
import { z } from 'zod';

const NON_EMPTY = 'must be a non-empty string';

/** A non-empty string. */
export const nonEmptyText = z.string({ error: NON_EMPTY }).min(1, { error: NON_EMPTY });

/** Any string. */
export const anyText = z.string({ error: 'must be a string' });

/** An array of `item`. */
export function listOf<T extends z.ZodType>(item: T): z.ZodArray<T> {
  return z.array(item, { error: 'must be an array' });
}

/** An object with exactly `shape`'s keys (unknown keys refused). */
export function exactObject<T extends z.core.$ZodLooseShape>(shape: T): z.ZodObject<T, z.core.$strict> {
  return z.strictObject(shape, { error: 'must be an object' });
}
