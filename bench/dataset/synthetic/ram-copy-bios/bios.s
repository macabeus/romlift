@ main copies two blocks of ARM routines from the cartridge to IWRAM with the BIOS: block A with CpuSet in
@ 32-bit units (r2 = 0x04000000 | word count, pret's CpuCopy32) and block B with CpuFastSet (r2 = word
@ count), each through a library stub that is the swi and a return. It then calls one routine of each
@ block through a load-and-jump veneer naming its IWRAM address. Both blocks are linked at their load
@ address after every other function, so no ROM address names them: seed.ram-copy must read the size off
@ the control word, never take r2 for a byte count.
	.include "../common/macros.inc"
	.syntax unified
	.text
	.equ RAM_A, 0x03000000
	.equ RAM_B, 0x03000400

	thumb_func_start main
	push {lr}
	ldr r0, =BlockA
	ldr r1, =RAM_A
	ldr r2, .Lcontrol_a
	bl CpuSet
	ldr r0, =BlockB
	ldr r1, =RAM_B
	ldr r2, .Lcontrol_b
	bl CpuFastSet
	movs r0, #7
	bl Double_veneer
	bl Triple_veneer
	pop {r1}
	bx r1
	.align 2, 0
.Lcontrol_a:
	.word 0x04000000 + (BlockAEnd - BlockA) / 4
.Lcontrol_b:
	.word (BlockBEnd - BlockB) / 4
	.pool
	func_end main

	thumb_func_start CpuSet
	swi 0xb
	bx lr
	func_end CpuSet

	thumb_func_start CpuFastSet
	swi 0xc
	bx lr
	func_end CpuFastSet

	thumb_func_start Double_veneer
	ldr r3, .Lram_double
	bx r3
	func_end Double_veneer

	thumb_func_start Triple_veneer
	ldr r3, .Lram_triple
	bx r3
	func_end Triple_veneer
	.align 2, 0
.Lram_double:
	.word RAM_A + IwramDouble - BlockA
.Lram_triple:
	.word RAM_B + IwramTriple - BlockB

	.align 2, 0
BlockA:
	arm_func_start IwramNegate
	rsb r0, r0, #0
	add r0, r0, #0
	bx lr
	func_end IwramNegate

	arm_func_start IwramDouble
	add r0, r0, r0
	add r0, r0, #1
	bx lr
	func_end IwramDouble
BlockAEnd:

	.align 2, 0
BlockB:
	arm_func_start IwramSquare
	mul r1, r0, r0
	mov r0, r1
	bx lr
	func_end IwramSquare

	arm_func_start IwramTriple
	add r1, r0, r0
	add r0, r0, r1
	sub r0, r0, #1
	bx lr
	func_end IwramTriple
	.word 0, 0, 0
BlockBEnd:

	.section .rodata
	@ Data after the code, so the ROM does not end at the code end. Block B is 10 words, which is not a
	@ multiple of 8: CpuFastSet moves 16 (it rounds the count up to blocks of eight words), so the BIOS
	@ reads 24 bytes of this data too and the ROM must hold them.
	.word 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF
