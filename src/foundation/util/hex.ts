// Hexadecimal formatting and parsing of 32-bit addresses, the one spelling every output uses.

/** `value` as upper-case hex, zero-padded to `digits`, without a prefix; read as an unsigned 32-bit word. */
export function hex(value: number, digits = 8): string {
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
