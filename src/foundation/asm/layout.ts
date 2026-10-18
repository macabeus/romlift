// Lays parsed statements (foundation/asm/statements.ts) out to bytes from an absolute start address, the
// way GNU as and ld would place them, so the text-layout self-check (architecture §6.4, D49) can prove an
// emitted file reproduces its ROM range without a toolchain.
//
// Pass 1 walks the statements (includes expanded in place through `include`) and fixes every
// statement's address and size and every local label's address: a Thumb instruction is 2 bytes, a
// Thumb `bl` pair 4, an ARM instruction 4; `.align p` pads to 2^p from the running absolute address,
// which is where ld puts a word-aligned object; a switch from Thumb to ARM state pads to a word with
// zeros, as GNU as does; an `.align` without a fill byte is accepted only where it pads nothing. Pass 2
// encodes: an instruction text through foundation/isa `parse` and `assemble` (the encoder that agrees
// with GNU as, g1.encoder-agrees), `.inst*` words, data values, `.align` fill, `.incbin` bytes.
//
// Symbols: a local label stands for its address; in a data value, a label defined in Thumb state that
// `.thumb_func` precedes or `.type name, %function` names is a Thumb function and stands for its
// address plus one, as ld writes it for `.4byte Func`. Other names go to `resolve`, which returns symbol
// VALUES (the caller adds the Thumb bit to Thumb function symbols). A branch drops the Thumb bit of its
// target, as ld does for a branch relocation; any other instruction operand takes the value as is.
// Errors are values with the line and address of the statement; nothing throws for content.
import { assemble } from '../isa/assemble.ts';
import { parse } from '../isa/parse.ts';
import { specOf } from '../isa/rows.ts';
import type { Assembled, FlowKind, SymbolResolver } from '../isa/types.ts';
import type { Addr, Mode } from '../rom/span.ts';
import { hex } from '../util/hex.ts';
import type { Expr, Statement } from './statements.ts';

export interface LayoutInput {
  readonly statements: readonly Statement[];
  /** The absolute address of the first byte (ld's placement of the object). */
  readonly start: Addr;
  /** The state the text starts in. */
  readonly mode: Mode;
  /** The value of a symbol the statements do not define, or undefined when it has none. */
  resolve(name: string): number | undefined;
  /** `length` bytes of `file` from `offset`, or undefined when they cannot be read. */
  incbin(file: string, offset: number, length: number): Uint8Array | undefined;
  /** The statements of an included file, laid out in place; absent or undefined: an unknown include. */
  include?(path: string): readonly Statement[] | undefined;
}

/** The padding one statement emitted: each `.align` (length may be 0) and each nonzero pad of a switch to ARM state. */
export interface LayoutAlign {
  readonly line: number;
  readonly at: Addr;
  readonly length: number;
}

export interface LayoutError {
  readonly line: number;
  readonly at: Addr;
  readonly message: string;
}

export interface Layout {
  readonly bytes: Uint8Array;
  /** start + bytes.length. */
  readonly end: Addr;
  /** Every local label's address (even for a Thumb function: the Thumb bit is a data-value matter). */
  readonly labels: ReadonlyMap<string, Addr>;
  readonly aligns: readonly LayoutAlign[];
  readonly errors: readonly LayoutError[];
}

/** How deep includes may nest. */
const MAX_INCLUDE_DEPTH = 16;

/**
 * Why an unfilled `.align` that pads is refused. GNU as pads it in a code section with zeros, then
 * no-ops of the state recorded in the current fragment (the state of its first instruction, not the
 * current one: binutils 2.45 pads `.arm; bx lr; .thumb; .byte 1; .align 2` with three zeros), which
 * depends on fragment boundaries this layouter does not model. romlift writes `.align p, 0` (D16).
 */
const UNFILLED_ALIGN = '`.align` without a fill byte pads with no-ops of the fragment\'s state, which the text alone does not fix; write `.align p, 0`';

/** The row flows whose target is a branch destination, so ld drops the Thumb bit of the symbol. */
const BRANCH_FLOWS: ReadonlySet<FlowKind> = new Set<FlowKind>(['branch', 'cond-branch', 'bl']);

interface LocalLabel {
  readonly addr: Addr;
  readonly mode: Mode;
  /** The first label after a `.thumb_func`. */
  readonly afterThumbFunc: boolean;
}

/** One statement at its place, after pass 1. */
interface Placed {
  readonly stmt: Statement;
  readonly at: Addr;
  readonly size: number;
  readonly mode: Mode;
  /** The message prefix naming the include chain ('' at the top level). */
  readonly where: string;
  /** Pass 1 already reported this statement; pass 2 leaves its bytes zero. */
  readonly failed: boolean;
}

interface Pass1 {
  readonly placed: readonly Placed[];
  readonly labels: ReadonlyMap<string, LocalLabel>;
  readonly functions: ReadonlySet<string>;
  readonly size: number;
}

interface Walker {
  readonly input: LayoutInput;
  readonly placed: Placed[];
  readonly labels: Map<string, LocalLabel>;
  readonly functions: Set<string>;
  readonly errors: LayoutError[];
  readonly aligns: LayoutAlign[];
  addr: Addr;
  mode: Mode;
  thumbFuncPending: boolean;
}

/** The bytes `.align power` adds at `addr`. */
function padding(addr: Addr, power: number): number {
  const unit = 2 ** power;
  return (unit - (addr % unit)) % unit;
}

/** The byte size of an instruction text in `mode` at `addr`, or undefined when no row reads it. */
function insnSize(text: string, mode: Mode, addr: Addr): number | undefined {
  // Labels are not all placed yet: any name reads as an address, which fixes the row and so the size.
  const sizing: SymbolResolver = { labelFor: () => undefined, addressOf: () => addr };
  const parsed = parse(text, mode, addr, sizing);
  if (parsed === undefined) return undefined;
  return Math.max(...parsed.candidates.map((c) => specOf(c.specId).size));
}

/** Whether `addr` is aligned for an instruction of `mode`. */
function insnAligned(mode: Mode, addr: Addr): boolean {
  return addr % (mode === 'arm' ? 4 : 2) === 0;
}

/** Why an `.inst` directive cannot stand in `mode`, or undefined when it can. */
function instRefusal(directive: string, mode: Mode): string | undefined {
  if (mode === 'arm' && directive !== '.inst') return `\`${directive}\` in ARM state (width suffixes are Thumb only)`;
  if (mode === 'thumb' && directive === '.inst') return '`.inst` without a width suffix in Thumb state (romlift writes `.inst.n` or `.inst.w`)';
  return undefined;
}

/** Pass 1 for one statement: its size, its effect on the state, and its label. */
function place(w: Walker, stmt: Statement, where: string, depth: number, stack: readonly string[]): void {
  const at = w.addr;
  let size = 0;
  let failed = false;
  const fail = (message: string): void => {
    w.errors.push({ line: stmt.line, at, message: `${where}${message}` });
    failed = true;
  };
  switch (stmt.kind) {
    case 'label':
      if (w.labels.has(stmt.name)) fail(`symbol \`${stmt.name}\` is already defined`);
      else w.labels.set(stmt.name, { addr: at, mode: w.mode, afterThumbFunc: w.thumbFuncPending });
      w.thumbFuncPending = false;
      break;
    case 'mode':
      if (stmt.mode === 'arm' && w.mode === 'thumb') {
        size = padding(at, 2);
        if (size > 0) w.aligns.push({ line: stmt.line, at, length: size });
      }
      w.mode = stmt.mode;
      break;
    case 'symbol':
      if (stmt.directive === '.thumb_func') {
        w.mode = 'thumb';
        w.thumbFuncPending = true;
      } else if (stmt.directive === '.type' && stmt.args[1] === '%function' && stmt.args[0] !== undefined) {
        w.functions.add(stmt.args[0]);
      }
      break;
    case 'align':
      size = padding(at, stmt.power);
      w.aligns.push({ line: stmt.line, at, length: size });
      if (size > 0 && stmt.fill === undefined) fail(UNFILLED_ALIGN);
      break;
    case 'data':
      size = stmt.width * stmt.values.length;
      break;
    case 'inst': {
      size = stmt.width;
      const refusal = instRefusal(stmt.directive, w.mode);
      if (refusal !== undefined) fail(refusal);
      else if (!insnAligned(w.mode, at)) fail(`\`${stmt.directive}\` at an address not aligned for ${w.mode} state`);
      break;
    }
    case 'insn': {
      const found = insnSize(stmt.text, w.mode, at);
      size = found ?? (w.mode === 'arm' ? 4 : 2);
      if (found === undefined) fail(`unparsable ${w.mode} instruction \`${stmt.text}\``);
      else if (!insnAligned(w.mode, at)) fail(`${w.mode} instruction at an unaligned address`);
      break;
    }
    case 'incbin':
      size = stmt.length;
      break;
    case 'include':
      includeAt(w, stmt, where, depth, stack);
      return;
  }
  w.placed.push({ stmt, at, size, mode: w.mode, where, failed });
  w.addr = at + size;
}

/** Pass 1 for an include statement: the included statements in place. */
function includeAt(w: Walker, stmt: Statement & { readonly kind: 'include' }, where: string, depth: number, stack: readonly string[]): void {
  const report = (message: string): void => {
    w.errors.push({ line: stmt.line, at: w.addr, message: `${where}${message}` });
  };
  if (stack.includes(stmt.path)) return report(`include cycle through "${stmt.path}"`);
  if (depth >= MAX_INCLUDE_DEPTH) return report(`includes nest deeper than ${MAX_INCLUDE_DEPTH}`);
  const statements = w.input.include?.(stmt.path);
  if (statements === undefined) return report(`unknown include "${stmt.path}"`);
  const inner = `in "${stmt.path}": `;
  for (const s of statements) place(w, s, inner, depth + 1, [...stack, stmt.path]);
}

function pass1(input: LayoutInput, errors: LayoutError[], aligns: LayoutAlign[]): Pass1 {
  const w: Walker = {
    input,
    placed: [],
    labels: new Map(),
    functions: new Set(),
    errors,
    aligns,
    addr: input.start,
    mode: input.mode,
    thumbFuncPending: false,
  };
  for (const stmt of input.statements) place(w, stmt, '', 0, []);
  return { placed: w.placed, labels: w.labels, functions: w.functions, size: w.addr - input.start };
}

/** Writes `size` bytes of `value` little-endian at `offset`. */
function writeLE(bytes: Uint8Array, offset: number, value: number, size: number): void {
  for (let i = 0; i < size; i++) bytes[offset + i] = Math.floor(value / 2 ** (8 * i)) & 0xff;
}

/** The symbol context of pass 2: local labels first, then the caller's values. */
class Symbols {
  readonly #input: LayoutInput;
  readonly #labels: ReadonlyMap<string, LocalLabel>;
  readonly #functions: ReadonlySet<string>;

  constructor(input: LayoutInput, pass: Pass1) {
    this.#input = input;
    this.#labels = pass.labels;
    this.#functions = pass.functions;
  }

  local(name: string): LocalLabel | undefined {
    return this.#labels.get(name);
  }

  /** Whether a local label is a Thumb function (its data value carries the Thumb bit). */
  isThumbFunction(name: string): boolean {
    const label = this.#labels.get(name);
    return label !== undefined && label.mode === 'thumb' && (label.afterThumbFunc || this.#functions.has(name));
  }

  /** Whether a local label is an ARM function. */
  isArmFunction(name: string): boolean {
    const label = this.#labels.get(name);
    return label !== undefined && label.mode === 'arm' && this.#functions.has(name);
  }

  /** The caller's value of a name the statements do not define. */
  external(name: string): number | undefined {
    const value = this.#input.resolve(name);
    return value !== undefined && Number.isInteger(value) ? value : undefined;
  }

  /** The value of `name` in a data value: a Thumb function label carries the Thumb bit. */
  dataValue(name: string): number | undefined {
    const label = this.#labels.get(name);
    if (label === undefined) return this.external(name);
    return label.addr + (this.isThumbFunction(name) ? 1 : 0);
  }
}

/** What one instruction text encoding attempt consulted. */
interface Lookups {
  readonly missing: string[];
  readonly odd: string[];
  readonly locals: string[];
}

/** One parse-and-assemble of an instruction; `dropThumbBit` clears bit 0 of odd external values. */
function attempt(text: string, p: Placed, symbols: Symbols, dropThumbBit: boolean): { readonly lookups: Lookups; readonly parsed: boolean; readonly assembled: Assembled | undefined } {
  const lookups: Lookups = { missing: [], odd: [], locals: [] };
  const resolver: SymbolResolver = {
    labelFor: () => undefined,
    addressOf: (name) => {
      const local = symbols.local(name);
      if (local !== undefined) {
        lookups.locals.push(name);
        return local.addr;
      }
      const value = symbols.external(name);
      if (value === undefined) lookups.missing.push(name);
      else if (value % 2 !== 0) {
        lookups.odd.push(name);
        return dropThumbBit ? value - 1 : value;
      }
      return value;
    },
  };
  const parsed = parse(text, p.mode, p.at, resolver);
  return { lookups, parsed: parsed !== undefined, assembled: parsed === undefined ? undefined : assemble(parsed, p.at) };
}

/** Why a branch cannot be linked without an interworking veneer, or undefined. */
function veneerReason(mode: Mode, lookups: Lookups, symbols: Symbols): string | undefined {
  const names = [...lookups.locals, ...lookups.odd];
  if (mode === 'arm') {
    const thumb = names.find((n) => lookups.odd.includes(n) || symbols.isThumbFunction(n));
    return thumb === undefined ? undefined : `an ARM branch to the Thumb function \`${thumb}\` needs an interworking veneer`;
  }
  const arm = lookups.locals.find((n) => symbols.isArmFunction(n));
  return arm === undefined ? undefined : `a Thumb branch to the ARM function \`${arm}\` needs an interworking veneer`;
}

/** Pass 2 for an instruction text: the word, or an error message. */
function encodeInsn(text: string, p: Placed, symbols: Symbols): { readonly word: number } | string {
  let result = attempt(text, p, symbols, false);
  if (!result.parsed) {
    const missing = result.lookups.missing;
    return missing.length > 0 ? `undefined symbol \`${missing.join('`, `')}\`` : `unparsable ${p.mode} instruction \`${text}\``;
  }
  let dropped = false;
  if (result.assembled === undefined && result.lookups.odd.length > 0) {
    const retry = attempt(text, p, symbols, true);
    if (retry.assembled !== undefined && BRANCH_FLOWS.has(specOf(retry.assembled.specId).flow)) {
      result = retry;
      dropped = true;
    }
  }
  const assembled = result.assembled;
  if (assembled === undefined) return `cannot encode \`${text}\` at 0x${hex(p.at)} (operand out of range or unencodable)`;
  if (assembled.size !== p.size) return `\`${text}\` encodes to ${assembled.size} bytes, not the ${p.size} pass 1 placed`;
  if (dropped || BRANCH_FLOWS.has(specOf(assembled.specId).flow)) {
    const reason = veneerReason(p.mode, result.lookups, symbols);
    if (reason !== undefined) return reason;
  }
  return { word: assembled.word };
}

/** The value of a data expression, or an error message. */
function exprValue(expr: Expr, symbols: Symbols): number | string {
  if (expr.kind === 'number') return expr.value;
  const value = symbols.dataValue(expr.name);
  return value === undefined ? `undefined symbol \`${expr.name}\`` : value + expr.addend;
}

/** Pass 2 for one placed statement: writes its bytes, or returns an error message. */
function emit(p: Placed, symbols: Symbols, input: LayoutInput, bytes: Uint8Array): string | undefined {
  const offset = p.at - input.start;
  const stmt = p.stmt;
  switch (stmt.kind) {
    case 'insn': {
      const encoded = encodeInsn(stmt.text, p, symbols);
      if (typeof encoded === 'string') return encoded;
      writeLE(bytes, offset, encoded.word, p.size);
      return undefined;
    }
    case 'inst':
      writeLE(bytes, offset, stmt.word, stmt.width);
      return undefined;
    case 'data': {
      const bits = 8 * stmt.width;
      for (let i = 0; i < stmt.values.length; i++) {
        const expr = stmt.values[i];
        if (expr === undefined) continue;
        const value = exprValue(expr, symbols);
        if (typeof value === 'string') return value;
        if (value < -(2 ** (bits - 1)) || value >= 2 ** bits) return `value ${value} does not fit ${stmt.width} byte(s)`;
        writeLE(bytes, offset + i * stmt.width, value < 0 ? value + 2 ** bits : value, stmt.width);
      }
      return undefined;
    }
    case 'align':
      // Pass 1 refused an unfilled `.align` that pads, so only a filled one has bytes to write.
      if (stmt.fill !== undefined) bytes.fill(stmt.fill, offset, offset + p.size);
      return undefined;
    case 'incbin': {
      const data = input.incbin(stmt.file, stmt.offset, stmt.length);
      if (data === undefined) return `cannot read ${stmt.length} bytes of "${stmt.file}" at 0x${stmt.offset.toString(16)}`;
      if (data.length !== stmt.length) return `"${stmt.file}" gave ${data.length} bytes at 0x${stmt.offset.toString(16)}, not ${stmt.length}`;
      bytes.set(data, offset);
      return undefined;
    }
    case 'label':
    case 'mode':
    case 'symbol':
    case 'include':
      // A mode switch's pad is zero, which the buffer already holds; includes were expanded in pass 1.
      return undefined;
  }
}

/** Lays statements out from `start`: the bytes, every local label, the padding emitted and the errors. */
export function layoutStatements(input: LayoutInput): Layout {
  const errors: LayoutError[] = [];
  const aligns: LayoutAlign[] = [];
  const pass = pass1(input, errors, aligns);
  const bytes = new Uint8Array(pass.size);
  const symbols = new Symbols(input, pass);
  for (const p of pass.placed) {
    if (p.failed) continue;
    const message = emit(p, symbols, input, bytes);
    if (message !== undefined) errors.push({ line: p.stmt.line, at: p.at, message: `${p.where}${message}` });
  }
  const labels = new Map<string, Addr>();
  for (const [name, label] of pass.labels) labels.set(name, label.addr);
  return { bytes, end: input.start + pass.size, labels, aligns, errors };
}
