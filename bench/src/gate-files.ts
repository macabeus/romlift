// The gate test files of test/gates (architecture §10): `g<phase>.<name>.test.ts`, each calling
// gate() once. The phase and id come from the file name and the tier from the spec's `tier:` literal,
// read as text, so the provenance check knows which real-tier gates a landed phase needs without
// running them.
import { join } from 'node:path';
import { listDir } from 'romlift/node';

import { BenchError, isDirectory, readText } from './files.ts';

export type GateFileTier = 'ci' | 'real' | 'both';

export interface GateFile {
  /** The file name, e.g. `g1.bench-harness.test.ts`. */
  readonly file: string;
  /** The gate id, e.g. `g1.bench-harness`. */
  readonly id: string;
  readonly phase: number;
  /** Undefined when the file has no `tier: '<tier>'` literal. */
  readonly tier?: GateFileTier;
}

const GATE_FILE = /^(g([1-6])\.[A-Za-z0-9-]+)\.test\.ts$/;
const TIER = /\btier:\s*['"](ci|real|both)['"]/;

/** The tier a gate file declares, from its text. */
export function tierOf(text: string): GateFileTier | undefined {
  const match = TIER.exec(text)?.[1];
  return match === 'ci' || match === 'real' || match === 'both' ? match : undefined;
}

export function parseGateFileName(file: string): { readonly id: string; readonly phase: number } | undefined {
  const match = GATE_FILE.exec(file);
  if (match === null || match[1] === undefined || match[2] === undefined) return undefined;
  return { id: match[1], phase: Number.parseInt(match[2], 10) };
}

/** Every gate file of `dir`, sorted by file name; an absent directory has none. */
export async function discoverGateFiles(dir: string): Promise<GateFile[]> {
  if (!(await isDirectory(dir))) return [];
  const listed = await listDir(dir);
  if (!listed.ok) throw new BenchError(listed.diagnostic.message);
  const out: GateFile[] = [];
  for (const file of listed.value) {
    const parsed = parseGateFileName(file);
    if (parsed === undefined) continue;
    const tier = tierOf(await readText(join(dir, file)));
    out.push({ file, ...parsed, ...(tier === undefined ? {} : { tier }) });
  }
  return out;
}

export function includesTier(tier: GateFileTier | undefined, selected: 'ci' | 'real'): boolean {
  return tier === 'both' || tier === selected;
}
