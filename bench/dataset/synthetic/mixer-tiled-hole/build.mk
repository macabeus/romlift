# mixer-tiled-hole (rule-specific: gap.tiled-hole; also gap.tiled-hole-inner). Mixer and Mixer2 are
# unreferenced Thumb functions with an ARM routine (MixerArm, Mixer2Arm) inside their body, so their
# Thumb reading fails only for density; one that exactly fills the hole between accepted bytes is that
# hole's function. Mixer is the reading of its gap's first bytes (gap.tiled-hole): without that rule the
# forward scan first finds MixerArm ahead of its front pool, and Mixer is lost. Mixer2 comes after
# Leaf2 in its gap and is taken by the forward scan (gap.tiled-hole-inner); without it, the end-anchored
# scan of the same pass takes Mixer2's tail as a false entry, and Mixer2 then overlaps claimed code.
# The ARM routines are then found in the holes (gap.arm-scan).
# Startup: _start and start_vector (common/crt0.s); entries counted from main on.
NAME := mixer-tiled-hole
SRCS := mixer.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
