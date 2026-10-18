@ Function-start and -end macros of the synthetic fixtures, as romlift's dialect spells them
@ (src/foundation/asm/dialect.ts): word alignment with zero fill unless the entry is at 2 mod 4.
	.macro thumb_func_start name
	.align 2, 0
	.global \name
	.thumb
	.thumb_func
	.type \name, %function
\name:
	.endm

	.macro non_word_aligned_thumb_func_start name
	.global \name
	.thumb
	.thumb_func
	.type \name, %function
\name:
	.endm

	.macro arm_func_start name
	.align 2, 0
	.global \name
	.arm
	.type \name, %function
\name:
	.endm

	.macro func_end name
	.size \name, .-\name
	.endm
