// The compiler profiles romlift ships, by id (architecture §4.3). Only agbcc ships in release 1; a
// second profile is a new object here, and g2.second-profile proves one runs.
import { AGBCC } from './agbcc.ts';
import type { CompilerProfile, ProfileId } from './types.ts';

export const PROFILES: Readonly<Record<ProfileId, CompilerProfile>> = { agbcc: AGBCC };

/** The shipped profile with this id, or undefined. */
export function profileById(id: ProfileId): CompilerProfile | undefined {
  return Object.hasOwn(PROFILES, id) ? PROFILES[id] : undefined;
}
