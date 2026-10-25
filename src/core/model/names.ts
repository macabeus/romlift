// Names (architecture §6.2, D9): where a function's name came from (the default spellings and their parser are
// foundation/util/project-files.ts's), the check that every
// configured name is a symbol name, and the check that names are unique within a module. A name may repeat in another module only when every label of that name is
// module-scoped (printed with the _local macros), as static functions repeat in real decomps; a repeated name
// one of whose labels is referenced from another module, or a name used twice inside one module, is
// E_NAME_COLLISION.
import { isModuleName, isSymbolName, MODULE_NAME_RULE, SYMBOL_NAME_RULE } from '../../foundation/asm/dialect.ts';
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { foldPath } from '../../foundation/util/fold.ts';
import { hexAddr } from '../../foundation/util/hex.ts';
import { defaultFunctionName } from '../../foundation/util/project-files.ts';
import { compareCodeUnits, compareNumbers } from '../../foundation/util/sorted.ts';
import type { FunctionConfig } from '../config/schema.ts';
import { ModelCodes } from './codes.ts';
import { cDataName, cRodataName } from './c-data-assert.ts';
import { loadSymbolOf, moduleIndexAt, relocatedModules, ROM_SECTION, runSectionOf } from './modules.ts';
import type { Label, Module, NameSource } from './types.ts';

/** The name of the cartridge header's chunk and label. */
export const HEADER_NAME = 'rom_header';

/** Where a listed function's name came from: a name equal to the default spelling of its entry counts as 'default'. */
export function nameSourceOf(entry: Addr, config: Pick<FunctionConfig, 'name' | 'from'>): NameSource {
  if (config.name === defaultFunctionName(entry)) return { kind: 'default' };
  return config.from === undefined ? { kind: 'toml' } : { kind: 'toml', from: config.from };
}

/** A name a module defines: a label, or a function's alias (which takes its function's address and scope). */
export interface DefinedName {
  readonly name: string;
  readonly addr: Addr;
  readonly scope: Label['scope'];
}

interface Use {
  readonly addr: Addr;
  readonly scope: Label['scope'];
}

function moduleName(modules: readonly Module[], i: number): string {
  return modules[i]?.name ?? '(no module)';
}

/** E_NAME_COLLISION for every name used at two addresses of one module, or in two modules with one use global. */
export function nameCollisions(names: readonly DefinedName[], modules: readonly Module[]): Diagnostic[] {
  const uses = new Map<string, Use[]>();
  const repeated: string[] = [];
  for (const n of names) {
    const list = uses.get(n.name);
    if (list === undefined) {
      uses.set(n.name, [{ addr: n.addr, scope: n.scope }]);
      continue;
    }
    const at = list.findIndex((u) => u.addr === n.addr);
    if (at < 0) {
      list.push({ addr: n.addr, scope: n.scope });
      if (list.length === 2) repeated.push(n.name);
    } else if (n.scope === 'global') {
      list[at] = { addr: n.addr, scope: 'global' };
    }
  }
  const out: Diagnostic[] = [];
  const relocated = relocatedModules(modules);
  for (const name of repeated.sort(compareCodeUnits)) {
    const sorted = [...(uses.get(name) ?? [])].sort((a, b) => compareNumbers(a.addr, b.addr)).map((u) => ({ ...u, module: moduleIndexAt(modules, u.addr, relocated) }));
    const sameModule = sorted.some((u, i) => sorted.some((v, j) => j > i && v.module === u.module));
    const crossGlobal = sorted.some((u, i) => sorted.some((v, j) => j > i && v.module !== u.module && (u.scope === 'global' || v.scope === 'global')));
    if (!sameModule && !crossGlobal) continue;
    const where = sorted.map((u) => `${hexAddr(u.addr)} (${moduleName(modules, u.module)}${u.scope === 'global' ? ', global' : ''})`).join(', ');
    const why = sameModule ? 'twice in one module' : 'in two modules, one of them referenced from another module';
    out.push(diagnostic(ModelCodes, 'E_NAME_COLLISION', `the name ${name} is used ${why}: ${where}`, { addr: sorted[0]?.addr ?? 0, cites: sorted.slice(0, 4).map((u) => u.addr) }));
  }
  return out;
}

/**
 * E_NAME_COLLISION for every name of `names` (the config's functions, aliases and symbols, and the model's labels) that
 * the linker script defines: a runs_at module's `__load_<module>` (§6.7). ld lets the script's assignment override the
 * label, so the tree would link to other bytes; `generate` refuses it here, and `rename` refuses it as a model name
 * (correctness-r1-2). Once per name, by name.
 */
export function linkerNameCollisions(names: readonly { readonly name: string; readonly addr: Addr }[], modules: readonly Module[]): Diagnostic[] {
  const reserved = new Map(relocatedModules(modules).map((m) => [loadSymbolOf(m), m] as const));
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const n of [...names].sort((a, b) => compareCodeUnits(a.name, b.name) || compareNumbers(a.addr, b.addr))) {
    const module = reserved.get(n.name);
    if (module === undefined || seen.has(n.name)) continue;
    seen.add(n.name);
    out.push(diagnostic(ModelCodes, 'E_NAME_COLLISION', `the name ${n.name} at ${hexAddr(n.addr)} is the symbol ldscript.txt defines as the load address of runs_at module ${module.name} (${n.name} = LOADADDR(.${module.name}))`, { addr: n.addr, cites: [module.span.start] }));
  }
  return out;
}

/**
 * E_NAME_COLLISION for every runs_at module whose output section (modules.ts runSectionOf, `.<module>`) is another
 * section ldscript.txt emits: the ROM's `.text`, a `c` module's check section `.c_data_<m>` or a data range's
 * `.rodata_<m>` (c-data-assert.ts). ld would put both into one output section, so `__load_<module>` would name the
 * other section's load address and the tree would link to other bytes, or the script would not parse
 * (correctness-r2-1). A module name holds no `.`, so no `.text.<module>` section can be one. In ROM order.
 */
export function sectionNameCollisions(modules: readonly Pick<Module, 'name' | 'kind' | 'span' | 'runAt' | 'dataRange'>[]): Diagnostic[] {
  const reserved = new Map<string, string>([[ROM_SECTION, 'the section of the ROM\'s first units']]);
  for (const m of modules) {
    if (m.kind !== 'c') continue;
    reserved.set(cDataName(m.name), `the data check section of c module ${m.name}`);
    if (m.dataRange !== undefined) reserved.set(cRodataName(m.name), `the data range section of c module ${m.name}`);
  }
  const out: Diagnostic[] = [];
  for (const m of modules) {
    if (m.runAt === undefined) continue;
    const section = runSectionOf(m);
    const other = reserved.get(section);
    if (other === undefined) continue;
    out.push(diagnostic(ModelCodes, 'E_NAME_COLLISION', `the runs_at module ${m.name} at ${hexAddr(m.span.start)} would be ldscript.txt's section ${section}, which is ${other}; rename the module`, { addr: m.span.start }));
  }
  return out;
}

/**
 * E_NAME_INVALID for every name the config gives (a function, an alias, a symbol) that is no symbol name a file
 * may define (dialect.ts isSymbolName): GNU as reads `$d` as a mapping symbol and `.text` as a section, so the
 * tree would link to other bytes or not assemble. Once per name and address, by address.
 */
export function invalidNames(names: readonly { readonly name: string; readonly addr: Addr }[]): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const n of [...names].sort((a, b) => compareNumbers(a.addr, b.addr) || compareCodeUnits(a.name, b.name))) {
    const key = `${String(n.addr)}:${n.name}`;
    if (isSymbolName(n.name) || seen.has(key)) continue;
    seen.add(key);
    out.push(diagnostic(ModelCodes, 'E_NAME_INVALID', `the name ${JSON.stringify(n.name)} at ${hexAddr(n.addr)} is not a symbol name (${SYMBOL_NAME_RULE})`, { addr: n.addr }));
  }
  return out;
}

/**
 * E_NAME_INVALID for every module whose name is no module name (dialect.ts isModuleName): a module name is a path
 * component and an object name, so `../x`, `a/b`, `.hidden` or an empty name would write outside the tree or not
 * link. E_MODULE_NAME_DUPLICATE for every module whose name equals, or folds on a case-insensitive file system to,
 * an earlier module's, whatever the two kinds: both would build `build/<name>.o`, which the linker script would
 * name twice. In ROM order.
 */
export function moduleNameProblems(modules: readonly Pick<Module, 'name' | 'span'>[]): Diagnostic[] {
  const seen = new Map<string, Pick<Module, 'name' | 'span'>>();
  const out: Diagnostic[] = [];
  for (const m of modules) {
    if (!isModuleName(m.name)) {
      out.push(diagnostic(ModelCodes, 'E_NAME_INVALID', `the module name ${JSON.stringify(m.name)} at ${hexAddr(m.span.start)} is not a module name (${MODULE_NAME_RULE})`, { addr: m.span.start }));
      continue;
    }
    const first = seen.get(foldPath(m.name));
    if (first === undefined) {
      seen.set(foldPath(m.name), m);
      continue;
    }
    const same = first.name === m.name ? `the name ${m.name}` : `the names ${first.name} and ${m.name}, one on a case-insensitive file system`;
    out.push(
      diagnostic(ModelCodes, 'E_MODULE_NAME_DUPLICATE', `the modules at ${hexAddr(first.span.start)} and ${hexAddr(m.span.start)} share ${same}, so both build build/${m.name}.o`, {
        addr: m.span.start,
        cites: [first.span.start],
      }),
    );
  }
  return out;
}
