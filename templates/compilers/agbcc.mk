# mk/agbcc.mk: the recipe of a C unit built with agbcc (modules.mk: `build/src/<module>.o: CC1 := tools/agbcc/bin/agbcc`).
# The host C preprocessor writes build/src/<module>.i (and its header dependencies), agbcc compiles it with the
# object's CFLAGS (modules.mk) into build/src/<module>.s, and the assembler builds the object (and the dependencies
# on the INCLUDE_ASM files). romlift init wrote this file once; edit it to change how every agbcc unit is built.
define C_RECIPE_agbcc
$(HOSTCC) $(CPPFLAGS) -MD -MP -MF $(@:.o=.c.d) -MT $@ -o $(@:.o=.i) $<
$(CC1) $(CFLAGS) -o $(@:.o=.s) $(@:.o=.i)
$(AS) $(ASFLAGS) --MD $(@:.o=.d) -o $@ $(@:.o=.s)
endef
