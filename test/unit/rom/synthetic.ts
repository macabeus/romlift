// Builds synthetic cartridge images for the ROM tests: a valid header with the given fields.
import { headerComplement } from '../../../src/foundation/rom/rom.ts';

export interface SyntheticHeader {
  readonly title?: string;
  readonly gameCode?: string;
  readonly makerCode?: string;
  readonly version?: number;
  readonly size?: number;
}

function put(bytes: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
}

export function syntheticRom(header: SyntheticHeader = {}): Uint8Array {
  const bytes = new Uint8Array(header.size ?? 0x200);
  put(bytes, 0xa0, header.title ?? 'FIXTURE');
  put(bytes, 0xac, header.gameCode ?? 'AFXE');
  put(bytes, 0xb0, header.makerCode ?? '01');
  bytes[0xb2] = 0x96;
  bytes[0xbc] = header.version ?? 0;
  bytes[0xbd] = headerComplement(bytes);
  return bytes;
}
