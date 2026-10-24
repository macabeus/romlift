// The `objdiff` writer (architecture §6.1 rung 3, §6.3, §6.8, D92): objdiff.json, the project file of objdiff-cli
// (pinned at bench/tools/objdiff.version, 3.7.2; the field names are its config.schema.json's). Scope: global; ownership
// generated. One unit per generated `c` module (a C unit, its source src/<module>.c), in ROM order: its target is
// expected/<module>.o (`make expected`, the expected writer's source assembled) and its base build/src/<module>.o (the
// C object `make` builds, D74 f). An asm or data module has an expected/ file too (g6.expected-bytes judges every
// module), but no unit: nothing in it is decompiled, and its base, the same disassembly, would only show objdiff's
// reading of the relocations `as` leaves in it (an ARM `b` to a global label reads as another branch destination). `build_base` lets
// objdiff run `make build/src/<module>.o` before it diffs; `build_target` is false, since the target is `make
// expected`'s. The target is the ROM's bytes with no relocation (the expected writer), so `options` sets objdiff's
// `functionRelocDiffs` to `none`, which matches a constant or a branch destination of the target with a relocation of
// the base, as `objdiff-cli report` always does; without it the objdiff window would mark every call and pool word of
// a decompiled function as a difference. The text is deterministic: the key order written below, two-space indent, a
// final newline.
import type { Rom } from '../../../foundation/rom/rom.ts';
import { isCSource } from '../../../foundation/util/project-files.ts';
import { buildUnits, expectedObjectPath, hasExpectedTarget, OBJDIFF_JSON_PATH } from '../../model/paths.ts';
import type { Model } from '../../model/types.ts';
import type { FileEntry, Writer } from '../tree.ts';

/** The `$schema` objdiff's configuration names (its README). */
export const OBJDIFF_SCHEMA_URL = 'https://raw.githubusercontent.com/encounter/objdiff/main/config.schema.json';

/** One unit of objdiff.json. */
export interface ObjdiffUnit {
  readonly name: string;
  readonly target_path: string;
  readonly base_path: string;
  readonly metadata: { readonly source_path: string };
}

/** objdiff.json's content. */
export interface ObjdiffConfig {
  readonly $schema: string;
  readonly custom_make: string;
  readonly build_target: boolean;
  readonly build_base: boolean;
  readonly units: readonly ObjdiffUnit[];
  readonly options: { readonly functionRelocDiffs: 'none' };
}

/** The objdiff configuration of a model: one unit per generated C unit with an objdiff target, in ROM order. */
export function objdiffConfig(model: Pick<Model, 'modules' | 'chunks'>): ObjdiffConfig {
  const units = buildUnits({ modules: model.modules, chunks: model.chunks, labels: [] }).filter((u, i) => isCSource(u.source) && hasExpectedTarget(model.modules[i]));
  return {
    $schema: OBJDIFF_SCHEMA_URL,
    custom_make: 'make',
    build_target: false,
    build_base: true,
    units: units.map((u) => ({ name: u.module, target_path: expectedObjectPath(u.module), base_path: u.object, metadata: { source_path: u.source } })),
    options: { functionRelocDiffs: 'none' },
  };
}

/** The text of objdiff.json. */
export function objdiffText(model: Pick<Model, 'modules' | 'chunks'>): string {
  return `${JSON.stringify(objdiffConfig(model), null, 2)}\n`;
}

export const objdiffWriter: Writer = {
  id: 'objdiff',
  scope: 'global',
  emit(_rom: Rom, model: Model): Iterable<FileEntry> {
    return [{ ownership: 'generated', path: OBJDIFF_JSON_PATH, text: objdiffText(model), writer: 'objdiff' }];
  },
};
