// The cartridge header fields romlift reads (GBATEK "Cartridge Header"), parsed leniently: a short or
// malformed image yields empty strings and version 0, never an error (checkRom reports those).
import type { CartridgeHeader } from './rom.ts';

const TITLE = { offset: 0xa0, length: 12 } as const;
const GAME_CODE = { offset: 0xac, length: 4 } as const;
const MAKER_CODE = { offset: 0xb0, length: 2 } as const;
const VERSION_OFFSET = 0xbc;

/** The header text field at `offset`, one character per byte, with trailing NULs and outer spaces trimmed. */
function asciiField(bytes: Uint8Array, offset: number, length: number): string {
  let text = '';
  const end = Math.min(offset + length, bytes.length);
  for (let i = offset; i < end; i++) {
    text += String.fromCharCode(bytes[i] ?? 0);
  }
  return text.replace(/\0+$/, '').trim();
}

/** Title, game code, maker code and version of a cartridge image (offsets from the start of the file). */
export function parseHeader(bytes: Uint8Array): CartridgeHeader {
  return {
    title: asciiField(bytes, TITLE.offset, TITLE.length),
    gameCode: asciiField(bytes, GAME_CODE.offset, GAME_CODE.length),
    makerCode: asciiField(bytes, MAKER_CODE.offset, MAKER_CODE.length),
    version: bytes[VERSION_OFFSET] ?? 0,
  };
}
