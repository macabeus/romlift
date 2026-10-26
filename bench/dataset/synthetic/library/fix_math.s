@ libfix, fix_math.o: the self-authored library of the signature fixtures (architecture §7, §8.1). Both members
@ are long and distinctive, so the matcher places them by sig.unique-fit; FixMulShift's `bl FixClamp` is masked
@ (00 f8 00 f8), since the link changes it.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start FixMulShift
	push {r4, r5, lr}
	adds r4, r0, #0
	muls r4, r1
	asrs r4, r4, #8
	movs r5, #0x3f
	ands r5, r4
	adds r0, r4, #0
	adds r1, r5, #0
	bl FixClamp
	pop {r4, r5}
	pop {r1}
	bx r1
	func_end FixMulShift

	thumb_func_start FixClamp
	cmp r0, r1
	ble .LFixClamp_done
	adds r0, r1, #0
.LFixClamp_done:
	lsls r0, r0, #16
	asrs r0, r0, #16
	bx lr
	func_end FixClamp
