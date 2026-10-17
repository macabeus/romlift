// SHA-1 and SHA-256 through node:crypto (D44): core never hashes, the shell computes and injects
// digests. Strings are hashed as UTF-8; digests are lower-case hex.
import { createHash } from 'node:crypto';

/** The SHA-1 of `data`. */
export function sha1Of(data: Uint8Array | string): string {
  return createHash('sha1').update(data).digest('hex');
}

/** The SHA-256 of `data`. */
export function sha256Of(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** The SHA-256 of the concatenated chunks, hashed incrementally (for canonical JSON streams). */
export function sha256Stream(chunks: Iterable<string | Uint8Array>): string {
  const hash = createHash('sha256');
  for (const chunk of chunks) hash.update(chunk);
  return hash.digest('hex');
}
