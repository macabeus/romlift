// Diagnostic codes raised by core/model (architecture §9.1, D45, D62 e): the config's modules and overrides
// checked against the ROM's legal borders, names checked per module, and the one exception the printer takes
// for a border moved by hand (D15). Fix round 5 adds W_OVERRIDE_IGNORED (D81 c; its E_FUNCTION_MISALIGNED moved to
// core/config in fix round 6, D82). Phase 6 adds E_DATA_RANGE_INVALID with the C data ranges (architecture §6.6, D92).
import { defineCodes } from '../../foundation/diagnostics/diagnostic.ts';

export const ModelCodes = defineCodes({
  E_MODULE_BORDER: {
    severity: 'error',
    meaning: 'a module starts where no legal border is (core/layout/borders.ts); the message names the nearest legal borders',
  },
  E_MODULE_ORDER: { severity: 'error', meaning: 'the module starts do not increase from the ROM base' },
  E_NAME_COLLISION: {
    severity: 'error',
    meaning: 'two labels of one module share a name, or a name repeats in another module while one of them is referenced from outside its module',
  },
  E_NAME_INVALID: {
    severity: 'error',
    meaning:
      'a function, alias or symbol name is no symbol name a file may define (a leading $ is a mapping symbol, a leading . a section or local label; at most 200 characters, since a function name is a file name), or a module name is no module name (letters, digits and _, not starting with a digit, at most 200 characters: it is a path component and an object name)',
  },
  E_MODULE_NAME_DUPLICATE: {
    severity: 'error',
    meaning: 'two modules share a name, or names one on a case-insensitive file system, whatever their kinds, so both would build one object',
  },
  E_OVERRIDE_INVALID: { severity: 'error', meaning: 'a runs_at override range does not start and end on module borders (§6.7)' },
  E_DATA_RANGE_INVALID: {
    severity: 'error',
    meaning:
      'a [[modules]] data_start that cannot start a C data range (§6.6): on a module that is not kind = "c", not word-aligned, below the data start (code lies there) or at or past the ROM end, not past its module\'s start, inside a runs_at range, cutting a module that is neither its own nor a data module, or overlapping another module\'s range',
  },
  E_MODULE_SOURCE_INVALID: {
    severity: 'error',
    meaning:
      'a [[modules]] source that cannot be a hand-written source (D109): on a module that is not kind = "asm" or is generated = false, not a relative path to a .s file of letters, digits and _ . + - (no segment starting with a dot), under a directory or file romlift generates (asm/, data/, expected/, ...) or build/, or the source of another module too',
  },
  W_OVERRIDE_IGNORED: {
    severity: 'warning',
    meaning: 'an [[overrides]] entry without runs_at changes nothing romlift builds: a data override whose bytes the analysis did not claim, or a code override whose seed added no function (one already starts there, or in a confirm run [functions] does not list its start, which the run only reports) and that gives no listed entry its extent (fix round 5, D81 c; applied since phase 6, correctness-b0-3; the unlisted case since phase-6 fix round 5, correctness-o0-2)',
  },
  W_FUNCTION_OUTSIDE_ROM: {
    severity: 'warning',
    meaning: 'a [functions] entry lies outside the ROM, so the model has no function for it',
  },
  W_OVERRIDE_OUTSIDE_ROM: {
    severity: 'warning',
    meaning: 'an [[overrides]] range reaches outside the ROM, where it applies to nothing; the part inside still applies',
  },
  W_SYMBOL_UNPLACED: {
    severity: 'warning',
    meaning:
      'a [symbols] entry inside the ROM lies inside an instruction, a pool word or a table entry, where no file can define a label (D63 d), so its name is not printed',
  },
  W_POOL_WORD_PAST_SYMBOL: {
    severity: 'warning',
    meaning:
      'functions that load an unsized work-RAM [symbols] entry also load words past what its code-proven extent covers, before the next named start, which print as numbers; a size on the entry prints them as name + offset (D110)',
  },
  W_CROSS_MODULE_SHORT_BRANCH: {
    severity: 'warning',
    meaning: 'a short Thumb branch (b, bcc) crosses a module border moved by hand, so it prints raw (D15)',
  },
  W_INTERWORKING_BRANCH: {
    severity: 'warning',
    meaning:
      'a b or bl names a function label of the other state (a Thumb branch to an ARM function, or the reverse), for which GNU ld would insert an interworking veneer and move every byte after it, so it prints raw; the function\'s listed mode likely contradicts its callers',
  },
});

export type ModelCode = keyof typeof ModelCodes;
