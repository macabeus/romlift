// Identifier-only renames in a hand-written assembly source (D109): the edits `romlift rename <old> <new>` makes to the
// file a `[[modules]] source` names, which defines the module's labels the rest of the tree references by name. Every
// GNU as symbol token equal to `from` becomes `to`; a comment (`@` to the end of the line, `#` opening a line, `/* */`),
// a string, a character constant (`'c`), a number or local label reference (`1f`, `0x10`) and a longer symbol
// (`OldName`, `.LOld`, `Old.end`) are never touched. Pure; never throws.
import type { TextEdit } from './text-edit.ts';

/** A character that may start a GNU as symbol. */
function startsSymbol(c: string): boolean {
  return /[A-Za-z_.$]/.test(c);
}

/** A character that may continue a GNU as symbol (or a number, which is read the same way and never renamed). */
function continuesSymbol(c: string): boolean {
  return /[A-Za-z0-9_.$]/.test(c);
}

/** The offset just past the line that holds `i` (before its newline). */
function lineEnd(text: string, i: number): number {
  const nl = text.indexOf('\n', i);
  return nl === -1 ? text.length : nl;
}

/** Whether only spaces and tabs lie between the start of the line holding `i` and `i`. */
function opensLine(text: string, i: number): boolean {
  for (let k = i - 1; k >= 0; k--) {
    const c = text[k];
    if (c === '\n') return true;
    if (c !== ' ' && c !== '\t') return false;
  }
  return true;
}

/** The symbol tokens of `text` equal to `name`, as [start, end) offsets, in text order. */
export function asmSymbolTokens(
  text: string,
  name: string,
): readonly { readonly start: number; readonly end: number }[] {
  const out: { start: number; end: number }[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i] ?? '';
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? text.length : close + 2;
    } else if (c === '@' || (c === '#' && opensLine(text, i))) {
      i = lineEnd(text, i);
    } else if (c === '"') {
      let k = i + 1;
      while (k < text.length && text[k] !== '"' && text[k] !== '\n') k += text[k] === '\\' ? 2 : 1;
      i = k + 1;
    } else if (c === "'") {
      i += text[i + 1] === '\\' ? 3 : 2;
    } else if (continuesSymbol(c)) {
      let k = i + 1;
      while (k < text.length && continuesSymbol(text[k] ?? '')) k++;
      if (startsSymbol(c) && text.slice(i, k) === name) out.push({ start: i, end: k });
      i = k;
    } else {
      i++;
    }
  }
  return out;
}

/**
 * The edits that rename every symbol token `from` of the assembly text `text` to `to`, in text order; none when `from`
 * equals `to` or occurs only inside a comment, a string, a character constant or a longer token. Apply them with
 * applyTextEdits.
 */
export function renameAsmIdentifiers(text: string, from: string, to: string): readonly TextEdit[] {
  if (from === to || from === '') return [];
  return asmSymbolTokens(text, from).map((t) => ({
    start: t.start,
    end: t.end,
    text: to,
    reason: 'rename-identifier',
  }));
}
