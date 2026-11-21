// speedVerdict, g2.speed's verdict (test/gates/speed-verdict.ts, D76 b, D77 g): the limit 1.5 x baseline x ratio, and
// a report or a ROM measured over fewer than nine runs fails whatever its times (fix round 3, gate-honesty-a1-3).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type SpeedLine, speedVerdict } from '../../gates/speed-verdict.ts';

function report(over: Partial<SpeedLine> = {}): SpeedLine {
  return {
    schema: 'romlift/bench-speed@1',
    runs: { analysis: 9 },
    calibration: { cpuMs: 100, baselineCpuMs: 100, ratio: 1 },
    roms: [
      { name: 'sa2', analysisCpuMs: 150, analysisRuns: 9, wallMs: 151, baselineCpuMs: 100 },
      { name: 'klonoa', analysisCpuMs: 10, analysisRuns: 9, wallMs: 11, baselineCpuMs: 100 },
    ],
    ...over,
  };
}

test('nine runs within 1.5 x baseline x ratio pass, with one note per ROM', () => {
  const v = speedVerdict(report(), ['sa2', 'klonoa']);
  assert.deepEqual(v.problems, []);
  assert.deepEqual(v.notes, ['sa2 150/150 ms', 'klonoa 10/150 ms']);
});

test('over the limit, a missing ROM, a bad schema or ratio fail', () => {
  const slow = report({ roms: [{ name: 'sa2', analysisCpuMs: 151, analysisRuns: 9, wallMs: 1, baselineCpuMs: 100 }] });
  assert.deepEqual(speedVerdict(slow, ['sa2']).problems, ['sa2: 151 ms CPU > 150 ms (1.5 x 100 x 1.000)']);
  assert.deepEqual(speedVerdict(report(), ['sa2', 'tmc']).problems, ['tmc: not measured']);
  assert.equal(speedVerdict(report({ schema: 'other' }), ['sa2']).problems.length, 1);
  assert.match(
    speedVerdict(report({ calibration: { cpuMs: 1, baselineCpuMs: 0, ratio: 0 } }), ['klonoa']).problems.join('; '),
    /the calibration ratio is 0/,
  );
});

test('a report of five analysis runs, or a ROM of five, is rejected whatever its times (D77 g)', () => {
  assert.deepEqual(speedVerdict(report({ runs: { analysis: 5 } }), ['sa2']).problems, [
    "bench speed measured each ROM's analysis over 5 runs, not 9 (D76 b)",
  ]);
  const five = report({ roms: [{ name: 'sa2', analysisCpuMs: 1, analysisRuns: 5, wallMs: 1, baselineCpuMs: 100 }] });
  assert.deepEqual(speedVerdict(five, ['sa2']).problems, ['sa2: its median is of 5 measured runs, not 9 (D76 b)']);
  const unsaid = report({ runs: {}, roms: [{ name: 'sa2', analysisCpuMs: 1, wallMs: 1, baselineCpuMs: 100 }] });
  assert.equal(speedVerdict(unsaid, ['sa2']).problems.length, 2, 'a report that does not say its counts fails too');
});
