@ Three blocks of data inside the code, each named by one word of a command table in .rodata (an odd
@ word, as a Thumb pointer would be), each decoding as a Thumb frame: `push {lr}` on a word boundary.
@ None is a function (the ELF types them OBJECT). FrameNoCall pushes and pops with no call; FrameStrayCall
@ calls Helper and then the middle of Helper (code, but no function); FrameNoReturn calls Helper and branches away without returning.
@ accept.prologue-and-calls-accepted must take none of them: its sign is a frame, a return and calls that
@ all land on accepted functions, and each block misses one of the three.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	bl Helper
	bl Last
	pop {r0}
	bx r0
	func_end main

	thumb_func_start Helper
	movs r0, #1
	bx lr
	func_end Helper

	.align 2, 0
Data1:
	.word 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF

	.thumb
	.type FrameNoCall, %object
FrameNoCall:
	push {lr}
	movs r0, #1
	pop {pc}
	.size FrameNoCall, .-FrameNoCall

	.align 2, 0
Data2:
	.word 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF

	.type FrameStrayCall, %object
FrameStrayCall:
	push {lr}
	bl Helper
	bl Helper + 2
	pop {pc}
	.size FrameStrayCall, .-FrameStrayCall

	.align 2, 0
Data3:
	.word 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF

	.type FrameNoReturn, %object
FrameNoReturn:
	push {lr}
	bl Helper
.Lspin:
	b .Lspin
	.size FrameNoReturn, .-FrameNoReturn

	.align 2, 0
Data4:
	.word 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF

	thumb_func_start Last
	movs r0, #2
	bx lr
	func_end Last

	.section .rodata
	.align 2, 0
Commands:
	.word 0x00000001, FrameNoCall + 1, 0x00000002, FrameStrayCall + 1, 0x00000003, FrameNoReturn + 1, 0x00000000
