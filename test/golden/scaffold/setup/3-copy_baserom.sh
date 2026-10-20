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
