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
  have npm || die "npm is missing: install Node.js 22.18 or later"
  if [ -f package-lock.json ]; then
    npm ci || npm_failed
  else
    npm install || npm_failed
  fi
}
