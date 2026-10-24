@ libfix, fix_stub.o: four BIOS call stubs of 4 bytes each, back to back (libagbsyscall's shape). Each alone has
@ too few bytes to be placed (fewer than the matcher's 12), and their bytes are common; in link order they tile
@ a run of 16 bytes, which sig.link-order-run places.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start FixSwiDiv
	swi 0x06
	bx lr
	func_end FixSwiDiv

	thumb_func_start FixSwiSqrt
	swi 0x08
	bx lr
	func_end FixSwiSqrt

	thumb_func_start FixSwiCpuSet
	swi 0x0B
	bx lr
	func_end FixSwiCpuSet

	thumb_func_start FixSwiHalt
	swi 0x02
	bx lr
	func_end FixSwiHalt
