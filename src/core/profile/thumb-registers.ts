// What a Thumb instruction does to the registers, as far as tracking a jump-table base needs it (milestone
// M3, walk.table-by-register): the registers it writes, and the registers the written value is followed
// back to when it is a move, an add, or a word load whose address is the table slot. A written value that
// is not followed (a constant, an arithmetic result, a call's clobbers) ends the trail of that register.
import type { Insn } from '../../foundation/isa/types.ts';

export interface RegisterEffect {
  /** A bit per register written (bit 15 is pc). */
  readonly writes: number;
  /** The registers the written value comes from, when it is followed; empty when it is not. */
  readonly from: readonly number[];
}

const NONE: RegisterEffect = { writes: 0, from: [] };
const bit = (r: number): number => 1 << r;
const field = (insn: Insn, name: string): number => insn.fields[name] ?? 0;
/** The 4-bit register of a hi-register row: H:R3. */
const hi = (insn: Insn, h: string, r: string): number => (field(insn, h) << 3) | field(insn, r);

/** The rows whose value is followed: rd <- rm, rd <- rn + rm, rd <- rn + imm, rd <- rd + imm, rd <- [rn, rm], rd <- [rn, #imm]. */
const FOLLOWED: Readonly<Record<string, (insn: Insn) => RegisterEffect>> = {
  'thumb.movs_reg': (i) => ({ writes: bit(field(i, 'rd')), from: [field(i, 'rm')] }),
  'thumb.add_reg': (i) => ({ writes: bit(field(i, 'rd')), from: [field(i, 'rn'), field(i, 'rm')] }),
  'thumb.add_imm3': (i) => ({ writes: bit(field(i, 'rd')), from: [field(i, 'rn')] }),
  'thumb.add_imm8': (i) => ({ writes: bit(field(i, 'rd')), from: [field(i, 'rd')] }),
  'thumb.add_hi': (i) => ({ writes: bit(hi(i, 'hd', 'rd3')), from: [hi(i, 'hd', 'rd3'), hi(i, 'hm', 'rm3')] }),
  'thumb.mov_hi': (i) => ({ writes: bit(hi(i, 'hd', 'rd3')), from: [hi(i, 'hm', 'rm3')] }),
  'thumb.ldr_reg': (i) => ({ writes: bit(field(i, 'rd')), from: [field(i, 'rn'), field(i, 'rm')] }),
  'thumb.ldr_imm': (i) => ({ writes: bit(field(i, 'rd')), from: [field(i, 'rn')] }),
};

/** The rows that write `rd` with a value that is not followed (the pool load is handled by its flow). */
const WRITES_RD: ReadonlySet<string> = new Set(
  [
    'lsl_imm', 'lsr_imm', 'asr_imm', 'sub_reg', 'sub_imm3', 'mov_imm', 'sub_imm8', 'and', 'eor', 'lsl_reg', 'lsr_reg', 'asr_reg',
    'adc', 'sbc', 'ror_reg', 'neg', 'orr', 'mul', 'bic', 'mvn', 'ldr_pc', 'ldrsb_reg', 'ldrh_reg', 'ldrb_reg', 'ldrsh_reg',
    'ldrb_imm', 'ldrh_imm', 'ldr_sp', 'adr', 'add_sp_rd',
  ].map((name) => `thumb.${name}`),
);

/** A call clobbers r0-r3, r12 and lr; a BIOS call r0-r3. */
const CALL_CLOBBERS = 0b0101_0000_0000_1111;
const SWI_CLOBBERS = 0b1111;

/** The register effect of a Thumb instruction. */
export function thumbRegisterEffect(insn: Insn): RegisterEffect {
  const followed = FOLLOWED[insn.specId];
  if (followed !== undefined) return followed(insn);
  if (WRITES_RD.has(insn.specId)) return { writes: bit(field(insn, 'rd')), from: [] };
  switch (insn.specId) {
    case 'thumb.pop':
      return { writes: field(insn, 'rlist'), from: [] };
    case 'thumb.pop_pc':
      return { writes: field(insn, 'rlist') | bit(15), from: [] };
    case 'thumb.ldmia':
      return { writes: field(insn, 'rlist') | bit(field(insn, 'rn')), from: [] };
    case 'thumb.stmia':
      return { writes: bit(field(insn, 'rn')), from: [] };
    case 'thumb.bl':
      return { writes: CALL_CLOBBERS, from: [] };
    case 'thumb.swi':
      return { writes: SWI_CLOBBERS, from: [] };
    default:
      return NONE;
  }
}
