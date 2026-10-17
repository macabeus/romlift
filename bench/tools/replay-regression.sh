#!/usr/bin/env bash
# Replays the per-commit bench evidence of a range of commits (review finding gate-honesty-r0-8): for each
# commit in <from>..<to>, oldest first, a detached worktree runs `bench run` (writing that commit's
# results.json), and from the second commit on `bench regression --base <previous artifact> --fresh
# <this artifact> --json` compares it with the commit before. Everything lands in <out>: <sha>.run.txt
# (the bench output), <sha>.results.json, <sha>.regression.json and summary.tsv (one line per commit:
# sha, subject, bench exit, regression exit, then per tuning ROM name:tp/entries/false/agree/codeEnd).
# The worktrees share this checkout's node_modules and bench/.local (the PoC dumps and the corpus), so
# run `npm ci`, `npm run export-poc -- --mode scored` and `npm run corpus` here first.
#
# usage: bench/tools/replay-regression.sh <from> <to> <out dir>
set -euo pipefail
from=$1
to=$2
out=$(mkdir -p "$3" && cd "$3" && pwd)
repo=$(git rev-parse --show-toplevel)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
prev=
printf 'commit\tsubject\tbench\tregression\trows\n' > "$out/summary.tsv"
for c in $(git -C "$repo" rev-list --reverse "$from..$to"); do
  wt="$tmp/$c"
  git -C "$repo" worktree add --quiet --detach "$wt" "$c"
  ln -s "$repo/node_modules" "$wt/node_modules"
  mkdir -p "$wt/bench/.local"
  for d in poc corpus; do [ -e "$repo/bench/.local/$d" ] && ln -s "$repo/bench/.local/$d" "$wt/bench/.local/$d"; done
  set +e
  (cd "$wt" && npm run --silent bench -- run) > "$out/$c.run.txt" 2>&1
  bench=$?
  cp "$wt/bench/results.json" "$out/$c.results.json"
  regression=-
  if [ -n "$prev" ]; then
    (cd "$repo" && npm run --silent bench -- regression --base "$out/$prev.results.json" --fresh "$out/$c.results.json" --json) > "$out/$c.regression.json" 2>&1
    regression=$?
  fi
  set -e
  rows=$(node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    console.log(r.roms.map((x) => `${x.name}:${x.tp}/${x.entries}/${x.falseEntries.length}/${x.extents.agree}/${x.codeEnd.delta}`).join(" "));
  ' "$out/$c.results.json")
  printf '%s\t%s\t%s\t%s\t%s\n' "${c:0:7}" "$(git -C "$repo" log -1 --format=%s "$c")" "$bench" "$regression" "$rows" >> "$out/summary.tsv"
  git -C "$repo" worktree remove --force "$wt"
  prev=$c
done
cat "$out/summary.tsv"
