// The two closed vocabularies the analysis rules emit (architecture §3.1, §8.3): why an ELF function
// was not reported (a miss reason) and what proposed a function that was accepted (an origin). The
// ids and meanings are the proof of concept's, plus the three origins romlift adds for functions the
// TOML lists, overrides, or that external evidence supplies. A unit test fails on an id with no
// definition; g2.vocabulary-emitted fails on an id that no rule emits.

/** Why a function the reference ELF has was not reported, by id. */
export const MISS_REASONS = {
  'inside-code': 'inside the code of an accepted function',
  'arm-unreached': 'ARM routine nothing accepted refers to',
  'not-dense': 'holes inside its extent',
  'pops-frame': 'a return path pops more than it pushed',
  'no-return-no-prologue': 'no return and no push {.., lr}',
  'pool-claimed': 'its pool or code overlaps claimed bytes',
  'pointer-table': 'its words are Thumb code pointers',
  'calls-non-code': 'calls something that is not code',
  'decode-error': 'does not decode',
  unanchored: 'valid, but no evidence accepted it',
} as const;
export type MissReason = keyof typeof MISS_REASONS;

/** What proposed an accepted function, by id: the `origin` of the seed or gap rule that proposed it. */
export const ORIGINS = {
  'rom-entry': 'the cartridge entry branch',
  'startup-pointer': 'a Thumb pointer in the startup code',
  call: 'called by accepted code',
  veneer: 'ARM code after bx pc',
  adr: 'named by an ARM adr',
  'pool-pointer': 'a pointer in an accepted literal pool',
  'data-pointer': 'a pointer in data',
  'gap-scan': 'unreferenced Thumb code between functions',
  'arm-gap-scan': 'unreferenced ARM code between functions',
  'tiled-hole': 'the reading that fills a gap exactly',
  listed: 'listed in the project TOML',
  override: 'an override in the project TOML',
  evidence: 'an external fact: a trace, an ELF, a map or a legacy cfg',
} as const;
export type Origin = keyof typeof ORIGINS;

/** Whether `id` is a miss reason id. */
export function isMissReason(id: string): id is MissReason {
  return Object.hasOwn(MISS_REASONS, id);
}

/** Whether `id` is an origin id. */
export function isOrigin(id: string): id is Origin {
  return Object.hasOwn(ORIGINS, id);
}
