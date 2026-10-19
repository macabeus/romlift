// Names (architecture §6.2, D9): the default spellings, where a function's name came from, the check that every
// configured name is a symbol name, and the check that names are unique within a module. A name may repeat in another module only when every label of that name is
// module-scoped (printed with the _local macros), as static functions repeat in real decomps; a repeated name
// one of whose labels is referenced from another module, or a name used twice inside one module, is
// E_NAME_COLLISION.
import { isModuleName, isSymbolName, MODULE_NAME_RULE, SYMBOL_NAME_RULE } from '../../foundation/asm/dialect.ts';
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { foldPath } from '../../foundation/util/fold.ts';
import { hex, hexAddr } from '../../foundation/util/hex.ts';
import { compareCodeUnits, compareNumbers } from '../../foundation/util/sorted.ts';
import type { FunctionConfig } from '../config/schema.ts';
import { ModelCodes } from './codes.ts';
import { moduleIndexAt } from './resolver.ts';
import type { Label, Module, NameSource } from './types.ts';

/** The default name of a function: sub_ and eight upper-case hex digits. */
export function functionName(addr: Addr): string {
  return `sub_${hex(addr)}`;
}

/** The default name of the bytes between functions (an orphan chunk). */
export function orphanName(addr: Addr): string {
  return `unk_${hex(addr)}`;
}

/** The default name of a local, pool or table label. */
export function localName(addr: Addr): string {
  return `_${hex(addr)}`;
}

/** The default name of a data label. */
export function dataName(addr: Addr): string {
  return `gUnk_${hex(addr)}`;
}

/** The name of the cartridge header's chunk and label. */
export const HEADER_NAME = 'rom_header';

const DEFAULT_SPELLING = /^(?:sub|unk|gUnk)?_([0-9A-F]{8})$/;

/** Whether `name` is one of romlift's default spellings (any address). */
export function isDefaultSpelling(name: string): boolean {
  return DEFAULT_SPELLING.test(name);
}

/** The address a default spelling encodes (`sub_08000100` is 0x08000100), or undefined for any other name. */
export function defaultSpellingAddress(name: string): Addr | undefined {
  const digits = DEFAULT_SPELLING.exec(name)?.[1];
  return digits === undefined ? undefined : Number.parseInt(digits, 16);
}

/** Where a listed function's name came from: a name equal to the default spelling of its entry counts as 'default'. */
export function nameSourceOf(entry: Addr, config: Pick<FunctionConfig, 'name' | 'from'>): NameSource {
  if (config.name === functionName(entry)) return { kind: 'default' };
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
  for (const name of repeated.sort(compareCodeUnits)) {
    const sorted = [...(uses.get(name) ?? [])].sort((a, b) => compareNumbers(a.addr, b.addr)).map((u) => ({ ...u, module: moduleIndexAt(modules, u.addr) }));
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
