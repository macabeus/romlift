// The C units (architecture §6.3, §6.6, roadmap 4.C, D74): the C tokenizer, the INCLUDE_ASM finder and planner, text
// edits and the reconcile codes; the assembly agbcc emits for a stub-only unit, its object paths and its ldscript
// lines; and the stub read back as the checks read it. Owned by p4-c-modules (phase 4), then by 5.A.
export type { CToken, CTokenKind } from '../core/reconcile/c-tokens.ts';
export { tokenizeC } from '../core/reconcile/c-tokens.ts';
export type { CDefinition, CFileScan, COther, IncludeAsmPlan, IncludeAsmStatement, IncludeAsmWanted } from '../core/reconcile/include-asm.ts';
export { INCLUDE_ASM_MACRO, includeAsmDir, planIncludeAsm, scanC } from '../core/reconcile/include-asm.ts';
export { applyTextEdits } from '../core/reconcile/text-edit.ts';
export { ReconcileCodes } from '../core/reconcile/codes.ts';
export type { ReconcileCode } from '../core/reconcile/codes.ts';
export { cDataAssertLine, cDataSectionLine, includedChunkFile, moduleCompile, STUB_UNIT_MODE, STUB_UNIT_PRELUDE, stubAssemblyText, stubChunkFiles, stubName, stubUnitAssembly } from '../core/model/c-unit.ts';
export { cAssemblyPath, cObjectPath, isCSource, MODULES_MK_PATH } from '../core/model/paths.ts';
export type { StubAssembly, StubInclude, StubProblem, StubReading } from '../core/verify/c-stub.ts';
export { readStub, stubAssemblyOf } from '../core/verify/c-stub.ts';
export { cStubText } from '../core/emit/writers/c-stub.ts';
export { modulesMkText } from '../core/emit/writers/modules-mk.ts';
