# data-frame-not-function (negative; data named by data that decodes as a Thumb frame). Three blocks of
# data between data, each named by one odd word of a command table and decoding as `push {lr}` on a word
# boundary: FrameNoCall makes no call, FrameStrayCall calls Helper and the middle of Helper, FrameNoReturn calls
# Helper and spins. seed.data-pointer proposes all three; accept.prologue-and-calls-accepted must
# take none (its call clause, its "every call" clause and its return clause each decline one), and no
# other rule takes them.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := data-frame-not-function
SRCS := data.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
