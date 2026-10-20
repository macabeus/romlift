# The shared build rules of the synthetic fixtures (architecture §8.1, D28). A fixture's build.mk sets
# NAME, SRCS (its sources in link order: .s assembled with binutils, .c compiled by agbcc first) and
# the toolchain record, then includes this file. `npm run fixtures -- rebuild|check` runs
#
#   make -f build.mk BUILD=<dir> AGBCC=<agbcc> OLD_AGBCC=<old_agbcc> ARM_AS=<as> ARM_LD=<ld> ARM_OBJCOPY=<objcopy>
#
# from the fixture's directory, so every source path the objects record is relative.
#
# Two compilers, both built from the one recorded pret/agbcc commit: a .c source is compiled by agbcc,
# or by old_agbcc when build.mk lists it in OLD_AGBCC_SRCS (`OLD_AGBCC_SRCS := x.c`, set before the
# include). A source's own flags, appended to CFLAGS, are CFLAGS_<stem> (`CFLAGS_x := -mno-thumb-interwork`).
BUILD ?= build
AGBCC ?= agbcc
# old_agbcc beside agbcc: the same directory, the name with the `old_` prefix.
OLD_AGBCC ?= $(patsubst %agbcc,%old_agbcc,$(AGBCC))
OLD_AGBCC_SRCS ?=
# Not AS, LD or OBJCOPY: make predefines those, so `?=` would never apply.
ARM_AS ?= arm-none-eabi-as
ARM_LD ?= arm-none-eabi-ld
ARM_OBJCOPY ?= arm-none-eabi-objcopy

COMMON := ../common
ASFLAGS := -mcpu=arm7tdmi
# agbcc reads C without a preprocessor, so fixture C has no comments and no directives.
CFLAGS := -O2 -mthumb-interwork -fhex-asm

OBJS := $(BUILD)/crt0.o $(addprefix $(BUILD)/,$(addsuffix .o,$(basename $(SRCS))))

.PHONY: all
all: $(BUILD)/$(NAME).gba

$(BUILD)/$(NAME).gba: $(BUILD)/$(NAME).elf
	$(ARM_OBJCOPY) -O binary $< $@

$(BUILD)/$(NAME).elf: $(OBJS) $(COMMON)/rom.ld
	$(ARM_LD) -T $(COMMON)/rom.ld -o $@ $(OBJS)

$(BUILD)/crt0.o: $(COMMON)/crt0.s | $(BUILD)
	$(ARM_AS) $(ASFLAGS) -o $@ $<

$(BUILD)/%.o: %.s | $(BUILD)
	$(ARM_AS) $(ASFLAGS) -o $@ $<

$(BUILD)/%.o: $(BUILD)/%.c.s
	$(ARM_AS) $(ASFLAGS) -o $@ $<

# The compiler of a .c source: old_agbcc for the sources OLD_AGBCC_SRCS lists, agbcc for every other.
cc1_of = $(if $(filter $(1),$(OLD_AGBCC_SRCS)),$(OLD_AGBCC),$(AGBCC))

$(BUILD)/%.c.s: %.c | $(BUILD)
	$(call cc1_of,$<) $(CFLAGS) $(CFLAGS_$*) $< -o $@

$(BUILD):
	mkdir -p $@
