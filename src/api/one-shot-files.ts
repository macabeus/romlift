// romlift/node's project reading and writing for the one-shot workflows (architecture §2.1, roadmap 4.D): the inputs a
// project, a write and the scaffold need, the writes of `init` and `generate`, the npm lock step, re-exported by their
// owner, p4-workflows (D74). The shell codes they raise (E_DIR_NOT_EMPTY, W_LOCKFILE_DEFERRED) are ShellCodes, which
// files.ts exports.
export {
  checkReplaced,
  packageRoot,
  packageVersion,
  readCTexts,
  readInitDir,
  readProject,
  readProjectTexts,
  readScaffoldInputs,
  readWriteState,
  resolveFrom,
} from '../shell/project/read-inputs.ts';
export type { InitDir, ReadProject, ReadProjectOptions, ReadResult, ScaffoldInputs } from '../shell/project/read-inputs.ts';
export { hasPackageLock, planAndApply, underProjectLock, writeInitProject, writeTree } from '../shell/project/write-project.ts';
export type { InitFiles, TreeSource, TreeWrite, WriteOutcome } from '../shell/project/write-project.ts';
export { NPM_LOCK_ARGS, NPM_LOCK_TIME_LIMIT_MS, writePackageLock } from '../shell/toolchain/npm.ts';
export type { NpmLockOptions, NpmLockResult } from '../shell/toolchain/npm.ts';
