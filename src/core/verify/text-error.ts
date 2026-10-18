// The one diagnostic of the text-layout check (architecture §6.4): E_SELF_CHECK_TEXT with the file (`path`), the
// line (in the message) and the load address (`addr`) of the first difference, shared by text-layout.ts and
// link-scripts.ts.
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { hexAddr } from '../../foundation/util/hex.ts';
import { VerifyCodes } from './codes.ts';

export function textError(path: string, line: number, addr: Addr, message: string): Diagnostic {
  return diagnostic(VerifyCodes, 'E_SELF_CHECK_TEXT', `${path} line ${line}: ${message} (at ${hexAddr(addr)})`, { path, addr });
}
