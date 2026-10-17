@ The shared cartridge start of every synthetic fixture (architecture §8.1, D28): an ARM `b` at
@ 0x08000000 over a GBA header that romlift's checkRom accepts (the fixed byte 0x96 at 0xB2 and the
@ header complement at 0xBD; the logo area is left zero, since nothing in romlift reads it), then the
@ startup code at 0x080000C0, which sets the IRQ and system stacks and calls `main` through a pool
@ pointer with `mov lr, pc; bx r1`.
@
@ Startup symbols: `_start` (0x08000000) and `start_vector` (0x080000C0) are FUNC symbols of the
@ startup region (the cartridge entry and the code it branches to, PoC `startup` getter); the bench
@ counts a fixture's functions from the end of that region on, so no expect.json lists them.
	.syntax unified
	.text
	.arm

	.global _start
	.type _start, %function
_start:
	b start_vector
	.size _start, .-_start

	@ 0x04-0x9F: the logo area, zero.
	.space 0x9C, 0
	@ 0xA0: title (12), game code (4), maker code (2).
	.ascii "ROMLIFTFIXTR"
	.ascii "RLFX"
	.ascii "01"
	.byte 0x96		@ 0xB2: the fixed value
	.byte 0			@ 0xB3: main unit code
	.byte 0			@ 0xB4: device type
	.space 7, 0		@ 0xB5-0xBB: reserved
	.byte 0			@ 0xBC: software version
	.byte 0x0A		@ 0xBD: complement of 0xA0-0xBC (-(sum) - 0x19) & 0xFF
	.space 2, 0		@ 0xBE-0xBF: reserved

	.global start_vector
	.type start_vector, %function
start_vector:
	mov r0, #0x12		@ IRQ mode
	msr cpsr_fc, r0
	ldr sp, =0x03007FA0
	mov r0, #0x1F		@ system mode
	msr cpsr_fc, r0
	ldr sp, =0x03007F00
	ldr r1, =main
	mov lr, pc
	bx r1
	b start_vector
	.pool
	.size start_vector, .-start_vector
