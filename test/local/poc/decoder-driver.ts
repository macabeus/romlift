// Runs the proof of concept's control-flow decoders (src/thumb.ts, src/arm.ts) under the PoC's own
// tsx, for test/local/poc-decoder-differential.test.ts:
//
//   $ROMLIFT_POC/node_modules/.bin/tsx test/local/poc/decoder-driver.ts <poc root>  < request.json
//
// The request is { thumb: number[], bl: [number, number][], arm: number[] }. Each Thumb halfword is
// decoded twice, at 0x08000000 + 4i and at 0x08000000 + 4i + 2 (so PC-relative targets are compared
// at both alignments), each time with a zero halfword after it (so it never pairs); each bl pair at
// 0x08000000 + 4i, each ARM word at 0x08000000 + 4i. The reply is the four lists thumb, thumbOdd, bl
// and arm of [kind, arg]. The PoC is read-only: this file only imports it.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

interface Request {
  readonly thumb: readonly number[];
  readonly bl: readonly (readonly [number, number])[];
  readonly arm: readonly number[];
}

type Decoded = { readonly kind: string; readonly arg: number };
type RomConstructor = new (bytes: Uint8Array) => object;
type Decoder = (rom: object, addr: number) => Decoded;

const BASE = 0x0800_0000;

async function load(root: string, file: string): Promise<Record<string, unknown>> {
  const module: unknown = await import(pathToFileURL(path.join(root, file)).href);
  if (typeof module !== 'object' || module === null) throw new Error(`${file} is not a module`);
  return module as Record<string, unknown>;
}

function isDecoded(value: unknown): value is Decoded {
  return typeof value === 'object' && value !== null && 'kind' in value && 'arg' in value && typeof value.kind === 'string' && typeof value.arg === 'number';
}

function decoder(module: Record<string, unknown>, name: string): Decoder {
  const fn = module[name];
  if (typeof fn !== 'function') throw new Error(`the PoC exports no ${name}`);
  return (rom, addr) => {
    const out: unknown = Reflect.apply(fn, undefined, [rom, addr]);
    if (!isDecoded(out)) throw new Error(`${name} returned an unexpected value`);
    return out;
  };
}

function image(entries: readonly (readonly [number, number])[], halfwords: boolean): Uint8Array {
  const bytes = new Uint8Array(entries.length * 4);
  const view = new DataView(bytes.buffer);
  entries.forEach(([a, b], i) => {
    if (halfwords) {
      view.setUint16(4 * i, a, true);
      view.setUint16(4 * i + 2, b, true);
    } else view.setUint32(4 * i, a, true);
  });
  return bytes;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString('utf8');
}

const root = process.argv[2];
if (root === undefined) throw new Error('usage: decoder-driver.ts <poc root>');
const rom = await load(root, 'src/rom.ts');
const Rom = rom['Rom'];
if (typeof Rom !== 'function') throw new Error('the PoC exports no Rom');
const RomClass = Rom as RomConstructor;
const decodeThumb = decoder(await load(root, 'src/thumb.ts'), 'decodeThumb');
const decodeArm = decoder(await load(root, 'src/arm.ts'), 'decodeArm');

const request = JSON.parse(await readStdin()) as Request;
const run = (bytes: Uint8Array, count: number, decode: Decoder, offset = 0): [string, number][] => {
  const target = new RomClass(bytes);
  const out: [string, number][] = [];
  for (let i = 0; i < count; i++) {
    const d = decode(target, BASE + 4 * i + offset);
    out.push([d.kind, d.arg]);
  }
  return out;
};
const reply = {
  thumb: run(image(request.thumb.map((hw) => [hw, 0] as const), true), request.thumb.length, decodeThumb),
  // [0, hw]: the halfword at 4i + 2, followed by the next slot's zero halfword.
  thumbOdd: run(image(request.thumb.map((hw) => [0, hw] as const), true), request.thumb.length, decodeThumb, 2),
  bl: run(image(request.bl, true), request.bl.length, decodeThumb),
  arm: run(image(request.arm.map((w) => [w, 0] as const), false), request.arm.length, decodeArm),
};
process.stdout.write(JSON.stringify(reply));
