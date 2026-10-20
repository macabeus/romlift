// The unified diff of two texts, by line (Myers' O((N+M)D) shortest edit script), for printing a change: a patch of
// romlift.toml (`analyze --update`) or the drift of a scaffold file (`scaffold --diff`). Pure and generic: it knows
// lines, not projects.

/** How many unchanged lines a hunk shows around each change. */
const CONTEXT = 3;

type LineOp = { readonly kind: 'same' | 'del' | 'add'; readonly text: string };

function linesOf(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** The shortest edit script from `a` to `b` (Myers 1986), as line operations in order. */
function editScript(a: readonly string[], b: readonly string[]): readonly LineOp[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let done = false;
  for (let d = 0; d <= max && !done; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0)) ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        done = true;
        break;
      }
    }
  }
  const ops: LineOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d] ?? v;
    const k = x - y;
    const prevK = k === -d || (k !== d && (vd[offset + k - 1] ?? 0) < (vd[offset + k + 1] ?? 0)) ? k + 1 : k - 1;
    const prevX = vd[offset + prevK] ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ kind: 'same', text: a[x - 1] ?? '' });
      x--;
      y--;
    }
    if (d === 0) break;
    if (x === prevX) ops.push({ kind: 'add', text: b[y - 1] ?? '' });
    else ops.push({ kind: 'del', text: a[x - 1] ?? '' });
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

/**
 * The unified diff (`diff -u` form, three lines of context) of `before` and `after`, labelled `a/<path>` and
 * `b/<path>`; the empty string when they are equal. Deterministic; lines are compared whole.
 */
export function unifiedDiff(before: string, after: string, path: string): string {
  if (before === after) return '';
  const a = linesOf(before);
  const b = linesOf(after);
  const ops = editScript(a, b);
  const changed = ops.map((op, i) => (op.kind === 'same' ? -1 : i)).filter((i) => i >= 0);
  const hunks: { start: number; end: number }[] = [];
  for (const i of changed) {
    const start = Math.max(0, i - CONTEXT);
    const end = Math.min(ops.length, i + CONTEXT + 1);
    const last = hunks[hunks.length - 1];
    if (last !== undefined && start <= last.end) last.end = Math.max(last.end, end);
    else hunks.push({ start, end });
  }
  let out = `--- a/${path}\n+++ b/${path}\n`;
  let ai = 0;
  let bi = 0;
  let at = 0;
  for (const hunk of hunks) {
    for (; at < hunk.start; at++) {
      const op = ops[at];
      if (op?.kind !== 'add') ai++;
      if (op?.kind !== 'del') bi++;
    }
    const body: string[] = [];
    let aCount = 0;
    let bCount = 0;
    for (; at < hunk.end; at++) {
      const op = ops[at];
      if (op === undefined) break;
      body.push(`${op.kind === 'same' ? ' ' : op.kind === 'del' ? '-' : '+'}${op.text}`);
      if (op.kind !== 'add') aCount++;
      if (op.kind !== 'del') bCount++;
    }
    out += `@@ -${aCount === 0 ? ai : ai + 1},${aCount} +${bCount === 0 ? bi : bi + 1},${bCount} @@\n${body.join('\n')}\n`;
    ai += aCount;
    bi += bCount;
  }
  return out;
}

