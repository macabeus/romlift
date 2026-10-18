// g2.no-unreviewed (architecture §8.3, §13, D26): no row of any dataset in bench/dataset/real carries the
// category `unreviewed`; milestone M5 classifies the six such rows, each confirmed with `bench explain`.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { byCodeUnit, gate } from './gate.ts';

interface DatasetRow {
  readonly addr: string;
  readonly category: string;
}

interface DatasetLists {
  readonly name: string;
  readonly labels?: readonly DatasetRow[];
  readonly untyped?: readonly DatasetRow[];
}


gate({
  id: 'g2.no-unreviewed',
  phase: 2,
  tier: 'real',
  needs: ['analyze', 'explain'],
  async run(cx) {
    const dir = path.join(cx.repoRoot, 'bench', 'dataset', 'real');
    const files = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort(byCodeUnit);
    if (files.length === 0) throw new Error('bench/dataset/real holds no dataset');
    const unreviewed: string[] = [];
    let rows = 0;
    for (const file of files) {
      const dataset = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as DatasetLists;
      for (const list of ['labels', 'untyped'] as const) {
        for (const row of dataset[list] ?? []) {
          rows++;
          if (row.category === 'unreviewed') unreviewed.push(`${dataset.name} ${list} ${row.addr}`);
        }
      }
    }
    if (unreviewed.length > 0) throw new Error(`${unreviewed.length} rows are unreviewed: ${unreviewed.join(', ')}`);
    cx.note(`${files.length} datasets, ${rows} exception rows, none unreviewed`);
  },
});
