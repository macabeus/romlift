// The module-size self-check (architecture §6.4): the items of each module's chunks add up to the module's
// span, byte for byte. It counts lengths only, so it holds even where the tiling check already failed, and
// it names every module that misses (E_MODULE_SIZE), not only the first.
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { hexAddr } from '../../foundation/util/hex.ts';
import type { Model, Module } from '../model/types.ts';
import { checkResult } from './report.ts';
import type { CheckResult } from './report.ts';
import { VerifyCodes } from './codes.ts';

/** The bytes of the items of a module's chunks (an item index outside the table counts nothing). */
function itemBytes(model: Model, module: Module): number {
  let total = 0;
  for (const chunk of model.chunks.slice(module.chunks.first, module.chunks.first + module.chunks.count)) {
    const end = Math.min(chunk.items.first + chunk.items.count, model.items.count);
    for (let i = Math.max(0, chunk.items.first); i < end; i++) total += model.items.length[i] ?? 0;
  }
  return total;
}

/** The module-size check: one E_MODULE_SIZE per module whose items do not add up to its span. */
export function checkModuleSize(model: Model): CheckResult {
  const diagnostics: Diagnostic[] = [];
  for (const module of model.modules) {
    const span = module.span.end - module.span.start;
    const bytes = itemBytes(model, module);
    if (bytes !== span) {
      diagnostics.push(
        diagnostic(
          VerifyCodes,
          'E_MODULE_SIZE',
          `module ${module.name} spans ${span} bytes (${hexAddr(module.span.start)}..${hexAddr(module.span.end)}) but its items add up to ${bytes}`,
          { addr: module.span.start, span: module.span },
        ),
      );
    }
  }
  const detail = diagnostics[0]?.message ?? `the items of each of ${model.modules.length} modules add up to its span`;
  return checkResult('module-size', diagnostics, diagnostics.length > 1 ? `${detail} (and ${diagnostics.length - 1} more modules)` : detail);
}
