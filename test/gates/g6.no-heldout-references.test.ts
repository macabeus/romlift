// g6.no-heldout-references (architecture §7.1, §13, D25, D32): no signature spec names a sealed dataset as a
// reference, so a held-out ROM never becomes signature data. Every reference of every version of every
// signatures/specs/*.json must name a dataset under bench/dataset/real/ that is tuning data (not held out,
// or revealed); a reference to a sealed or an unknown dataset fails. The sealed names are read from the
// dataset files at run time; no held-out name is written here.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { gate } from './gate.ts';

interface Spec {
  readonly library?: string;
  readonly versions?: readonly {
    readonly id?: string;
    readonly references?: readonly { readonly dataset?: string }[];
  }[];
}

gate({
  id: 'g6.no-heldout-references',
  phase: 6,
  tier: 'ci',
  needs: ['buildSignatures', 'locateSignatures'],
  async run(cx) {
    const specDir = path.join(cx.repoRoot, 'signatures', 'specs');
    const names = (await readdir(specDir).catch(() => [] as string[]))
      .filter((n) => n.endsWith('.json'))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (names.length === 0) throw new Error('signatures/specs holds no spec');
    const tuning = new Set(cx.datasets.map((d) => d.name));
    const sealed = new Set(cx.sealed.map((d) => d.name));
    const problems: string[] = [];
    let references = 0;
    for (const name of names) {
      const spec = JSON.parse(await readFile(path.join(specDir, name), 'utf8')) as Spec;
      if (spec.versions === undefined || spec.versions.length === 0) problems.push(`${name}: no versions`);
      for (const version of spec.versions ?? []) {
        if ((version.references ?? []).length === 0) problems.push(`${name} ${version.id ?? '?'}: no references`);
        for (const ref of version.references ?? []) {
          references++;
          const dataset = ref.dataset ?? '';
          if (sealed.has(dataset))
            problems.push(`${name} ${version.id ?? '?'}: names a sealed held-out dataset as a reference`);
          else if (!tuning.has(dataset))
            problems.push(
              `${name} ${version.id ?? '?'}: names '${dataset}', which is no dataset under bench/dataset/real`,
            );
        }
      }
    }
    if (problems.length > 0) throw new Error(`signature references: ${problems.join('; ')}`);
    cx.note(
      `${names.length} specs, ${references} references, all to tuning datasets (${cx.sealed.length} sealed datasets excluded)`,
    );
  },
});
