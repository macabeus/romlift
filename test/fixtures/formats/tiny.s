@ A self-authored assembly file for the ELF and GNU map parser tests (no ROM bytes).
@ It holds one ARM function, two Thumb functions (the second at an address that is 2 mod 4),
@ a local symbol, a data object with .type and .size in a section with a long name (so that ld
@ wraps its line in the map), and an initialised RAM variable whose load address is in ROM.
@ Rebuild with build.sh; the committed tiny.elf and tiny.map are its outputs.

    .syntax unified

    .text
    .arm
    .align 2
    .global arm_entry
    .type arm_entry, %function
arm_entry:
    mov r0, #0
    bx lr
    .size arm_entry, .-arm_entry

    .thumb
    .global thumb_one
    .type thumb_one, %function
    .thumb_func
thumb_one:
    movs r0, #1
tiny_local:
    adds r0, #1
    bx lr
    .size thumb_one, .-thumb_one

    .global thumb_two
    .type thumb_two, %function
    .thumb_func
thumb_two:
    push {lr}
    bl lib_helper
    pop {r0}
    bx r0
    .size thumb_two, .-thumb_two

    .section .rodata.tiny_section_with_a_long_name, "a", %progbits
    .align 2
    .global tiny_table
    .type tiny_table, %object
    .size tiny_table, 8
tiny_table:
    .4byte thumb_one
    .4byte arm_entry

    .data
    .align 2
    .global tiny_counter
    .type tiny_counter, %object
    .size tiny_counter, 4
tiny_counter:
    .4byte 7
