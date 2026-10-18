// The deterministic 32 MiB synthetic ROM of g3.large-rom (architecture §9.4, D42): fixture code tiled with
// seeded data. The image opens with the cartridge header and the startup of the first fixture, which every
// synthetic fixture shares (bench/dataset/synthetic/common/crt0.s); then each fixture's code region (what
// follows the startup, in fixture order, cycling) alternates with a block of seeded xorshift32 words, until
// the next tile no longer fits; the rest is 0xFF.
//
// Every tile is code the analysis reaches, so the measurement covers accepted functions across the whole
// image and not only the first tile: a tile keeps its 4-byte alignment, its branches are position
// independent, every aligned word of it that pointed into its own code as linked is moved with it, and the
// data block after it opens with a pointer to its `main` (where its startup's pool word pointed, moved with
// the tile). Nothing here reads the clock or Math.random.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { compareCodeUnits } from 'romlift';

/** The size g3.large-rom requires: 32 MiB, the largest cartridge. */
export const LARGE_ROM_BYTES = 32 * 1024 * 1024;
/** The default seed ('ROML'). */
export const LARGE_ROM_SEED = 0x524f4d4c;
/**
 * Where the shared startup of crt0.s ends: the 0xC0-byte header, then `start_vector` with its pool, whose
 * last word points at the fixture's `main` at this offset.
 */
export const FIXTURE_STARTUP_END = 0xf4;
/** Each data block holds between 256 and 2,047 words (1 KiB to 8 KiB): a seeded size per block. */
const DATA_MIN_WORDS = 256;
const DATA_SPAN_WORDS = 1792;
const PAD = 0xff;

export interface LargeRomOptions {
  /** The image size, a multiple of 4 above the startup; default 32 MiB. */
  readonly bytes?: number;
  /** The xorshift32 seed, a nonzero uint32; default LARGE_ROM_SEED. */
  readonly seed?: number;
}

/**
 * Advances a xorshift32 state (Marsaglia 2003, shifts 13, 17, 5): the state is a nonzero uint32 and the
 * result, the next state, is also the generated value. The same generator as romlift's seeded samples.
 */
export function xorshift32(state: number): number {
  if (!Number.isInteger(state) || state <= 0 || state > 0xffff_ffff) throw new RangeError(`xorshift32 state must be a nonzero uint32, got ${state}`);
  let x = state;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

const ROM_BASE = 0x0800_0000;

/** The startup's pool word that points at the fixture's `main` (bit 0 set for Thumb). */
function mainWord(rom: Uint8Array): number {
  return new DataView(rom.buffer, rom.byteOffset, rom.byteLength).getUint32(FIXTURE_STARTUP_END - 4, true);
}

/**
 * Moves the tile's pointers into its own code with it: every aligned word in [start, end) whose value lies
 * in the tile as its fixture linked it (from the startup's end to the tile's length, bit 0 ignored) gains
 * `delta`.
 */
function rebase(view: DataView, start: number, end: number, delta: number): void {
  const low = ROM_BASE + FIXTURE_STARTUP_END;
  const high = ROM_BASE + FIXTURE_STARTUP_END + (end - start);
  for (let at = start; at + 4 <= end; at += 4) {
    const word = view.getUint32(at, true);
    const target = word & ~1;
    if (target >= low && target < high) view.setUint32(at, (word + delta) >>> 0, true);
  }
}

/** The synthetic image built from `fixtures` (each a fixture ROM, the first giving the header and startup). */
export function largeRomImage(fixtures: readonly Uint8Array[], options: LargeRomOptions = {}): Uint8Array {
  const bytes = options.bytes ?? LARGE_ROM_BYTES;
  let state = options.seed ?? LARGE_ROM_SEED;
  if (!Number.isInteger(bytes) || bytes % 4 !== 0 || bytes <= FIXTURE_STARTUP_END) throw new RangeError(`the image size must be a multiple of 4 above 0x${FIXTURE_STARTUP_END.toString(16)}, got ${bytes}`);
  xorshift32(state); // validates the seed
  const first = fixtures[0];
  if (first === undefined) throw new RangeError('largeRomImage needs at least one fixture ROM');
  const tiles = fixtures.map((rom, i) => {
    if (rom.length <= FIXTURE_STARTUP_END) throw new RangeError(`fixture ROM ${i} has ${rom.length} bytes, no code after its startup`);
    return rom.subarray(FIXTURE_STARTUP_END);
  });
  const image = new Uint8Array(bytes).fill(PAD);
  image.set(first.subarray(0, FIXTURE_STARTUP_END), 0);
  const view = new DataView(image.buffer);
  let at = FIXTURE_STARTUP_END;
  for (let i = 0; ; i++) {
    const tile = tiles[i % tiles.length] ?? first;
    const tileEnd = at + Math.ceil(tile.length / 4) * 4;
    if (tileEnd > bytes) break;
    image.fill(0, at, tileEnd);
    image.set(tile, at);
    rebase(view, at, tileEnd, at - FIXTURE_STARTUP_END);
    const tileStart = at;
    at = tileEnd;
    if (at + 4 > bytes) break;
    view.setUint32(at, (mainWord(fixtures[i % fixtures.length] ?? first) + tileStart - FIXTURE_STARTUP_END) >>> 0, true);
    at += 4;
    state = xorshift32(state);
    const words = Math.min(DATA_MIN_WORDS + (state % DATA_SPAN_WORDS), (bytes - at) / 4);
    for (let w = 0; w < words; w++) {
      state = xorshift32(state);
      view.setUint32(at, state, true);
      at += 4;
    }
  }
  return image;
}

/** One committed synthetic fixture's ROM. */
export interface FixtureRom {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** The committed fixture ROMs `bench/dataset/synthetic/<name>/build/<name>.gba`, in code-unit order of the name. */
export async function readFixtureRoms(repoRoot: string): Promise<FixtureRom[]> {
  const root = join(repoRoot, 'bench', 'dataset', 'synthetic');
  const out: FixtureRom[] = [];
  const entries = (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  for (const name of entries.sort(compareCodeUnits)) {
    try {
      out.push({ name, bytes: new Uint8Array(await readFile(join(root, name, 'build', `${name}.gba`))) });
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  return out;
}
