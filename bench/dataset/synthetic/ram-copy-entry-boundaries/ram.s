@ main copies a block of ARM routines from the cartridge to IWRAM with CopyWords(source, destination,
@ end), a loop that runs the destination up to its third argument (`cmp r1, r2`), and reaches four
@ addresses of the block through load-and-jump veneers. Two of them test where an entry may open:
@ IwramTwoEntry_b is a second entry the code before it falls into (not a function: the ELF only labels
@ it), and IwramAfter starts right after IwramLoad's literal pool, a word that decodes as a conditional
@ ARM instruction. The block is linked at its load address after every other function, and IwramAfter
@ is its last routine, so nothing else finds it.
	.include "../common/macros.inc"
	.syntax unified
	.text
	.equ RAM_BASE, 0x03000000

	thumb_func_start main
	push {lr}
	ldr r0, =RamBlock
	ldr r1, =RAM_BASE
	ldr r2, .Lram_end
	bl CopyWords
	movs r0, #7
	bl Two_veneer
	bl Interior_veneer
	bl Load_veneer
	bl After_veneer
	pop {r1}
	bx r1
	.align 2, 0
.Lram_end:
	.word RAM_BASE + RamBlockEnd - RamBlock
	.pool
	func_end main

	thumb_func_start CopyWords
.Lcopy:
	cmp r1, r2
	bcs .Ldone
	ldmia r0!, {r3}
	stmia r1!, {r3}
	b .Lcopy
.Ldone:
	bx lr
	func_end CopyWords

	thumb_func_start Two_veneer
	ldr r3, .Lram_two
	bx r3
	func_end Two_veneer

	thumb_func_start Interior_veneer
	ldr r3, .Lram_interior
	bx r3
	func_end Interior_veneer

	thumb_func_start Load_veneer
	ldr r3, .Lram_load
	bx r3
	func_end Load_veneer

	thumb_func_start After_veneer
	ldr r3, .Lram_after
	bx r3
	func_end After_veneer
	.align 2, 0
.Lram_two:
	.word RAM_BASE + IwramTwoEntry - RamBlock
.Lram_interior:
	.word RAM_BASE + IwramTwoEntry_b - RamBlock
.Lram_load:
	.word RAM_BASE + IwramLoad - RamBlock
.Lram_after:
	.word RAM_BASE + IwramAfter - RamBlock

	.align 2, 0
RamBlock:
	arm_func_start IwramNegate
	rsb r0, r0, #0
	add r0, r0, #0
	bx lr
	func_end IwramNegate

	arm_func_start IwramTwoEntry
	add r0, r0, r0
IwramTwoEntry_b:
	add r0, r0, #1
	bx lr
	func_end IwramTwoEntry

	arm_func_start IwramLoad
	ldr r1, .Lk
	add r0, r0, r1
	bx lr
.Lk:
	.word 0x03001234
	func_end IwramLoad

	arm_func_start IwramAfter
	add r1, r0, r0
	add r0, r0, r1
	sub r0, r0, #3
	bx lr
	func_end IwramAfter
RamBlockEnd:

	.section .rodata
	@ Data after the code, so the ROM does not end at the code end.
	.word 0xFFFFFFFF, 0xFFFFFFFF
