// Diagnostic codes raised by core/model (architecture §9.1, D45, D62 e): the config's modules and overrides
// checked against the ROM's legal borders, names checked per module, and the one exception the printer takes
// for a border moved by hand (D15).
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
  E_OVERRIDE_INVALID: { severity: 'error', meaning: 'a runs_at override range does not start and end on module borders (§6.7)' },
  W_FUNCTION_OUTSIDE_ROM: {
    severity: 'warning',
    meaning: 'a [functions] entry lies outside the ROM, so the model has no function for it, or an [[overrides]] range reaches outside it, where it applies to nothing',
  },
  W_SYMBOL_UNPLACED: {
    severity: 'warning',
    meaning:
      'a [symbols] entry inside the ROM lies inside an instruction, a pool word or a table entry, where no file can define a label (D63 d), so its name is not printed',
  },
  W_CROSS_MODULE_SHORT_BRANCH: {
    severity: 'warning',
    meaning: 'a short Thumb branch (b, bcc) crosses a module border moved by hand, so it prints raw (D15)',
  },
});

export type ModelCode = keyof typeof ModelCodes;
