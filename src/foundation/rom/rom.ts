// The cartridge image as a plain value mapped at 0x0800_0000, its little-endian readers, and the
// check that an image is a GBA cartridge at all. Pure: the shell reads the file and hashes it.
import { diagnostic, RomliftInvariantError } from '../diagnostics/diagnostic.ts';
import type { Diagnostic } from '../diagnostics/diagnostic.ts';
import { RomCodes } from './codes.ts';
import type { RomCode } from './codes.ts';
import { parseHeader } from './header.ts';
import type { Addr } from './span.ts';

/** The bus address of the first cartridge byte. */
export const ROM_BASE = 0x0800_0000;

/** The largest cartridge the GBA bus maps: 32 MiB. */
export const ROM_MAX_SIZE = 0x0200_0000;

/** The header fields romlift reads; see header.ts for the offsets. */
export interface CartridgeHeader {
  readonly title: string;
  readonly gameCode: string;
  readonly makerCode: string;
  readonly version: number;
}

/** The one public value never serialised, because it holds the bytes (architecture §3). */
export interface Rom {
  readonly base: typeof ROM_BASE;
  readonly bytes: Uint8Array;
  /** The bus address one past the last byte. */
  readonly end: Addr;
  /** Lower-case hex SHA-1 of `bytes`, computed by the shell and passed in (D44). */
  readonly sha1: string;
  readonly header: CartridgeHeader;
}

const HEADER_END = 0xc0;
const FIXED_BYTE_OFFSET = 0xb2;
const FIXED_BYTE = 0x96;
const COMPLEMENT_FIRST = 0xa0;
const COMPLEMENT_LAST = 0xbc;
const COMPLEMENT_OFFSET = 0xbd;

/** Wraps an image as a Rom. Never throws: the header is parsed leniently and checkRom reports problems. */
export function romFromBytes(bytes: Uint8Array, sha1: string): Rom {
  return { base: ROM_BASE, bytes, end: ROM_BASE + bytes.length, sha1, header: parseHeader(bytes) };
}

/** The header complement check byte the BIOS verifies at 0xBD. */
export function headerComplement(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = COMPLEMENT_FIRST; i <= COMPLEMENT_LAST; i++) {
    sum -= bytes[i] ?? 0;
  }
  return (sum - 0x19) & 0xff;
}

/** Every reason the image is not a GBA cartridge; empty when it is one. */
export function checkRom(bytes: Uint8Array): readonly Diagnostic<RomCode>[] {
  if (bytes.length < HEADER_END) {
    return [
      diagnostic(
        RomCodes,
        'E_ROM_NOT_GBA',
        `the image is ${bytes.length} bytes, shorter than the ${HEADER_END}-byte cartridge header`,
      ),
    ];
  }
  const found: Diagnostic<RomCode>[] = [];
  if (bytes.length > ROM_MAX_SIZE) {
    found.push(
      diagnostic(RomCodes, 'E_ROM_NOT_GBA', `the image is ${bytes.length} bytes, larger than 32 MiB (${ROM_MAX_SIZE})`),
    );
  }
  const fixed = bytes[FIXED_BYTE_OFFSET] ?? 0;
  if (fixed !== FIXED_BYTE) {
    found.push(
      diagnostic(RomCodes, 'E_ROM_NOT_GBA', `the header byte at 0xB2 is 0x${byteHex(fixed)}, not 0x96`, {
        addr: ROM_BASE + FIXED_BYTE_OFFSET,
      }),
    );
  }
  const expected = headerComplement(bytes);
  const stored = bytes[COMPLEMENT_OFFSET] ?? 0;
  if (stored !== expected) {
    found.push(
      diagnostic(
        RomCodes,
        'E_ROM_NOT_GBA',
        `the header complement at 0xBD is 0x${byteHex(stored)}, but the header sums to 0x${byteHex(expected)}`,
        { addr: ROM_BASE + COMPLEMENT_OFFSET },
      ),
    );
  }
  return found;
}

function byteHex(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, '0');
}

/** Whether the `len` bytes from bus address `a` all lie inside the ROM. */
export function contains(rom: Rom, a: Addr, len = 1): boolean {
  return Number.isInteger(a) && Number.isInteger(len) && len >= 0 && a >= ROM_BASE && a + len <= rom.end;
}

/** The file offset of the `len` bytes at `a`; reading outside the ROM is a caller bug. */
function offsetOf(rom: Rom, a: Addr, len: number): number {
  if (!contains(rom, a, len)) {
    throw new RomliftInvariantError(`read of ${len} bytes at 0x${(a >>> 0).toString(16)} outside the ROM`);
  }
  return a - ROM_BASE;
}

/** The byte at bus address `a`. */
export function u8(rom: Rom, a: Addr): number {
  return rom.bytes[offsetOf(rom, a, 1)] ?? 0;
}

/** The little-endian halfword at bus address `a` (any alignment). */
export function u16(rom: Rom, a: Addr): number {
  const i = offsetOf(rom, a, 2);
  const b = rom.bytes;
  return (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
}

/** The little-endian word at bus address `a` (any alignment), as an unsigned number. */
export function u32(rom: Rom, a: Addr): number {
  const i = offsetOf(rom, a, 4);
  const b = rom.bytes;
  return ((b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16) | ((b[i + 3] ?? 0) << 24)) >>> 0;
}
