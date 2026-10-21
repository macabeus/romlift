// The C units (architecture §6.3, §6.6, roadmap 4.C, D74): the C tokenizer, the INCLUDE_ASM finder and planner, text
// edits and the reconcile codes; the assembly agbcc emits for a stub-only unit, its object paths and its ldscript
// lines; and the stub read back as the checks read it. Owned by p4-c-modules (phase 4), then by phase 6's rename and
// reconciler (phase 5 skipped, D76 g).
export type { CToken, CTokenKind } from '../core/reconcile/c-tokens.ts';
export { tokenizeC } from '../core/reconcile/c-tokens.ts';
export type { CConditional, CDefinition, CFileScan, COther, CompiledDefinitions, CUnscannable, IncludeAsmPlan, IncludeAsmStatement, IncludeAsmWanted, StubTree, WantedChunk } from '../core/reconcile/include-asm.ts';
export { compiledDefinitions, INCLUDE_ASM_MACRO, planIncludeAsm, scanC } from '../core/reconcile/include-asm.ts';
export { applyTextEdits } from '../core/reconcile/text-edit.ts';
export { ReconcileCodes } from '../core/reconcile/codes.ts';
export type { ReconcileCode } from '../core/reconcile/codes.ts';
export type { StubChunk } from '../core/model/c-unit.ts';
export { moduleCompile, STUB_UNIT_MODE, STUB_UNIT_PRELUDE, stubAssemblyText, stubChunkFiles, stubChunks, stubUnitAssembly, stubUnitPrelude } from '../core/model/c-unit.ts';
export { cDataAssertLine, cDataSectionLine } from '../core/model/c-data-assert.ts';
export { cAssemblyPath, cObjectPath, MODULES_MK_PATH } from '../core/model/paths.ts';
export { isCSource } from '../foundation/util/project-files.ts';
export type { StubAssembly, StubInclude, StubProblem, StubReading } from '../core/verify/c-stub.ts';
export { readStub, stubAssemblyOf } from '../core/verify/c-stub.ts';
export { cStubText } from '../core/emit/writers/c-stub.ts';
export { modulesMkText } from '../core/emit/writers/modules-mk.ts';
