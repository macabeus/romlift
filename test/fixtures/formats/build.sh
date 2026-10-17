#!/bin/sh
# Rebuilds the parser fixtures tiny.elf and tiny.map from tiny.s, libpart.s and tiny.ld with the
# system binutils, in a temporary directory so no object file is left behind, and records the
# assembler version in build-info.txt. The outputs are committed (self-authored, no ROM bytes).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp "$here/tiny.s" "$here/libpart.s" "$here/tiny.ld" "$work/"
cd "$work"
arm-none-eabi-as -mcpu=arm7tdmi -o tiny.o tiny.s
arm-none-eabi-as -mcpu=arm7tdmi -o libpart.o libpart.s
arm-none-eabi-ar rcD libtiny.a libpart.o
arm-none-eabi-ld -T tiny.ld -Map tiny.map -o tiny.elf tiny.o libtiny.a
cp tiny.elf tiny.map "$here/"
chmod 644 "$here/tiny.elf" "$here/tiny.map"
{
  echo "# Built by build.sh; the assembler and linker that produced tiny.elf and tiny.map:"
  echo "# as: $(arm-none-eabi-as --version | head -n 1)"
  echo "# ld: $(arm-none-eabi-ld --version | head -n 1)"
} > "$here/build-info.txt"
