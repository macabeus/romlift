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
