// Little-endian reads of byte arrays that are not a Rom (a signature member's bytes): the one spelling (architecture-8).

/** The little-endian word at `offset` of `bytes`, unsigned; a byte past the end reads as 0. */
export function le32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) << 24)) >>> 0;
}
