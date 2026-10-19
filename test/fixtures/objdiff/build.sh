#!/bin/sh
# Rebuilds the objdiff-cli parser fixtures from reference.s and base.s (self-authored, no ROM bytes):
# assembles both with the system arm-none-eabi-as, runs the one-shot diff of bench/src/objdiff-cli.ts
# (objdiffDiffArgs) on them, and records the assembler and objdiff-cli versions in build-info.txt.
# objdiff-cli is $ROMLIFT_OBJDIFF, else the repository's bench/.local build. The outputs are committed.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
objdiff=${ROMLIFT_OBJDIFF:-$repo/bench/.local/objdiff-target/release/objdiff-cli}
cd "$here"
arm-none-eabi-as -mcpu=arm7tdmi -o reference.o reference.s
arm-none-eabi-as -mcpu=arm7tdmi -o base.o base.s
"$objdiff" --no-color diff -1 reference.o -2 base.o -o - --format json \
  -c functionRelocDiffs=name_address -c arm.archVersion=v4t > diff.json
chmod 644 reference.o base.o diff.json
{
  echo "# Built by build.sh; the tools that produced reference.o, base.o and diff.json:"
  echo "# as: $(arm-none-eabi-as --version | head -n 1)"
  echo "# objdiff-cli: $("$objdiff" --version | head -n 1)"
} > build-info.txt
