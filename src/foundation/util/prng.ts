// A fixed-seed xorshift32 generator (Marsaglia 2003, shifts 13, 17, 5) as plain functions over a state
// number. It backs every seeded sample: the corpus and the property
// tests (D2), so a sample depends on its seed alone. Not cryptographic, and never `Math.random`.

/**
 * Advances a xorshift32 state. The state is a nonzero unsigned 32-bit integer; the result is the next
 * state, also nonzero, which doubles as the generated value. The period is 2^32 - 1.
 */
export function xorshift32(state: number): number {
  if (!Number.isInteger(state) || state <= 0 || state > 0xffff_ffff) {
    throw new RangeError(`xorshift32 state must be a nonzero uint32, got ${state}`);
  }
  let x = state;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

/** The first `count` values generated from `seed`: `xorshift32(seed)`, then each next state in turn. */
export function prngSequence(seed: number, count: number): Uint32Array {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`prngSequence count must be a non-negative integer, got ${count}`);
  }
  const values = new Uint32Array(count);
  let state = seed;
  for (let i = 0; i < count; i++) {
    state = xorshift32(state);
    values[i] = state;
  }
  return values;
}
