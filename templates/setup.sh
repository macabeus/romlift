#!/bin/sh
# setup.sh: prepares this checkout of @@name@@ to build @@builtRom@@ (written once by romlift init; yours to edit).
# Run it after cloning and in every new git worktree; it is safe to run again. Its five duties, in order:
#   1. check_toolchain   the assembler, linker and objcopy for ARM, make, and a host C compiler
#   2. setup_agbcc       when tools/agbcc/bin/agbcc is missing: fetch agbcc into tools/agbcc and build it
#   3. copy_baserom      in a git worktree without @@romFile@@: copy it from the main worktree; check its SHA-1
#   4. install_romlift   npm ci (npm install while there is no package-lock.json); skipped when ROMLIFT_CLI is set
#   5. generate_tree     romlift generate, when asm/ is absent or romlift.toml changed since it last ran
# It never writes romlift.toml. ROMLIFT_CLI names the romlift command to run instead of `npx romlift`, and
# AGBCC_URL another place to fetch agbcc from (a mirror; the submodule still records the pinned URL).
set -eu

cd "$(dirname "$0")"

ROM='@@romFile@@'
SHA1_FILE='@@sha1File@@'
AGBCC_DIR='tools/agbcc'
AGBCC_PIN_URL='@@agbccUrl@@'
AGBCC_URL="${AGBCC_URL:-$AGBCC_PIN_URL}"
AGBCC_COMMIT='@@agbccCommit@@'

say() {
  printf 'setup.sh: %s\n' "$*"
}

die() {
  printf 'setup.sh: error: %s\n' "$*" >&2
  exit 1
}

have() {
  command -v "$1" >/dev/null 2>&1
}

in_git() {
  have git && git rev-parse --is-inside-work-tree >/dev/null 2>&1
}

sha1_of() {
  if have sha1sum; then sha1sum "$1"; else shasum -a 1 "$1"; fi | cut -d ' ' -f 1
}

# Duty 1: every program the build runs.
check_toolchain() {
  missing=''
  for tool in arm-none-eabi-as arm-none-eabi-ld arm-none-eabi-objcopy make "${HOSTCC:-cc}"; do
    have "$tool" || missing="$missing $tool"
  done
  if [ -n "$missing" ]; then
    die "missing:$missing. Install GNU binutils for ARM (macOS: brew install arm-none-eabi-binutils; Debian and Ubuntu: apt install binutils-arm-none-eabi), make and a C compiler (Xcode's command line tools, or build-essential)"
  fi
}

# Duty 2: agbcc and old_agbcc in tools/agbcc/bin, built by agbcc's own build.sh and install.sh. In a git
# repository tools/agbcc is a submodule (.gitmodules): checked out when it is registered, else fetched at the pinned
# commit and registered (commit the result). Outside one it is fetched at the pinned commit.
setup_agbcc() {
  if [ -x "$AGBCC_DIR/bin/agbcc" ]; then
    return 0
  fi
  have git || die "git is needed to fetch agbcc into $AGBCC_DIR"
  if [ ! -f "$AGBCC_DIR/build.sh" ]; then
    if in_git && git ls-files --stage -- "$AGBCC_DIR" | grep -q '^160000'; then
      say "checking out the $AGBCC_DIR submodule"
      git submodule update --init -- "$AGBCC_DIR"
    else
      say "fetching agbcc $AGBCC_COMMIT from $AGBCC_URL"
      if [ -d "$AGBCC_DIR" ] && [ -n "$(ls -A "$AGBCC_DIR")" ]; then
        die "$AGBCC_DIR exists but holds no agbcc checkout: move it away and run ./setup.sh again"
      fi
      mkdir -p "$AGBCC_DIR"
      git -C "$AGBCC_DIR" init -q
      git -C "$AGBCC_DIR" remote add origin "$AGBCC_URL"
      git -C "$AGBCC_DIR" fetch -q --depth 1 origin "$AGBCC_COMMIT" 2>/dev/null || git -C "$AGBCC_DIR" fetch -q origin
      git -C "$AGBCC_DIR" checkout -q "$AGBCC_COMMIT"
      if in_git; then
        say "registering $AGBCC_DIR as a submodule at $AGBCC_COMMIT (commit .gitmodules and $AGBCC_DIR)"
        git submodule add -- "$AGBCC_PIN_URL" "$AGBCC_DIR" >/dev/null
      fi
    fi
  fi
  say "building agbcc and old_agbcc (a few minutes)"
  (cd "$AGBCC_DIR" && ./build.sh && ./install.sh ../..)
  [ -x "$AGBCC_DIR/bin/agbcc" ] && [ -x "$AGBCC_DIR/bin/old_agbcc" ] || die "agbcc did not build into $AGBCC_DIR/bin"
}

# Duty 3: the ROM. A new git worktree has none (it is never committed): copy it from the main worktree, the first
# entry of `git worktree list --porcelain`, at the same path inside it. Then check it against the SHA-1 file.
copy_baserom() {
  if [ ! -f "$ROM" ] && in_git; then
    main=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
    here=$(git rev-parse --show-toplevel)
    prefix=$(git rev-parse --show-prefix)
    if [ -n "$main" ] && [ -f "$main/$prefix$ROM" ] && [ "$(cd "$main" && pwd -P)" != "$(cd "$here" && pwd -P)" ]; then
      say "copying $ROM from the main worktree $main"
      cp "$main/$prefix$ROM" "$ROM"
    fi
  fi
  [ -f "$ROM" ] || die "$ROM is missing: put your own copy of the ROM there (it is never committed)"
  expected=$(cut -d ' ' -f 1 "$SHA1_FILE")
  actual=$(sha1_of "$ROM")
  [ "$actual" = "$expected" ] || die "$ROM has SHA-1 $actual, but $SHA1_FILE expects $expected"
}

# Duty 4: romlift, at the exact version package.json pins. Until romlift is on the npm registry, npm cannot install it:
# set ROMLIFT_CLI to a romlift checkout's command instead (see README.md).
install_romlift() {
  if [ -n "${ROMLIFT_CLI:-}" ]; then
    if [ -f package-lock.json ]; then
      say "ROMLIFT_CLI is set: not installing romlift with npm"
    else
      say "ROMLIFT_CLI is set: not installing romlift with npm, so package-lock.json stays unwritten"
    fi
    return 0
  fi
  have npm || die "npm is missing: install Node.js 24.7 or later"
  if [ -f package-lock.json ]; then
    npm ci || npm_failed
  else
    npm install || npm_failed
  fi
}

npm_failed() {
  die "npm could not install romlift. If it is not on the npm registry yet, build a romlift checkout (npm ci && npm run build) and run: ROMLIFT_CLI=\"node /path/to/romlift/dist/cli/main.js\" ./setup.sh"
}

# Duty 5: the generated tree (asm/, data/, ldscript.txt, symbols.ld, modules.mk), none of it in Git: when asm/ is
# absent (a fresh clone or worktree), or when romlift.toml is not the one modules.mk records (ROMLIFT_TOML_SHA1: a
# pull or a checkout changed it since the last generate).
generate_tree() {
  if [ -d asm ]; then
    recorded=$(sed -n 's/^ROMLIFT_TOML_SHA1 := //p' modules.mk 2>/dev/null || true)
    if [ -n "$recorded" ] && [ "$recorded" = "$(sha1_of romlift.toml)" ]; then
      return 0
    fi
    say "romlift.toml changed since the last romlift generate: running it"
  else
    say "asm/ is absent: running romlift generate"
  fi
  # shellcheck disable=SC2086 # ROMLIFT_CLI may be a command with arguments
  ${ROMLIFT_CLI:-npx romlift} generate
}

main() {
  check_toolchain
  setup_agbcc
  copy_baserom
  install_romlift
  generate_tree
  say "ready: run make"
}

main "$@"
