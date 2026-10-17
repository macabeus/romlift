// The BIOS calls that copy memory (GBATEK "BIOS Memory Copy"), as data: CpuSet (swi 0x0B) and CpuFastSet
// (swi 0x0C) take the source address in r0, the destination in r1 and a control word in r2, whose bits
// 0-20 are the count, bit 24 asks for a fill (the first source unit is repeated, nothing is copied), and,
// for CpuSet only, bit 26 makes the unit a 32-bit word instead of a 16-bit halfword; CpuFastSet always
// moves 32-bit words. A Thumb `swi imm8` or a library stub that is one names the call by number.

/** The swi number of CpuSet. */
export const BIOS_CPU_SET = 0x0b;
/** The swi number of CpuFastSet. */
export const BIOS_CPU_FAST_SET = 0x0c;

/** The argument registers of both copy calls. */
export const BIOS_COPY_ARGS = { source: 0, dest: 1, control: 2 } as const;

const COUNT_MASK = 0x1f_ffff;
const FILL = 1 << 24;
const WORDS = 1 << 26;

/** The bytes a CpuSet or CpuFastSet with `control` copies; undefined for another call number or a fill. */
export function biosCopyBytes(swi: number, control: number): number | undefined {
  if (swi !== BIOS_CPU_SET && swi !== BIOS_CPU_FAST_SET) return undefined;
  if ((control & FILL) !== 0) return undefined;
  const unit = swi === BIOS_CPU_FAST_SET || (control & WORDS) !== 0 ? 4 : 2;
  return (control & COUNT_MASK) * unit;
}
