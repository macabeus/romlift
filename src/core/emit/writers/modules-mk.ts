// The `modules-mk` writer (architecture §6.3, §6.5, D47, D74 f): modules.mk, which the scaffold's Makefile includes.
// Scope: global; ownership generated. It holds exactly the frozen variables:
//
//   ROMLIFT_TOML_SHA1 := <romlift.toml's SHA-1>                in a project only (EmitContext.configSha1, D82)
//   OBJS := <every build unit's object, in link order>       (core/model/paths.ts buildUnits)
//   C_OBJS := <the C units' objects, in link order>           (build/src/<module>.o)
//   EXPECTED_OBJS := <each generated module's objdiff target, in link order>  (build/expected/<module>.o, `make expected`; D92, D101 c)
//   build/src/<module>.o: CC1 := <the module's compiler's cc1>              per C module, in link order
//   build/src/<module>.o: CFLAGS := <its default flags, then the module's cflags>
//   SOURCE_build/<module>.o := <its source>                                  per module with a hand-written source (D109),
//   asm/<module>.s: ;                                                        in link order: the source the Makefile's
//   build/<module>.o: <its source>                                           stale check reads, the generated source an old
//   	<the asm unit's recipe>                                               dependency list may name, and an explicit rule
//                                                                            that wins over the asm/%.s and data/%.s patterns
//
// The compiler is the module's (`[[modules]] compiler`, default `[build] compiler`, resolved on the Model) and its cc1
// comes from core/config/compilers.ts BUILD_COMPILERS (core/model/c-unit.ts moduleCompile); the flags are the Model's
// (core/model/modules.ts): the compiler's defaults, then the module's `cflags`, so a later flag wins as cc1 reads them. A list spans lines with `\` continuations, one object per line. The
// target-specific lines name each object in full, so the per-compiler pattern rule of mk/<id>.mk reads `$(CC1)` and
// `$(CFLAGS)` of the object it builds; an explicit rule the user adds for one object still wins (D47).
import type { Rom } from '../../../foundation/rom/rom.ts';
import { isCSource } from '../../../foundation/util/project-files.ts';
import { moduleCompile } from '../../model/c-unit.ts';
import { MODULES_MK_PATH, buildUnits, expectedObjectPath, hasExpectedTarget } from '../../model/paths.ts';
import type { Model } from '../../model/types.ts';
import type { EmitContext, FileEntry, Writer } from '../tree.ts';

/** The make variable of modules.mk that records romlift.toml's SHA-1; the scaffold's Makefile and setup.sh read it. */
export const CONFIG_SHA1_VARIABLE = 'ROMLIFT_TOML_SHA1';

/** `name := a b c` as make lines, one value per continued line. */
function listVariable(name: string, values: readonly string[]): string {
  if (values.length === 0) return `${name} :=\n`;
  return `${name} := \\\n${values.map((v, i) => `\t${v}${i < values.length - 1 ? ' \\' : ''}\n`).join('')}`;
}

/**
 * The rule of a module built from its hand-written source (D109): the Makefile's asm-unit recipe, with the source as
 * its prerequisite, and SOURCE_<object>, which the Makefile's stale check reads (OBJ_SOURCE). The rule lives here, not
 * in the Makefile, so a project whose Makefile init wrote before the key existed builds it too. `asm/<module>.s: ;`
 * lets make pass over the generated source a build before the key named (its object's dependency list still does, and
 * generate deleted it), as the Makefile does for a removed chunk file.
 */
function handWrittenRule(module: string, object: string, source: string): string {
  return (
    [
      `SOURCE_${object} := ${source}`,
      `asm/${module}.s: ;`,
      `${object}: ${source}`,
      '\t@mkdir -p $(@D)',
      '\t$(AS) $(ASFLAGS) --MD $(@:.o=.d) -o $@ $<',
      '\t@$(call OBJ_SUM,$@,$<) > $(@:.o=.sum)',
    ].join('\n') + '\n'
  );
}

/**
 * The warning a restored INCLUDE_ASM gets (D111): a function the C defined has its chunk file under asm/matchings/ (D92),
 * so a stub put back by hand names an asm/nonmatchings/ file that is gone, and the assembler fails on it. make reads the
 * C sources' INCLUDE_ASM lines (a line of its own, as the reconciler writes them) and warns, before building, for each
 * one whose file is missing while its asm/matchings twin exists, naming the command that writes it back. A warning, not
 * an error: a stub inside `#if 0` names such a file harmlessly. It lives here, not in the Makefile, so every project
 * gets it at its next `generate`.
 */
function restoredStubWarning(sources: readonly string[]): string {
  if (sources.length === 0) return '';
  const files = `$(shell sed -n 's|^[[:space:]]*INCLUDE_ASM("\\([^"]*\\)",[[:space:]]*\\([A-Za-z0-9_]*\\)).*|\\1/\\2.s|p' ${sources.join(' ')} 2>/dev/null)`;
  return (
    [
      '# A stub put back by hand for a function the C defined: its file is under asm/matchings/ until generate runs (D111).',
      `ROMLIFT_RESTORED := $(strip $(foreach f,${files},$(if $(wildcard $(f)),,$(if $(wildcard $(subst asm/nonmatchings/,asm/matchings/,$(f))),$(f)))))`,
      'ifneq ($(ROMLIFT_RESTORED),)',
      '$(warning INCLUDE_ASM names $(ROMLIFT_RESTORED), which generate moved to asm/matchings/ when the C defined the function: run $(or $(ROMLIFT_RUN),npx romlift) generate to write it back)',
      'endif',
    ].join('\n') + '\n'
  );
}

/**
 * The text of modules.mk; `configSha1`, in a project, the SHA-1 of the romlift.toml it is generated from, which the
 * scaffold's Makefile compares with the file's (fix round 6, correctness-b1-1: a pull that changed the TOML leaves
 * a stale tree, which make then refuses with the command that regenerates it).
 */
export function modulesMkText(model: Pick<Model, 'modules' | 'chunks'>, configSha1?: string): string {
  // The units' objects and compilers only: a data range's labels (BuildUnit.data) are no make variable.
  const units = buildUnits({ modules: model.modules, chunks: model.chunks, labels: [] });
  const cUnits = units.flatMap((unit, i) => {
    const module = model.modules[i];
    return module !== undefined && isCSource(unit.source) ? [{ unit, module }] : [];
  });
  const parts = [
    `# ${MODULES_MK_PATH}: the build units in link order and each C unit's compiler, generated by romlift.\n`,
    ...(configSha1 === undefined ? [] : [`${CONFIG_SHA1_VARIABLE} := ${configSha1}\n`]),
    listVariable(
      'OBJS',
      units.map((u) => u.object),
    ),
    listVariable(
      'C_OBJS',
      cUnits.map((c) => c.unit.object),
    ),
    listVariable(
      'EXPECTED_OBJS',
      model.modules.filter(hasExpectedTarget).map((m) => expectedObjectPath(m.name)),
    ),
    ...cUnits.map(({ unit, module }) => {
      const { cc1, flags } = moduleCompile(module);
      return `${unit.object}: CC1 := ${cc1}\n${unit.object}: CFLAGS :=${flags.map((f) => ` ${f}`).join('')}\n`;
    }),
    ...model.modules.flatMap((m, i) => {
      const unit = units[i];
      return m.source === undefined || unit === undefined ? [] : [handWrittenRule(m.name, unit.object, m.source)];
    }),
    restoredStubWarning(cUnits.map((c) => c.unit.source)),
  ];
  return parts.join('');
}

export const modulesMkWriter: Writer = {
  id: 'modules-mk',
  scope: 'global',
  emit(_rom: Rom, model: Model, cx: EmitContext): Iterable<FileEntry> {
    return [
      {
        ownership: 'generated',
        path: MODULES_MK_PATH,
        text: modulesMkText(model, cx.configSha1),
        writer: 'modules-mk',
      },
    ];
  },
};
