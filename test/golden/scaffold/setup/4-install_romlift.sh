# Duty 4: romlift, at the exact version package.json pins.
install_romlift() {
  if [ -n "${ROMLIFT_CLI:-}" ]; then
    say "ROMLIFT_CLI is set: not installing romlift with npm"
    return 0
  fi
  have npm || die "npm is missing: install Node.js 22.18 or later"
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
}
