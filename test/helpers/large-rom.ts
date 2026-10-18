// The deterministic 32 MiB synthetic ROM of g3.large-rom (architecture §9.4), for tests: the bench builds
// it (bench/src/large-rom-image.ts), from the committed synthetic fixtures.
export { FIXTURE_STARTUP_END, LARGE_ROM_BYTES, LARGE_ROM_SEED, largeRomImage, readFixtureRoms } from '../../bench/src/large-rom-image.ts';
export type { FixtureRom, LargeRomOptions } from '../../bench/src/large-rom-image.ts';
