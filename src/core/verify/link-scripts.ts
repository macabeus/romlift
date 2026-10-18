// The structural part of the text-layout check (architecture §6.4, §6.7): ldscript.txt and symbols.ld are not
// laid out to bytes but read as the lines the ldscript and symbols writers print. The linker script must link
// each build unit once, in ROM order, a runs_at unit at its run address loaded at its load address with its
// __load_ symbol, and INCLUDE symbols.ld exactly when there are symbols outside the ROM; symbols.ld must define
// each symbol outside the ROM once with the model's value, and nothing else. Failures are E_SELF_CHECK_TEXT.
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { ROM_BASE } from '../../foundation/rom/rom.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { hexAddr, parseHexAddr } from '../../foundation/util/hex.ts';
import { buildUnits, SYMBOLS_PATH } from '../model/paths.ts';
import type { Model } from '../model/types.ts';
import { textError } from './text-error.ts';

/** The text with every comment blanked, line breaks kept. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

/** The symbols outside the ROM, as symbols.ld must define them. */
export function externalSymbols(model: Model): ReadonlyMap<string, Addr> {
  const out = new Map<string, Addr>();
  for (const s of model.symbols) if ((s.addr < ROM_BASE || s.addr >= model.rom.end) && !out.has(s.name)) out.set(s.name, s.addr);
  return out;
}

interface ScriptObject {
  readonly object: string;
  readonly line: number;
  /** The section it is placed in, and whether it is the first object of it. */
  readonly section: string;
  readonly first: boolean;
  readonly vma?: Addr;
  readonly lma?: Addr;
}

const SECTION_AT = /^\.([A-Za-z0-9_.$]+)\s+(0x[0-9A-Fa-f]+)\s*:\s*AT\(\s*(0x[0-9A-Fa-f]+)\s*\)\s*\{$/;
const SECTION = /^\.([A-Za-z0-9_.$]+)\s*:\s*\{$/;
const OBJECT = /^(\S+)\(\.text\);?$/;
const LOAD_SYMBOL = /^__load_([A-Za-z0-9_.$]+)\s*=\s*LOADADDR\(\s*\.([A-Za-z0-9_.$]+)\s*\);$/;
const START = /^\.\s*=\s*(0x[0-9A-Fa-f]+)\s*;$/;
const ASSIGNMENT = /^([A-Za-z_.$][A-Za-z0-9_.$]*)\s*=\s*(0x[0-9A-Fa-f]+)\s*;$/;

export function checkLdscript(model: Model, path: string, text: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const lines = withoutComments(text).split('\n');
  const objects: ScriptObject[] = [];
  const loads = new Map<string, string>();
  let includesSymbols = false;
  let start: Addr | undefined;
  let inSections = false;
  let section: { readonly name: string; readonly vma?: Addr; readonly lma?: Addr; count: number } | undefined;
  lines.forEach((raw, i) => {
    const line = i + 1;
    const s = raw.trim();
    if (s === '') return;
    const err = (message: string): void => {
      out.push(textError(path, line, ROM_BASE, message));
    };
    if (!inSections) {
      if (s === `INCLUDE ${SYMBOLS_PATH}`) includesSymbols = true;
      else if (s === 'SECTIONS {') inSections = true;
      else err(`unexpected \`${s}\` outside SECTIONS`);
      return;
    }
    if (section !== undefined) {
      const object = OBJECT.exec(s);
      if (object !== null) {
        objects.push({
          object: object[1] ?? '',
          line,
          section: section.name,
          first: section.count === 0,
          ...(section.vma === undefined ? {} : { vma: section.vma }),
          ...(section.lma === undefined ? {} : { lma: section.lma }),
        });
        section.count++;
      } else if (s === '}') section = undefined;
      else err(`unexpected \`${s}\` inside section .${section.name}`);
      return;
    }
    const at = SECTION_AT.exec(s);
    const plain = SECTION.exec(s);
    const loadSymbol = LOAD_SYMBOL.exec(s);
    const startAt = START.exec(s);
    if (at !== null) section = { name: at[1] ?? '', vma: parseHexAddr(at[2] ?? '') ?? 0, lma: parseHexAddr(at[3] ?? '') ?? 0, count: 0 };
    else if (plain !== null) {
      if (start === undefined) err(`section .${plain[1] ?? ''} has no address and no \`. = ${hexAddr(ROM_BASE)};\` precedes it`);
      section = { name: plain[1] ?? '', count: 0 };
    } else if (loadSymbol !== null) loads.set(loadSymbol[1] ?? '', loadSymbol[2] ?? '');
    else if (startAt !== null) {
      start = parseHexAddr(startAt[1] ?? '');
      if (start !== ROM_BASE) err(`the link starts at ${startAt[1] ?? ''}, not ${hexAddr(ROM_BASE)}`);
    } else if (s === '}') inSections = false;
    else err(`unexpected \`${s}\``);
  });

  const lastLine = lines.length;
  const wantSymbols = externalSymbols(model).size > 0;
  if (wantSymbols !== includesSymbols) {
    out.push(textError(path, 1, ROM_BASE, wantSymbols ? `does not INCLUDE ${SYMBOLS_PATH}, which defines symbols the code names` : `INCLUDEs ${SYMBOLS_PATH}, which defines nothing`));
  }
  const units = buildUnits(model);
  for (let k = 0; k < Math.max(units.length, objects.length); k++) {
    const unit = units[k];
    const got = objects[k];
    const module = model.modules[k];
    if (unit === undefined || got === undefined || module === undefined || got.object !== unit.object) {
      const where = got?.line ?? lastLine;
      const addr = module?.span.start ?? model.rom.end;
      const message =
        unit === undefined
          ? `links ${got?.object ?? ''} after the last build unit`
          : got === undefined
            ? `does not link ${unit.object}, the unit of module ${unit.module}`
            : `links ${got.object} where the build unit in ROM order is ${unit.object}`;
      out.push(textError(path, where, addr, message));
      break;
    }
    const at = module.span.start;
    if (module.runAt !== undefined) {
      if (!got.first || got.vma !== module.runAt || got.lma !== at) {
        out.push(textError(path, got.line, at, `${unit.object} runs from ${hexAddr(module.runAt)} and must open its own section at ${hexAddr(module.runAt)} : AT(${hexAddr(at)})`));
      }
      if (loads.get(module.name) !== got.section) out.push(textError(path, got.line, at, `no \`__load_${module.name} = LOADADDR(.${got.section});\` names where ${unit.object} is loaded`));
    } else if (got.first && got.lma !== undefined && (got.lma !== at || got.vma !== at)) {
      out.push(textError(path, got.line, at, `section .${got.section} opens at ${hexAddr(got.vma ?? 0)} : AT(${hexAddr(got.lma)}), but ${unit.object} loads at ${hexAddr(at)}`));
    } else if (got.vma !== undefined && got.vma !== got.lma) {
      out.push(textError(path, got.line, at, `${unit.object} shares a runs_at section with another unit`));
    }
  }
  return out;
}

export function checkSymbolsFile(model: Model, path: string, text: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const want = externalSymbols(model);
  const seen = new Set<string>();
  const lines = withoutComments(text).split('\n');
  lines.forEach((raw, i) => {
    const s = raw.trim();
    if (s === '') return;
    const m = ASSIGNMENT.exec(s);
    if (m === null) {
      out.push(textError(path, i + 1, ROM_BASE, `unexpected \`${s}\`; symbols.ld holds only \`name = 0xADDR;\` lines`));
      return;
    }
    const name = m[1] ?? '';
    const value = parseHexAddr(m[2] ?? '') ?? -1;
    const expected = want.get(name);
    if (expected === undefined) out.push(textError(path, i + 1, value, `defines ${name}, which is no [symbols] entry outside the ROM`));
    else if (seen.has(name)) out.push(textError(path, i + 1, value, `defines ${name} twice`));
    else if (value !== expected) out.push(textError(path, i + 1, value, `defines ${name} as ${m[2] ?? ''}, but the model has ${hexAddr(expected)}`));
    seen.add(name);
  });
  for (const s of model.symbols) {
    if (want.get(s.name) === s.addr && !seen.has(s.name)) {
      out.push(textError(path, lines.length, s.addr, `does not define ${s.name}`));
      seen.add(s.name);
    }
  }
  return out;
}
