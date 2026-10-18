@ main copies a block of ARM routines from the cartridge to IWRAM with CopyBytes(dest, src, n), memcpy's
@ argument order (copy.c, compiled by agbcc), and calls two of them through load-and-jump veneers that
@ name their IWRAM addresses. The block is linked at its load address after every other function, so
@ no ROM address names it: seed.ram-copy must take the destination from r0 and the source from r1,
@ which it reads off what CopyBytes does (it loads through r1 and stores through r0).
	.include "../common/macros.inc"
	.syntax unified
	.text
	.equ RAM_BASE, 0x03000000

	thumb_func_start main
	push {lr}
	ldr r1, =RamBlock
	ldr r0, =RamBlockEnd
	subs r2, r0, r1
	ldr r0, =RAM_BASE
	bl CopyBytes
	movs r0, #7
	bl Double_veneer
	bl Triple_veneer
	pop {r1}
	bx r1
	.align 2, 0
	.pool
	func_end main
