// The decoder differential (roadmap 1.A): the flow class of every Thumb halfword (at both alignments),
// of bl pairs and of a seeded sample of 2^16 ARM words equals the proof of concept's control-flow
// classification wherever both define one, through the explicit mappings below: the row's FlowClass
// and the decoded Flow (what phase 2 consumes) must both agree; branch, call, pool and adr targets
// agree too. Every intended difference is listed with its reason, the rows it may cover and its exact
// count; anything else fails. The PoC's
// decoders run under the PoC's own tsx (test/local/poc/decoder-driver.ts). Without the PoC checkout
// the test is skipped as `unavailable: poc`, or fails when ROMLIFT_REQUIRE_LOCAL=1.
import { specOf } from '@match-kit/isa/armv4t';
import type { Flow, FlowClass, Insn } from '@match-kit/isa/armv4t';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decode } from 'romlift';

// The roots resolve as in test/gates/gate.ts: relative to the repository, the bench root defaulting
// to the repository's parent directory.
const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const BENCH_ENV = process.env['ROMLIFT_BENCH_ROOT'];
const BENCH_ROOT = BENCH_ENV ? path.resolve(REPO, BENCH_ENV) : path.dirname(REPO);
const POC_ENV = process.env['ROMLIFT_POC'];
const POC = POC_ENV ? path.resolve(REPO, POC_ENV) : path.join(BENCH_ROOT, 'romlift-poc');
const TSX = path.join(POC, 'node_modules', '.bin', 'tsx');
const REQUIRE = process.env['ROMLIFT_REQUIRE_LOCAL'] === '1';
const BASE = 0x0800_0000;
const ARM_SAMPLE = 1 << 16;

/** The PoC's kinds as FlowClasss. `other` covers everything the PoC does not classify. */
const THUMB_MAP: Readonly<Record<string, readonly FlowClass[]>> = {
  bl: ['bl'],
  b: ['branch'],
  bcc: ['cond-branch'],
  swi: ['swi'],
  bx: ['bx'],
  pop_pc: ['load-pc'],
  ldr_pc: ['pool-load'],
  mov_pc: ['mov-pc', 'add-pc'],
  push: ['next'],
  pop: ['next'],
  other: ['next', 'adr'],
  invalid: ['invalid'],
};

/** The PoC's kinds as Flow kinds (the decoded Flow, not the row class). */
const THUMB_FLOW_MAP: Readonly<Record<string, readonly Flow['kind'][]>> = {
  bl: ['call'],
  b: ['branch'],
  bcc: ['branch'],
  swi: ['interrupt'],
  bx: ['return', 'mode-switch', 'indirect'],
  pop_pc: ['return'],
  ldr_pc: ['pool-load'],
  mov_pc: ['indirect', 'return'],
  push: ['next'],
  pop: ['next'],
  other: ['next', 'adr'],
  invalid: ['invalid'],
};

const ARM_FLOW_MAP: Readonly<Record<string, readonly Flow['kind'][]>> = {
  bx: ['return', 'indirect'],
  bl: ['call'],
  b: ['branch'],
  swi: ['interrupt'],
  ldr_pc: ['pool-load'],
  adr: ['adr'],
  pc_write: ['indirect', 'return'],
  other: ['next'],
  invalid: ['invalid'],
};

const ARM_MAP: Readonly<Record<string, readonly FlowClass[]>> = {
  bx: ['bx'],
  bl: ['bl'],
  b: ['branch'],
  swi: ['swi'],
  ldr_pc: ['pool-load'],
  adr: ['adr'],
  pc_write: ['mov-pc', 'add-pc', 'load-pc'],
  other: ['next'],
  invalid: ['invalid'],
};

interface IntendedDifference {
  readonly name: string;
  readonly reason: string;
  readonly applies: (insn: Insn, pocKind: string) => boolean;
  /** The exact count per row: a row not listed, or a count that moves, fails the test. */
  readonly rows: Readonly<Record<string, number>>;
}

const pcDest = (insn: Insn): boolean => insn.fields['rd'] === 15;

/** The rows the ARMv4T leaves undefined that the PoC files as other or pc_write; no other invalid row may differ. */
const V4T_UNDEFINED_ROWS: ReadonlySet<string> = new Set([
  'arm.misc_undefined',
  'arm.mul_undefined',
  'arm.swp_undefined',
  'arm.ldrd_strd',
  'arm.media_undefined',
  'arm.msr_imm_sbo',
  'arm.msr_reg_sbo',
  'arm.mrs_sbo',
  'arm.bx_sbo',
]);

/** The differences this decoder makes on purpose, each with its reason. */
const INTENDED: readonly IntendedDifference[] = [
  {
    name: 'thumb-mov-pc-lr',
    reason:
      'the PoC files `mov pc, lr` under bx; the table classes it as a hi-register write to pc (mov-pc), and its Flow is still a return (mov-pc-lr); once per alignment',
    applies: (insn, poc) => insn.mode === 'thumb' && poc === 'bx' && insn.specId === 'thumb.mov_pc',
    rows: { 'thumb.mov_pc': 2 },
  },
  {
    name: 'arm-adr-to-pc',
    reason:
      'the PoC files `add pc, pc, #imm` and `sub pc, pc, #imm` under adr; they write pc, so the table classes them by opcode (add-pc, mov-pc)',
    applies: (insn, poc) => insn.mode === 'arm' && poc === 'adr' && pcDest(insn),
    rows: { 'arm.add_imm_pc': 2 },
  },
  {
    name: 'arm-v4t-undefined',
    reason:
      'encodings the ARMv4T leaves undefined (the miscellaneous, multiply and swap spaces, ldrd/strd, the media space, bx with its should-be-one bits clear) are invalid here; the PoC files them as other or pc_write',
    applies: (insn, poc) =>
      insn.mode === 'arm' && V4T_UNDEFINED_ROWS.has(insn.specId) && (poc === 'other' || poc === 'pc_write'),
    // 2,526 of the 65,536 sampled words.
    rows: {
      'arm.bx_sbo': 17,
      'arm.ldrd_strd': 458,
      'arm.media_undefined': 126,
      'arm.misc_undefined': 1091,
      'arm.mrs_sbo': 26,
      'arm.msr_imm_sbo': 494,
      'arm.msr_reg_sbo': 28,
      'arm.mul_undefined': 69,
      'arm.swp_undefined': 217,
    },
  },
];

function targetOf(flow: Flow): number | undefined {
  switch (flow.kind) {
    case 'branch':
    case 'call':
    case 'adr':
      return flow.target;
    case 'pool-load':
      return flow.pool;
    default:
      return undefined;
  }
}

/** The PoC kinds whose arg is an address. */
const TARGET_KINDS: ReadonlySet<string> = new Set(['bl', 'b', 'bcc', 'ldr_pc', 'adr']);

function xorshift32(state: number): number {
  let x = state;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

function runDriver(request: unknown): Promise<{
  thumb: [string, number][];
  thumbOdd: [string, number][];
  bl: [string, number][];
  arm: [string, number][];
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [path.join(REPO, 'test/local/poc/decoder-driver.ts'), POC], {
      cwd: POC,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(JSON.parse(out) as Awaited<ReturnType<typeof runDriver>>)
        : reject(new Error(`driver exited ${code}: ${err}`)),
    );
    child.stdin.end(JSON.stringify(request));
  });
}

const unavailable = !existsSync(TSX) || !existsSync(path.join(POC, 'src', 'thumb.ts'));

test(
  'decoder flow classes equal the PoC classification',
  { skip: unavailable && !REQUIRE ? 'unavailable: poc' : false },
  async (t) => {
    assert.ok(!unavailable, `unavailable: poc (no ${TSX})`);
    const thumb = Array.from({ length: 0x10000 }, (_, hw) => hw);
    const bl: [number, number][] = [];
    for (let hi = 0; hi < 0x800; hi++)
      for (const lo of [0, 1, 0x3ff, 0x400, 0x7fe, 0x7ff]) bl.push([0xf000 | hi, 0xf800 | lo]);
    const arm: number[] = [];
    let state = 0x2026_1017;
    for (let i = 0; i < ARM_SAMPLE; i++) arm.push((state = xorshift32(state)));
    const reply = await runDriver({ thumb, bl, arm });

    const counts = new Map<string, Map<string, number>>();
    const unexplained: string[] = [];
    let compared = 0;
    const check = (
      insn: Insn,
      poc: readonly [string, number] | undefined,
      map: Readonly<Record<string, readonly FlowClass[]>>,
      flowMap: Readonly<Record<string, readonly Flow['kind'][]>>,
    ): void => {
      const [kind, arg] = poc ?? ['missing', 0];
      const ours = specOf(insn.specId).flow;
      compared++;
      const allowed = map[kind];
      const flowAllowed = flowMap[kind];
      if (
        allowed !== undefined &&
        allowed.includes(ours) &&
        flowAllowed !== undefined &&
        flowAllowed.includes(insn.flow.kind)
      ) {
        const target = targetOf(insn.flow);
        if (TARGET_KINDS.has(kind) && target !== undefined && target !== arg >>> 0) {
          unexplained.push(
            `${insn.specId} 0x${insn.word.toString(16)}: target 0x${target.toString(16)}, PoC 0x${(arg >>> 0).toString(16)}`,
          );
        }
        return;
      }
      const intended = INTENDED.find((d) => d.applies(insn, kind));
      if (intended !== undefined) {
        const rows = counts.get(intended.name) ?? new Map<string, number>();
        rows.set(insn.specId, (rows.get(insn.specId) ?? 0) + 1);
        counts.set(intended.name, rows);
      } else
        unexplained.push(
          `${insn.mode} ${insn.specId} 0x${insn.word.toString(16)}: ${ours} / ${insn.flow.kind}, PoC ${kind}`,
        );
    };

    thumb.forEach((hw, i) => check(decode('thumb', hw, BASE + 4 * i), reply.thumb[i], THUMB_MAP, THUMB_FLOW_MAP));
    thumb.forEach((hw, i) =>
      check(decode('thumb', hw, BASE + 4 * i + 2), reply.thumbOdd[i], THUMB_MAP, THUMB_FLOW_MAP),
    );
    bl.forEach(([p, s], i) =>
      check(decode('thumb', (p | (s << 16)) >>> 0, BASE + 4 * i), reply.bl[i], THUMB_MAP, THUMB_FLOW_MAP),
    );
    arm.forEach((w, i) => check(decode('arm', w, BASE + 4 * i), reply.arm[i], ARM_MAP, ARM_FLOW_MAP));

    const measured = (name: string): Record<string, number> =>
      Object.fromEntries(
        [...(counts.get(name) ?? new Map<string, number>())].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    for (const d of INTENDED) t.diagnostic(`${d.name}: ${JSON.stringify(measured(d.name))} (${d.reason})`);
    t.diagnostic(`compared ${compared} encodings`);
    assert.deepEqual(unexplained.slice(0, 20), []);
    for (const d of INTENDED) assert.deepEqual(measured(d.name), d.rows, `${d.name}: the rows and counts it covers`);
  },
);
