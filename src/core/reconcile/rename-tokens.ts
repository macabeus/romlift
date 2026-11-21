// Identifier-only renames (architecture §6.6, roadmap 6.E, D92): the C edits of `romlift rename <old> <new>`. Every
// identifier token of a C text equal to `from` becomes `to`, read with the one C tokenizer (c-tokens.ts), so a comment,
// a string literal, a character literal, a pp-number (`1Old`) and a longer identifier (`OldName`, `pOld`) are never
// touched: no regex runs over code.
//
// A preprocessor line is one token of the tokenizer; its body is tokenized again, from just past its `#`, so the
// identifiers of `#define X Old`, `#ifdef Old` or `#undef Old` are renamed like those of code, while the comments and
// literals inside it stay as they are. Two kinds of directive body are text, not code, and are left alone: the
// header name of `#include <Old.h>` (`#include_next`, `#import` too; a quoted one is a string anyway), and the message
// of `#error` and `#warning`. Pure; never throws.
import { directiveOf, tokenizeC } from './c-tokens.ts';
import type { CToken } from './c-tokens.ts';
import type { TextEdit } from './text-edit.ts';

/** The directives whose `<…>` operand is a header name, not tokens of code. */
const HEADER_DIRECTIVES: ReadonlySet<string> = new Set(['include', 'include_next', 'import']);

/** The directives whose body is a message. */
const MESSAGE_DIRECTIVES: ReadonlySet<string> = new Set(['error', 'warning']);

/** The tokens of a directive's body to read as code: its tokens after the name (c-tokens.ts directiveOf), at their offsets in the whole text. */
function directiveTokens(directive: CToken): readonly CToken[] {
  const { name, body } = directiveOf(directive);
  if (MESSAGE_DIRECTIVES.has(name)) return [];
  if (HEADER_DIRECTIVES.has(name) && body[0]?.text === '<') return [];
  return body;
}

/** Every identifier token of `text` equal to `name`, directive bodies included, in text order. */
export function identifierTokens(text: string, name: string): readonly CToken[] {
  const out: CToken[] = [];
  for (const token of tokenizeC(text)) {
    if (token.kind === 'identifier' && token.text === name) out.push(token);
    else if (token.kind === 'preprocessor')
      for (const inner of directiveTokens(token))
        if (inner.kind === 'identifier' && inner.text === name) out.push(inner);
  }
  return out;
}

/**
 * The edits that rename every identifier token `from` of `text` to `to` (directive bodies included, but for a header
 * name and an #error or #warning message), in text order; none when `from` equals `to` or occurs only inside a
 * comment, a literal or a longer token. Apply them with applyTextEdits.
 */
export function renameIdentifiers(text: string, from: string, to: string): readonly TextEdit[] {
  if (from === to || from === '') return [];
  return identifierTokens(text, from).map((t) => ({
    start: t.start,
    end: t.end,
    text: to,
    reason: 'rename-identifier',
  }));
}
