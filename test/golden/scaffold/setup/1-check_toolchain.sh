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
