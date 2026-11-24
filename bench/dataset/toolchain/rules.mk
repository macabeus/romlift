# The shared build rules of the toolchain references (architecture §7.2, D123). A toolchain reference is a small
# image that links a whole library archive of a compiler's own installation, so the signature builder reads every
# member of the library, including those no benchmark game links. Nothing of it is committed but its recipe: the
# image is built locally into bench/.local/toolchain/<name>/ by `npm run toolchain -- build`, which runs
#
#   make -f build.mk BUILD=<dir> LIBDIR=<dir> ARM_AS=<as> ARM_LD=<ld> ARM_OBJCOPY=<objcopy>
#
# from the reference's directory. A reference's build.mk sets, then includes this file:
#   NAME       the reference's name, its directory's
#   TOOLCHAIN  the compiler installation the archive comes from, a key of bench/src/toolchain-refs.ts TOOLCHAINS;
#              the tool reads this line and gives LIBDIR, that installation's library directory
#   ARCHIVE    the archive linked whole, relative to LIBDIR
#   LIBS       archives linked for what ARCHIVE needs, relative to LIBDIR
#   SRCS       assembly sources defining what neither gives (the entry's `main`, the system's own calls)
# No rule names a compiler: a reference of another compiler's library sets another TOOLCHAIN.
BUILD ?= build
LIBS ?=
# Not AS, LD or OBJCOPY: make predefines those, so `?=` would never apply.
ARM_AS ?= arm-none-eabi-as
ARM_LD ?= arm-none-eabi-ld
ARM_OBJCOPY ?= arm-none-eabi-objcopy

# The cartridge start and the linker script are the synthetic fixtures' (bench/dataset/synthetic/common).
COMMON := ../../synthetic/common
ASFLAGS := -mcpu=arm7tdmi

OBJS := $(BUILD)/crt0.o $(addprefix $(BUILD)/,$(addsuffix .o,$(basename $(SRCS))))

.PHONY: all
all: $(BUILD)/$(NAME).gba

$(BUILD)/$(NAME).gba: $(BUILD)/$(NAME).elf
	$(ARM_OBJCOPY) -O binary $< $@

$(BUILD)/$(NAME).elf: $(OBJS) $(COMMON)/rom.ld $(LIBDIR)/$(ARCHIVE) $(addprefix $(LIBDIR)/,$(LIBS))
	$(ARM_LD) -T $(COMMON)/rom.ld -Map $(BUILD)/$(NAME).map -o $@ $(OBJS) \
		--whole-archive $(LIBDIR)/$(ARCHIVE) --no-whole-archive $(addprefix $(LIBDIR)/,$(LIBS))

$(BUILD)/crt0.o: $(COMMON)/crt0.s | $(BUILD)
	$(ARM_AS) $(ASFLAGS) -o $@ $<

$(BUILD)/%.o: %.s | $(BUILD)
	$(ARM_AS) $(ASFLAGS) -o $@ $<

$(BUILD):
	mkdir -p $@
