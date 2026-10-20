# Duty 5: the generated tree (asm/, data/, ldscript.txt, symbols.ld, modules.mk), when asm/ is absent.
generate_tree() {
  if [ -d asm ]; then
    return 0
  fi
  say "asm/ is absent: running romlift generate"
  # shellcheck disable=SC2086 # ROMLIFT_CLI may be a command with arguments
  ${ROMLIFT_CLI:-npx romlift} generate
}
