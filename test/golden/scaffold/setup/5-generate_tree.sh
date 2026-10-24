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
