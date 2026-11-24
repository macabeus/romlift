@ What the whole libc.a leaves undefined: `main`, which the cartridge start calls, the system calls its syscalls.o
@ does not implement, and `end`, the heap's start. Each function only returns: nothing runs this image.
	.syntax unified
	.text

	.macro stub name
	.global \name
	.thumb_func
	.type \name, %function
\name:
	bx lr
	.size \name, .-\name
	.endm

	stub main
	stub _fcntl
	stub _link
	stub _execve
	stub _fork
	stub _wait
	stub _stat

	.bss
	.global end
end:
	.space 4
