# The shared build rules of the synthetic fixtures (architecture §8.1, D28). A fixture's build.mk sets
# NAME, SRCS (its sources in link order: .s assembled with binutils, .c compiled by agbcc first) and
# the toolchain record, then includes this file. `npm run fixtures -- rebuild|check` runs
#
#   make -f build.mk BUILD=<dir> AGBCC=<agbcc> ARM_AS=<as> ARM_LD=<ld> ARM_OBJCOPY=<objcopy>
#
# from the fixture's directory, so every source path the objects record is relative.
BUILD ?= build
AGBCC ?= agbcc
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

$(BUILD)/%.c.s: %.c | $(BUILD)
	$(AGBCC) $(CFLAGS) $< -o $@

$(BUILD):
	mkdir -p $@
