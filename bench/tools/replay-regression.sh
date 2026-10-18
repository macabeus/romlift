#!/usr/bin/env bash
# Replays the per-commit bench evidence of a range of commits (review findings gate-honesty-r0-8,
# gate-honesty-r1-6, code-quality-r1-3): `bench run`, then `bench regression` against the commit before,
# each judged by the code and the datasets of the commit itself.
#
# For <from> and then every commit of <from>..<to>, oldest first, a detached worktree of that commit:
#   1. deletes its committed bench/results.json and runs `bench run`, which writes a fresh one; a run that
#      exits non-zero is flagged (bench column) and its commit gets no artifact and no regression;
#   2. from the second commit on, runs that worktree's own `bench regression --base <B> --json`, where B is
#      a temporary commit whose parent is the commit's own first parent (git's <sha>^, not the commit
#      listed before it, which differs after a merge) and whose only change is that parent's fresh
#      artifact: the base rows are that fresh run, the base datasets are the parent's, and the
#      Bench-Exception trailers checked are those of the commits after the parent up to this one (git log
#      B..HEAD), exactly what `bench regression --base <parent sha>` checks when the parent's committed
#      artifact is current; a commit whose parent was not replayed (outside the range, or its run failed)
#      gets no regression and says why;
#   3. records its own fresh artifact as such a temporary commit, for the commits whose parent it is. The
#      temporary commits are never referenced by a branch or tag (git gc drops them).
# Everything lands in <out>: <sha>.run.txt (the bench output), <sha>.results.json, <sha>.regression.json and
# summary.tsv (one line per commit: sha, subject, bench exit, regression exit or '(base)'/'skipped', then
# per tuning ROM name:tp/entries/false/agree/codeEnd).
#
# Limitation: the worktrees share this checkout's node_modules and bench/.local (the PoC dumps and the
# corpus), so each commit runs with today's dependencies and today's dumps; run `npm ci`,
# `npm run export-poc -- --mode scored` and `npm run corpus` here first. A commit whose code reads those
# dumps differently from today's fails its run and is flagged, not hidden.
#
# usage: bench/tools/replay-regression.sh <from> <to> <out dir>
set -euo pipefail
from=$1
to=$2
out=$(mkdir -p "$3" && cd "$3" && pwd)
repo=$(git rev-parse --show-toplevel)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"; git -C "$repo" worktree prune' EXIT
first=1
printf 'commit\tsubject\tbench\tregression\trows\n' > "$out/summary.tsv"
for c in $(git -C "$repo" rev-parse "$from") $(git -C "$repo" rev-list --reverse --topo-order "$from..$to"); do
  # The base of a commit is the fresh artifact of its first parent, kept in $tmp/base.<parent sha>.
  parent=$(git -C "$repo" rev-parse --verify --quiet "$c^" || true)
  base=
  [ -n "$parent" ] && [ -f "$tmp/base.$parent" ] && base=$(cat "$tmp/base.$parent")
  wt="$tmp/$c"
  git -C "$repo" worktree add --quiet --detach "$wt" "$c"
  ln -s "$repo/node_modules" "$wt/node_modules"
  mkdir -p "$wt/bench/.local"
  for d in poc corpus; do [ -e "$repo/bench/.local/$d" ] && ln -s "$repo/bench/.local/$d" "$wt/bench/.local/$d"; done
  rm -f "$wt/bench/results.json"
  set +e
  (cd "$wt" && npm run --silent bench -- run) > "$out/$c.run.txt" 2>&1
  bench=$?
  set -e
  regression=skipped
  rows=-
  if [ "$bench" -eq 0 ] && [ -f "$wt/bench/results.json" ]; then
    cp "$wt/bench/results.json" "$out/$c.results.json"
    if [ -n "$base" ]; then
      set +e
      (cd "$wt" && npm run --silent bench -- regression --base "$base" --json) > "$out/$c.regression.json" 2>&1
      regression=$?
      set -e
    elif [ "$first" -eq 1 ]; then
      regression='(base)'
    else
      regression='(no base: the parent was not replayed or its run failed)'
    fi
    git -C "$wt" add -f bench/results.json
    git -C "$wt" -c user.name=replay -c user.email=replay@localhost commit --quiet --no-verify --allow-empty -m "replay: fresh artifact of $c"
    git -C "$wt" rev-parse HEAD > "$tmp/base.$c"
    rows=$(node -e '
      const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      console.log(r.roms.map((x) => `${x.name}:${x.tp}/${x.entries}/${x.falseEntries.length}/${x.extents.agree}/${x.codeEnd.delta}`).join(" "));
    ' "$out/$c.results.json")
  fi
  # No fresh artifact: the commits whose parent this is get no base, rather than a stale one.
  printf '%s\t%s\t%s\t%s\t%s\n' "${c:0:7}" "$(git -C "$repo" log -1 --format=%s "$c")" "$bench" "$regression" "$rows" >> "$out/summary.tsv"
  git -C "$repo" worktree remove --force "$wt"
  first=0
done
cat "$out/summary.tsv"
