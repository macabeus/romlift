// Canonical JSON as a stream of string chunks (architecture §9.4, D19): object keys sorted by UTF-16
// code unit, undefined members omitted, no whitespace, strings escaped by JSON.stringify. The value is
// walked with an explicit stack, so depth is not limited by the call stack, and output is yielded in
// chunks of about `chunkSize` characters, so no artifact is ever built as one string.
import { RomliftInvariantError } from '../diagnostics/diagnostic.ts';
import { compareCodeUnits } from '../util/sorted.ts';
import type { JsonValue } from './types.ts';

/** The default chunk length, in UTF-16 code units. */
export const CANONICAL_JSON_CHUNK = 64 * 1024;

type JsonObject = { readonly [key: string]: JsonValue | undefined };

type Frame =
  | { readonly kind: 'array'; readonly node: readonly JsonValue[]; index: number }
  | {
      readonly kind: 'object';
      readonly node: JsonObject;
      readonly keys: readonly string[];
      index: number;
      written: number;
    };

function scalarText(value: JsonValue): string | undefined {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new RomliftInvariantError(`canonical JSON: the number ${value} is not finite`);
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object':
      return undefined;
    default:
      throw new RomliftInvariantError(`canonical JSON: a ${typeof value} is not a JSON value`);
  }
}

/** The canonical JSON text of `value`, as chunks whose concatenation is the whole text. */
export function* canonicalJson(value: JsonValue, chunkSize: number = CANONICAL_JSON_CHUNK): Generator<string> {
  let buffer = '';
  const stack: Frame[] = [];
  const open = new Set<object>();

  // Writes one value: a scalar's text, or the opening bracket of a container pushed on the stack.
  const begin = (node: JsonValue): void => {
    const text = scalarText(node);
    if (text !== undefined) {
      buffer += text;
      return;
    }
    const container = node as object;
    if (open.has(container)) throw new RomliftInvariantError('canonical JSON: the value contains a cycle');
    open.add(container);
    if (Array.isArray(node)) {
      buffer += '[';
      stack.push({ kind: 'array', node: node as readonly JsonValue[], index: 0 });
    } else {
      buffer += '{';
      const object = node as JsonObject;
      stack.push({
        kind: 'object',
        node: object,
        keys: Object.keys(object).sort(compareCodeUnits),
        index: 0,
        written: 0,
      });
    }
  };

  begin(value);
  while (stack.length > 0) {
    if (buffer.length >= chunkSize) {
      yield buffer;
      buffer = '';
    }
    const frame = stack[stack.length - 1];
    if (frame === undefined) break;
    if (frame.kind === 'array') {
      if (frame.index >= frame.node.length) {
        buffer += ']';
        open.delete(frame.node);
        stack.pop();
        continue;
      }
      const item = frame.node[frame.index];
      if (item === undefined) throw new RomliftInvariantError('canonical JSON: an array holds undefined');
      if (frame.index > 0) buffer += ',';
      frame.index++;
      begin(item);
    } else {
      const key = frame.keys[frame.index];
      if (key === undefined) {
        buffer += '}';
        open.delete(frame.node);
        stack.pop();
        continue;
      }
      frame.index++;
      const member = frame.node[key];
      if (member === undefined) continue;
      if (frame.written > 0) buffer += ',';
      frame.written++;
      buffer += JSON.stringify(key) + ':';
      begin(member);
    }
  }
  if (buffer.length > 0) yield buffer;
}
