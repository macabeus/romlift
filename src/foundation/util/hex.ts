// Hexadecimal formatting and parsing of 32-bit addresses, the one spelling every output uses.

/** The two upper-case hex digits of each byte value. */
const BYTE_HEX: readonly string[] = Array.from({ length: 256 }, (_, b) => b.toString(16).toUpperCase().padStart(2, '0'));

/** `value` as upper-case hex, zero-padded to `digits`, without a prefix; read as an unsigned 32-bit word. */
export function hex(value: number, digits = 8): string {
  if (digits === 8) {
    // The printer names every label and address with eight digits; a table lookup per byte is several times
    // faster than toString, toUpperCase and padStart, and gives the same text.
    const v = value >>> 0;
    return `${BYTE_HEX[v >>> 24] ?? ''}${BYTE_HEX[(v >>> 16) & 0xff] ?? ''}${BYTE_HEX[(v >>> 8) & 0xff] ?? ''}${BYTE_HEX[v & 0xff] ?? ''}`;
  }
  return (value >>> 0).toString(16).toUpperCase().padStart(digits, '0');
}

/** `addr` as '0x' followed by eight upper-case hex digits. */
export function hexAddr(addr: number): string {
  return `0x${hex(addr)}`;
}

const HEX_ADDR = /^0[xX]([0-9a-fA-F]{1,8})$/;

/** The value of '0x' followed by one to eight hex digits (either case); undefined for anything else. */
export function parseHexAddr(text: string): number | undefined {
  const digits = HEX_ADDR.exec(text)?.[1];
  return digits === undefined ? undefined : Number.parseInt(digits, 16);
}
