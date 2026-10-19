// p3-write-plan's surface through the package entry points (D37, D62): planWrites in romlift (pure,
// browser-safe), the project shell and the toolchain checks in romlift/node.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as romlift from 'romlift';
import * as node from 'romlift/node';

test('romlift exports the write policy', () => {
  for (const name of ['planWrites', 'planHasErrors', 'UNKNOWN_ROMLIFT_VERSION', 'WritePlanCodes']) assert.ok(name in romlift, name);
  assert.deepEqual(Object.keys(romlift.WritePlanCodes), ['E_PATH_NOT_OWNED', 'E_STALE_EDIT', 'W_UNOWNED_FILE']);
});

test('romlift/node exports the project shell and the toolchain checks', () => {
  const names = ['applyWrites', 'withProjectLock', 'readDiskState', 'readManifest', 'readJournal', 'readReconciledTexts', 'linkCheck', 'assembleCheck'];
  for (const name of names) assert.ok(name in node, name);
  assert.equal(node.ShellCodes.E_PROJECT_LOCKED.severity, 'error');
  assert.equal(node.ShellCodes.W_STALE_LOCK.severity, 'warning');
});
