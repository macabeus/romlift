// `bench run --cpu-prof` (architecture §4.5 milestone M2, §9.3, D13): profiles the first analysis run of
// each ROM with the V8 sampling profiler, through the inspector of this process, and writes the
// functions with the most self time to bench/.local/cpu-prof/<rom>.json (gitignored). topSelfTime is
// the pure part: it attributes each sample's time delta to its node and sums by function.
import { Session } from 'node:inspector/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareCodeUnits } from 'romlift';

import type { BenchContext } from './context.ts';
import { prettyJson, writeText } from './files.ts';

/** The parts of a V8 CPU profile (the inspector's Profiler.Profile) that self time needs. */
export interface CpuProfile {
  readonly nodes: readonly {
    readonly id: number;
    readonly callFrame: { readonly functionName: string; readonly url: string; readonly lineNumber: number };
    readonly hitCount?: number | undefined;
  }[];
  readonly startTime: number;
  readonly endTime: number;
  readonly samples?: readonly number[] | undefined;
  /** Microseconds since the previous sample, one per sample. */
  readonly timeDeltas?: readonly number[] | undefined;
}

export interface SelfTime {
  readonly functionName: string;
  /** The script, relative to the repository when it lies inside it. */
  readonly url: string;
  /** 1-based. */
  readonly line: number;
  readonly selfMs: number;
}

/** The `limit` functions with the most self time, merged by name, script and line; ties by name. */
export function topSelfTime(profile: CpuProfile, limit = 25, root?: string): SelfTime[] {
  const micros = new Map<number, number>();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  if (samples.length > 0 && deltas.length === samples.length) {
    samples.forEach((id, i) => micros.set(id, (micros.get(id) ?? 0) + Math.max(0, deltas[i] ?? 0)));
  } else {
    const hits = profile.nodes.reduce((n, node) => n + (node.hitCount ?? 0), 0);
    const each = hits === 0 ? 0 : (profile.endTime - profile.startTime) / hits;
    for (const node of profile.nodes) micros.set(node.id, (node.hitCount ?? 0) * each);
  }
  const prefix = root === undefined ? undefined : `${pathToFileURL(root).href}/`;
  const byFunction = new Map<string, SelfTime>();
  for (const node of profile.nodes) {
    const us = micros.get(node.id) ?? 0;
    if (us === 0) continue;
    const { functionName, url, lineNumber } = node.callFrame;
    const name = functionName === '' ? '(anonymous)' : functionName;
    const where = prefix !== undefined && url.startsWith(prefix) ? url.slice(prefix.length) : url;
    const key = `${name}\0${where}\0${lineNumber}`;
    const have = byFunction.get(key);
    byFunction.set(key, {
      functionName: name,
      url: where,
      line: lineNumber + 1,
      selfMs: (have?.selfMs ?? 0) + us / 1000,
    });
  }
  return [...byFunction.values()]
    .sort(
      (a, b) =>
        b.selfMs - a.selfMs ||
        compareCodeUnits(a.functionName, b.functionName) ||
        compareCodeUnits(a.url, b.url) ||
        a.line - b.line,
    )
    .slice(0, limit)
    .map((t) => ({ ...t, selfMs: Math.round(t.selfMs * 10) / 10 }));
}

/** Runs `fn` under the sampling profiler of this process. */
export async function profiled<T>(
  fn: () => T,
  intervalMicros = 200,
): Promise<{ readonly value: T; readonly profile: CpuProfile }> {
  const session = new Session();
  session.connect();
  try {
    await session.post('Profiler.enable');
    await session.post('Profiler.setSamplingInterval', { interval: intervalMicros });
    await session.post('Profiler.start');
    const value = fn();
    const { profile } = await session.post('Profiler.stop');
    return { value, profile };
  } finally {
    session.disconnect();
  }
}

export const cpuProfPath = (cx: BenchContext, rom: string): string =>
  join(cx.repoRoot, 'bench', '.local', 'cpu-prof', `${rom}.json`);

/** Writes the top self-time functions of one ROM's analysis; returns the path. */
export async function writeTopSelfTime(cx: BenchContext, rom: string, profile: CpuProfile): Promise<string> {
  const path = cpuProfPath(cx, rom);
  const total = profile.endTime - profile.startTime;
  await writeText(
    path,
    prettyJson({ rom, profiledMs: Math.round(total / 100) / 10, top: topSelfTime(profile, 25, cx.repoRoot) }),
  );
  return path;
}
