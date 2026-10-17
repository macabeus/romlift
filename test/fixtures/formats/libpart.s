@ The archive member of the fixture: build.sh puts it in libtiny.a, so the map names it as
@ libtiny.a(libpart.o). Self-authored; no ROM bytes.

    .syntax unified
    .text
    .thumb
    .global lib_helper
    .type lib_helper, %function
    .thumb_func
lib_helper:
    movs r0, #2
    bx lr
    .size lib_helper, .-lib_helper
