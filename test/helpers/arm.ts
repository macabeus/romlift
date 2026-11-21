// arm`stmdb sp!, {r4, lr}`: the ARM twin of thumb`` (test/helpers/thumb.ts), same grammar and labels.
import { DEFAULT_ORIGIN, assembleSnippet, joinTemplate } from './thumb.ts';
import type { ByteBuilder } from './thumb.ts';

/** An ARM byte builder whose code starts at `origin`. */
export function armAt(origin: number): ByteBuilder {
  return (strings, ...values) => assembleSnippet('arm', joinTemplate(strings, values), origin);
}

/** arm`bx lr`: ARM bytes at 0x08000000. */
export const arm: ByteBuilder = armAt(DEFAULT_ORIGIN);
