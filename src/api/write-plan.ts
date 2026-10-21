export type { Manifest, WriteOp, WritePlan, WritePlanInputs } from '../core/write-plan/types.ts';
export {
  GENERATED_ROOTS,
  JOURNAL_PATH,
  LOCK_PATH,
  MANIFEST_PATH,
  ROMLIFT_DIR,
  underGeneratedRoot,
} from '../core/write-plan/types.ts';
export type { DecodedManifest } from '../core/write-plan/manifest.ts';
export { decodeManifest, encodeManifest, isProjectPath } from '../core/write-plan/manifest.ts';
export type { DecodedJournal, Journal, JournalOp } from '../core/write-plan/journal.ts';
export { decodeJournal, encodeJournal, journalOf } from '../core/write-plan/journal.ts';
export { WritePlanCodes } from '../core/write-plan/codes.ts';
export type { WritePlanCode } from '../core/write-plan/codes.ts';
export { planHasErrors, planWrites, staleEdit, UNKNOWN_ROMLIFT_VERSION } from '../core/write-plan/plan-writes.ts';
