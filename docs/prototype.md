# Prototype

> Exported from the Prototype tab of the Claude Docs artifact <https://claude.ai/code/artifact/7963dcce-e818-490a-a959-ca96941bdc23> (revision 2, 2026-10-17). "This repo" / "this repository" in the text means the Klonoa decomp repository (klonoa-empire-of-dreams), where the notes were written.

Two generations: a TypeScript proof of concept that is the current state of the analysis and scaffold, and the 561-line Python script it grew from, kept below for the record.

## Proof of concept (romlift-poc)

A Node 22 / TypeScript port of the prototype at `~/ApenasMeu/decompiler/romlift-poc`, split into `rom`, `thumb`, `arm`, `analysis`, `truth`, `score`, `emit` and `cli`. It reproduces the Python numbers exactly, runs about ten times faster, and adds the rules below plus a scaffold.

```sh
npm install
npm run romlift -- score ../kleod/baserom.gba ../kleod/kleod.elf -v   # every miss with the test it fails
npm run romlift -- init ../sa2/sa2.gba out/sa2 && (cd out/sa2 && make)  # rebuilds sa2.gba and checks its SHA-1
```

### Scores

| ROM | ELF functions | Python prototype | Proof of concept | Missed | False |
| --- | --- | --- | --- | --- | --- |
| Klonoa (kleod) | 562 | 99.63% / 94.66% | 99.82% / 99.47% | 3 | 1 |
| Sonic Advance 2 | 2,893 | 99.83% / 99.10% | 99.72% / 100.00% | 0 | 8 |
| Sonic Advance 3 | 4,694 | 99.89% / 99.45% | 99.83% / 100.00% | 0 | 8 |
| Fire Emblem 7 (J) | 7,736 | 99.82% / 99.47% | 99.81% / 99.86% | 11 | 15 |
| Pokémon Emerald | 15,856 | 99.96% / 99.78% | 99.90% / 100.00% | 0 | 16 |

Values are precision / recall of function entries. The 14 misses are labels typed as functions: kleod's three names inside `SoundMainRAM`, and eleven FE7J continuations that begin after a never-returning call or at a loop branch and use registers the preceding code set.

### Rules added, in order of payoff

| Rule | Found |
| --- | --- |
| Pointer-table evidence: a valid candidate pointed at by a run of three or more Thumb pointers to valid targets | the m4a `ply_*` handlers on every ROM |
| A branch into another function leaves the current one and counts as a return | `ply_rept`, `MP2K_event_patt`, ARM `PutOamLo` |
| A `swi` followed by non-code, and a `mov pc, rN` with no table, end the function | `SoftReset`, `VBlankIntr`, the multiboot handler |
| Extent = code plus adjacent pools; far pools claimed but excluded; zero padding before a pool counts as covered | `m4aSoundVSync`, `MPlayMain`, `Cmd_getsecretpowereffect` |
| Tiled hole: a gap's head reading that ends at the next function is accepted though not dense or unbalanced, and the gap waits for that anchor | `SoundMainRAM` on all five ROMs |
| ARM gap scan with front pools and tables, internal holes when it fills the gap, preferred over a prologue-less Thumb reading | the heap, OAM and map-flood routines |
| Runs of Thumb code pointers are tables; tiny unreferenced candidates must be anchored and not open with a branch | a 146-byte table in Emerald; ten 2-byte stubs in FE7J |
| Candidate readings recomputed each round | the Emerald mixer's end anchor |

### Scaffold

`init` tiles the code region into one chunk per function, folds entries that fall inside another function's extent, names the bytes between functions `unk_XXXXXXXX`, and writes `asm/nonmatchings/main/<name>.s` (original bytes as `.2byte`/`.4byte` under the function macro), `asm/main.s`, `asm/rom_header.s`, `data/data.s`, `ldscript.txt`, `Makefile`, `baserom.sha1` and `romlift.toml`. `make` needs only `arm-none-eabi-as`, `ld` and `objcopy`.

| Project | Functions | Gap chunks | Code ends | `make` |
| --- | --- | --- | --- | --- |
| Klonoa | 559 | 91 | `0x08051BD4` | OK |
| Sonic Advance 2 | 2,900 | 468 | `0x080979F8` | OK |
| Sonic Advance 3 | 4,701 | 886 | `0x080CE438` | OK |
| Fire Emblem 7 | 7,739 | 1,563 | `0x080C0C50` | OK |
| Pokémon Emerald | 15,871 | 3,231 | `0x082E9530` | OK |

The match is by construction, since every chunk is data. It proves the tiling, the linker script and the build loop; the instruction printer and the C stubs are still to do.

## Python prototype, second version

## How to run

```sh
arm-none-eabi-readelf -sW kleod.elf | grep ' FUNC ' | grep -v ' UND ' | awk '{print $2, $3, $5, $8}' > funcs.txt
python3 romlift_prototype2.py baserom.gba funcs.txt functions_merged.cfg
```

Add `-v` to list every false and missed entry. The cfg argument is optional and only used for the last three lines of output.

## Scores on five ROMs

Measured on an Apple M1 Max with Python 3.13. Everything except the timing is identical across runs.

| ROM | ELF functions | Entries found | Precision | Recall | False | Missed | Time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Klonoa: Empire of Dreams | 562 | 534 | 99.63% | 94.66% | 2 | 30 | 3.9 s |
| Sonic Advance 2 | 2,902 | 2,872 | 99.86% | 98.83% | 4 | 34 | 4.3 s |
| Sonic Advance 3 | 4,690 | 4,673 | 99.81% | 99.45% | 9 | 26 | 5.4 s |
| Fire Emblem 7 (Japan) | 7,736 | 7,709 | 99.82% | 99.47% | 14 | 41 | 3.7 s |
| Pokémon Emerald | 15,856 | 15,828 | 99.96% | 99.78% | 7 | 35 | 22.1 s |

The ELFs are the ones in the local kleod, sa2, sa3, FireEmblem7J and pokeemerald checkouts.

## Where it is still wrong

| ROM | Missed | False |
| --- | --- | --- |
| Klonoa | 27 in the m4a sound engine; 3 unreferenced ARM helpers | 2 labels inside the m4a engine |
| Sonic Advance 2 | 30 in the m4a engine; 2 ARM serial routines, `VBlankIntr`, `SoftReset` | 2 in the m4a engine; the ROM entry and startup code |
| Sonic Advance 3 | 22 in the m4a engine; 2 serial routines, `VBlankIntr`, `SoftReset` | 3 in the m4a engine; the ROM entry and startup code; 3 stubs from the gap scan; 1 data pointer |
| Fire Emblem 7 | 27 in the m4a engine; 7 ARM routines that run from RAM; 7 other functions | 4 in the m4a engine; the ROM entry, startup code and interrupt entry; 6 veneers; 1 other |
| Pokémon Emerald | 23 in the m4a engine and multiboot code; 10 in the link library; 2 other functions | 3 in the m4a engine; the ROM entry, startup code and 2 interrupt entries |

The ROM entry, startup code, interrupt entries and veneers are real code. They count as false only because those ELFs do not type them as functions.

## Output on Klonoa

```text
534 entries (519 Thumb, 15 ARM) in 3.9s
  code region 08000000..08051BD4: code 278660, literal pool 39112, jump table 12876, unclassified 4156 (2260 zero padding, the rest in 29 gaps)
  bl sites: 2564, far jumps: 560 in 17 functions; jump tables: 67 with 3219 entries
  found by: {'adr': 1, 'call': 241, 'data pointer': 158, 'gap scan': 70, 'pool pointer': 55, 'rom entry': 2, 'startup pointer': 1, 'veneer': 6}
  no direct caller: {'adr': 1, 'data pointer': 156, 'gap scan': 65, 'pool pointer': 53, 'rom entry': 2, 'startup pointer': 1, 'veneer': 6}
  truth 562: precision 99.63%, recall 94.66% (2 false, 30 missed)
  extent equals the ELF size for 485 of 485 sized functions found
  code end found 08051BD4; last ELF function ends at 08051BD0
  false entries found by: {'call': 1, 'gap scan': 1}
  cfg entries: 662; functions in the ELF: 379; not functions in the ELF: 283
    of those 283: inside a function found here 282, at a 2-mod-4 address 103
  ELF functions missing from the cfg: 183
```

## What it implements

- Thumb and ARM decoding for control flow only.
- Recursive descent per function, with literal pools taken from PC-relative loads.
- The call, far-jump and no-return decisions for every `bl`.
- Table jumps, resolved from the nearest table load before `mov pc`.
- `bx pc` veneers, ARM routines named by `adr`, and tail branches into other functions.
- Pointer harvest from literal pools and from every aligned word in the ROM, with the validity and evidence tests.
- A gap scan that chains unreferenced functions from both ends of a gap.

## What it leaves out

- Instruction text, labels and any output file. It finds entries and extents, and stops there.
- Register tracking for table jumps, and ARM jump tables.
- A gap scan for ARM code, and any model of code that is copied to RAM.
- Library signatures. Nearly all its misses are in the m4a engine, which a signature pack would name.
- Shared tails and local subroutines in hand-written code.

It is a measurement, not the base of the tool. Phase 2 has to reproduce or beat these scores from the real analysis engine, and then pass on ROMs these rules have never seen.

## Source

```python
#!/usr/bin/env python3
'''Throwaway prototype, second version: zero-config static recovery of the function entries in a
GBA ROM, scored against the FUNC symbols of a matching ELF.

  python3 romlift_prototype2.py rom.gba [funcs.txt [functions.cfg]] [-v]

funcs.txt comes from the ELF that rebuilds the ROM:
  arm-none-eabi-readelf -sW rom.elf | grep ' FUNC ' | grep -v ' UND ' | awk '{print $2, $3, $5, $8}'
Rules follow agbcc's Thumb back end (gcc/thumb.md, gcc/thumb.h): `bl` is also a far jump, switch
tables are `.word` lists reached through `mov pc, rN`, and `push {.., lr}` only opens a function.
'''
import collections
import struct
import sys
import time

sys.setrecursionlimit(20000)
ROM = open(sys.argv[1], 'rb').read()
BASE, N = 0x08000000, len(ROM)
u16 = lambda a: struct.unpack_from('<H', ROM, a - BASE)[0]
u32 = lambda a: struct.unpack_from('<I', ROM, a - BASE)[0]
in_rom = lambda a: BASE <= a < BASE + N
popcount = lambda x: bin(x).count('1')
FAR_MIN = 1536   # agbcc needs bl-as-jump only beyond `b` range; the shortest seen in five ROMs is 1,960


def tdec(a):
    '''Thumb (ARMv4T) decode, control flow only: (kind, length, argument).'''
    hw = u16(a)
    top5 = hw >> 11
    if top5 == 0b11110:
        if a + 4 <= BASE + N and (u16(a + 2) >> 11) == 0b11111:
            off = ((hw & 0x7FF) << 12) | ((u16(a + 2) & 0x7FF) << 1)
            return ('bl', 4, a + 4 + (off - 0x800000 if off & 0x400000 else off))
        return ('invalid', 2, None)
    if top5 in (0b11111, 0b11101):
        return ('invalid', 2, None)
    if top5 == 0b11100:
        off = hw & 0x7FF
        return ('b', 2, a + 4 + ((off - 0x800 if off & 0x400 else off) << 1))
    if (hw >> 12) == 0b1101:
        cond = (hw >> 8) & 0xF
        if cond == 0xF:
            return ('swi', 2, hw & 0xFF)
        if cond == 0xE:
            return ('invalid', 2, None)
        off = hw & 0xFF
        return ('bcc', 2, a + 4 + ((off - 0x100 if off & 0x80 else off) << 1))
    if (hw & 0xFF00) == 0x4700:
        return ('invalid', 2, None) if hw & 0x80 else ('bx', 2, (hw >> 3) & 0xF)
    if (hw & 0xFE00) == 0xBC00:
        return ('pop_pc', 2, None) if hw & 0x100 else ('pop', 2, hw & 0xFF)
    if (hw & 0xFE00) == 0xB400:
        return ('push', 2, hw & 0x1FF)
    if (hw & 0xFF00) == 0xB000:
        return ('other', 2, None)
    if (hw & 0xF000) == 0xB000:
        return ('invalid', 2, None)
    if (hw & 0xF800) == 0x4800:
        return ('ldr_pc', 2, ((a + 4) & ~3) + ((hw & 0xFF) << 2))
    if (hw & 0xFC00) == 0x4400 and ((hw & 7) | ((hw >> 4) & 8)) == 15 and ((hw >> 8) & 3) in (0, 2):
        rm = (hw >> 3) & 0xF
        return ('bx', 2, rm) if rm == 14 and ((hw >> 8) & 3) == 2 else ('mov_pc', 2, rm)   # mov pc, lr returns
    return ('other', 2, None)


def adec(a):
    '''ARM decode, control flow only: (kind, argument, condition).'''
    w = u32(a)
    cond = w >> 28
    if cond == 0xF:
        return ('invalid', None, cond)
    if (w & 0x0FFFFFF0) == 0x012FFF10:
        return ('bx', w & 0xF, cond)
    if (w & 0x0E000000) == 0x0A000000:
        off = w & 0xFFFFFF
        return ('bl' if w & 0x01000000 else 'b', a + 8 + ((off - 0x1000000 if off & 0x800000 else off) << 2), cond)
    if (w & 0x0F000000) == 0x0F000000:
        return ('swi', None, cond)
    if (w & 0x0F7F0000) == 0x051F0000:
        return ('ldr_pc', a + 8 + ((w & 0xFFF) if (w >> 23) & 1 else -(w & 0xFFF)), cond)
    if (w & 0x0FFF0000) in (0x028F0000, 0x024F0000):
        rot, imm8 = ((w >> 8) & 0xF) * 2, w & 0xFF
        imm = ((imm8 >> rot) | (imm8 << (32 - rot))) & 0xFFFFFFFF if rot else imm8
        return ('adr', a + 8 + (imm if (w & 0x0FFF0000) == 0x028F0000 else -imm), cond)
    writes_pc = ((w >> 12) & 0xF) == 0xF
    is_multiply = (w & 0x02000000) == 0 and (w & 0x90) == 0x90
    if (w & 0x0C000000) == 0 and writes_pc and ((w >> 21) & 0xF) not in (8, 9, 10, 11) and not is_multiply:
        return ('pc_write', None, cond)
    if ((w & 0x0C100000) == 0x04100000 and writes_pc) or ((w & 0x0E100000) == 0x08100000 and w & 0x8000):
        return ('pc_write', None, cond)
    if (w & 0x0E000000) == 0x0C000000 or (w & 0x0F000000) == 0x0E000000 or (w & 0x0E000010) == 0x06000010:
        return ('invalid', None, cond)
    return ('other', None, cond)


class Func:
    def __init__(self, entry, mode):
        self.entry, self.mode = entry, mode
        self.insns = {}        # address -> length
        self.pools = {}        # literal-pool word address -> value
        self.tables = {}       # jump-table base -> targets
        self.calls = set()     # (target, mode, site)
        self.bl_sites = []     # (site, target), undecided: call or far jump
        self.dead_end = set()  # bl sites followed by non-code
        self.balance = []      # stack delta at each return
        self.returns = 0
        self.errors = []
        self.veneers = set()
        self.adrs = set()

    @property
    def code_end(self):
        return max((a + n for a, n in self.insns.items()), default=self.entry)

    @property
    def end(self):
        return max([self.code_end] + [p + 4 for p in self.pools] + [b + 4 * len(t) for b, t in self.tables.items()])


funcs, origin, settled, in_progress = {}, {}, {}, set()
claimed = bytearray(N)   # 0 free, 1 code, 2 literal pool, 3 jump table


def analyze_thumb(entry, far, noret):
    '''Recursive descent. far: bl sites that are jumps. noret: bl sites that never return.
    A branch to another accepted function, or falling into one, leaves this function.'''
    f = Func(entry, 'thumb')
    work = [(entry, 0)]
    while work:
        pc, sp = work.pop()
        run = []
        while pc not in f.insns:
            if pc != entry and pc in funcs:
                break                                  # fell into the next function
            if not in_rom(pc) or pc & 1:
                f.errors.append(('out_of_rom', pc))
                break
            kind, length, arg = tdec(pc)
            if pc in f.pools or (pc & ~3) in f.pools or kind == 'invalid':
                if run and run[-1][1] == 'bl':
                    f.dead_end.add(run[-1][0])
                elif run and run[-1][1] == 'swi':
                    f.returns += 1                     # a BIOS call that never returns, e.g. SoftReset
                else:
                    f.errors.append(('not_code', pc))
                break
            f.insns[pc] = length
            run.append((pc, kind, arg))
            hw = u16(pc)
            if kind == 'push':
                sp -= 4 * popcount(arg)
            elif kind == 'pop':
                sp += 4 * popcount(arg)
            elif (hw & 0xFF00) == 0xB000:
                sp += (-4 if hw & 0x80 else 4) * (hw & 0x7F)
            if kind == 'bl':
                if not in_rom(arg):
                    f.errors.append(('bl_out_of_rom', pc))
                    break
                if pc in far:
                    work.append((arg, sp))
                    break
                f.bl_sites.append((pc, arg))
                f.calls.add((arg, 'thumb', pc))
                if pc in noret:
                    break
            elif kind in ('bcc', 'b'):
                if arg in funcs and arg != entry:
                    f.calls.add((arg, 'thumb', pc))    # tail branch into another function
                else:
                    work.append((arg, sp))
                if kind == 'b':
                    break
            elif kind == 'bx':
                if arg == 15:
                    f.veneers.add((pc + 4) & ~3)       # bx pc: ARM code at the next word
                f.returns += 1
                f.balance.append(sp)
                break
            elif kind == 'pop_pc':
                f.returns += 1
                f.balance.append(sp + 4 * (popcount(hw & 0xFF) + 1))
                break
            elif kind == 'ldr_pc':
                if arg + 4 > BASE + N:
                    f.errors.append(('pool_out_of_rom', pc))
                    break
                f.pools[arg] = u32(arg)
            elif kind == 'mov_pc':
                base = next((f.pools[a] for _, k, a in reversed(run[-40:-1]) if k == 'ldr_pc'
                             and in_rom(f.pools[a]) and not f.pools[a] & 3 and 0 < f.pools[a] - pc < 0x400), None)
                targets, lowest = [], None
                while base is not None and len(targets) < 2048:
                    slot = base + 4 * len(targets)
                    if (lowest is not None and slot >= lowest) or slot + 4 > BASE + N:
                        break
                    t = u32(slot)
                    if not in_rom(t) or t & 1 or abs(t - pc) > 0x10000:
                        break
                    targets.append(t)
                    if t > base and (lowest is None or t < lowest):
                        lowest = t
                if not targets:
                    f.errors.append(('table_unresolved', pc))
                    break
                f.tables[base] = targets
                work.extend((t, sp) for t in targets)
                break
            pc += length
    return f


def analyze_arm(entry):
    f = Func(entry, 'arm')
    work = [entry]
    while work:
        pc, prev = work.pop(), None
        while pc not in f.insns:
            if pc != entry and pc in funcs:
                break
            if not in_rom(pc) or pc & 3 or pc in f.pools:
                f.errors.append(('not_code', pc))
                break
            kind, arg, cond = adec(pc)
            if kind == 'invalid':
                f.errors.append(('not_code', pc))
                break
            f.insns[pc] = 4
            always = cond == 0xE
            if kind == 'bl':
                f.calls.add((arg, 'arm', pc))
            elif kind == 'b':
                if always and (arg < entry or arg in funcs):
                    f.calls.add((arg, 'arm', pc))      # tail branch: a function's blocks lie after its entry
                else:
                    work.append(arg)
                if always:
                    break
            elif kind in ('bx', 'pc_write'):
                if not (kind == 'bx' and prev == 0xE1A0E00F):   # mov lr, pc ; bx rN is a call
                    f.returns += 1
                    if always:
                        break
            elif kind == 'ldr_pc' and in_rom(arg) and arg + 4 <= BASE + N:
                f.pools[arg] = u32(arg)
            elif kind == 'adr':
                f.adrs.add(arg)
            prev = u32(pc)
            pc += 4
    return f


def pops_callers_frame(f):
    return any(b > 0 for b in f.balance)


def settle(entry):
    '''Decide every bl of one Thumb function: call, far jump, or call that never returns.'''
    if entry in settled:
        return settled[entry]
    in_progress.add(entry)
    far, noret, calls = set(), set(), set()
    for _ in range(600):
        f = analyze_thumb(entry, frozenset(far), frozenset(noret))
        changed = False
        for site, target in f.bl_sites:
            if site in calls:
                verdict = 'call'
            elif target == entry or target in funcs or target < entry or abs(target - site) < FAR_MIN:
                verdict = 'call'
            elif target < f.code_end:
                verdict = 'far'                        # a callee is never inside its caller
            elif (u16(target) & 0xFF00) == 0xB500 and not target & 3:
                verdict = 'call'
            elif target in in_progress:
                verdict = None
            else:
                verdict = 'far' if pops_callers_frame(settle(target)[0]) else 'call'
            if verdict == 'far':
                far.add(site)
                changed = True
            elif verdict == 'call':
                calls.add(site)
                if site in f.dead_end and site not in noret:
                    noret.add(site)                    # a real call followed by non-code: it never returns
                    changed = True
            elif site in f.dead_end and site not in noret:
                noret.add(site)
                changed = True
        if not changed:
            break
    f.calls = {c for c in f.calls if c[2] not in far}
    in_progress.discard(entry)
    settled[entry] = (f, far)
    return settled[entry]


valid_memo, never_valid = {}, set()


def could_be_code(t):
    '''A call target is clearly not code when it sits in a pool or table, is blank, or does not
    decode. Hand-written callees fail stricter tests, so nothing stricter is asked of a callee.'''
    if not in_rom(t) or t & 1 or claimed[t - BASE] in (2, 3):
        return False
    if ROM[t - BASE:t - BASE + 4] in (bytes(4), bytes([255]) * 4):
        return False
    g = settle(t)[0]
    return bool(g.insns) and not g.errors


def dense(f):
    '''A compiled function is one contiguous run: its instructions, pools and tables fill its
    extent. Bytes decoded from data jump around and leave holes.'''
    extent = f.end - f.entry
    covered = (sum(f.insns.values()) + 4 * sum(1 for p in f.pools if f.entry <= p < f.end)
               + 4 * sum(len(t) for t in f.tables.values()))
    return extent - covered <= max(8, extent // 16)


def valid(entry):
    '''Is this address plausibly a compiled function? Used for entries that came from a pointer
    or a scan. It must decode without error, return with the stack balanced (or open with
    push {.., lr}), touch no claimed byte, fill its extent, and call nothing that is clearly
    not code. The first four tests cannot start passing later, so a failure is remembered.'''
    if entry in funcs:
        return True
    if entry in never_valid:
        return False
    if entry in valid_memo:
        return valid_memo[entry]
    if not in_rom(entry) or entry & 1 or claimed[entry - BASE]:
        never_valid.add(entry)
        return False
    valid_memo[entry] = True                           # optimistic while its callees are checked
    f = settle(entry)[0]
    ok = (bool(f.insns) and not f.errors and not pops_callers_frame(f)
          and (f.returns > 0 or (u16(entry) & 0xFF00) == 0xB500)
          and not any(claimed[a - BASE] for a in f.insns)
          and not any(claimed[p - BASE] == 1 for p in f.pools) and dense(f))
    if not ok:
        never_valid.add(entry)                         # intrinsic: it cannot become valid later
    else:
        ok = all(t in funcs or could_be_code(t) for t, m, _ in f.calls if m == 'thumb')
    valid_memo[entry] = ok
    return ok


def claim(f):
    for a, n in f.insns.items():
        claimed[a - BASE:a - BASE + n] = bytes([1]) * n
    for p in f.pools:
        if not claimed[p - BASE]:
            claimed[p - BASE:p - BASE + 4] = bytes([2]) * 4
    for base, targets in f.tables.items():
        claimed[base - BASE:base - BASE + 4 * len(targets)] = bytes([3]) * (4 * len(targets))


def is_padding(k):
    return not claimed[k] and (ROM[k] == 0 or ROM[k - (k & 1):k - (k & 1) + 2] == bytes([0xC0, 0x46]))


def anchored_at_start(f):
    '''Compiled code is a dense tiling: a function starts where claimed bytes end, with at most
    alignment padding between.'''
    s = f.entry - BASE
    k = s - 1
    while k >= 0 and s - k <= 3 and is_padding(k):
        k -= 1
    return k >= 0 and bool(claimed[k])


def anchored_at_end(f):
    e = f.end - BASE
    k = e
    while k < N and k - e < 3 and is_padding(k):
        k += 1
    return k < N and (BASE + k) in funcs


def opens_with_prologue(entry):
    return (u16(entry) & 0xFF00) == 0xB500 and not entry & 3


def acceptable(f, why):
    '''Evidence needed beyond validity. A start anchor is enough. A pointer loaded by accepted
    code, or an end anchor, also needs the push {.., lr} that only a function entry has.'''
    if anchored_at_start(f):
        return True
    return opens_with_prologue(f.entry) and (why == 'pool pointer' or anchored_at_end(f))


def accept(entry, mode, why):
    '''Accept an entry and everything it calls. Callees of an accepted function are trusted.'''
    work = [(entry, mode, why)]
    while work:
        entry, mode, why = work.pop()
        if entry in funcs or not in_rom(entry):
            continue
        f = settle(entry)[0] if mode == 'thumb' else analyze_arm(entry)
        funcs[entry], origin[entry] = f, why
        claim(f)
        work += [(t, m, 'call') for t, m, _ in sorted(f.calls)]
        work += [(a, 'arm', 'veneer') for a in sorted(f.veneers)]
        work += [(a, 'arm', 'adr') for a in sorted(f.adrs) if in_rom(a) and not a & 3 and a > entry]


DATA_REFS = collections.defaultdict(list)   # aligned code address -> offsets of words that point at it
for _off in range(0, N - 3, 4):
    _v = struct.unpack_from('<I', ROM, _off)[0]
    if _v & 1 and BASE <= _v - 1 < BASE + N and not (_v - 1) & 3:
        DATA_REFS[_v - 1].append(_off)


def pointer_candidates():
    '''Words with the Thumb bit that point at a 4-aligned ROM address: from accepted literal
    pools first, then from every aligned word in the ROM that is not itself inside code.'''
    pool = {v - 1 for f in funcs.values() for v in f.pools.values()
            if v & 1 and in_rom(v - 1) and not (v - 1) & 3 and v - 1 not in funcs}
    data = [t for t, offs in DATA_REFS.items()
            if t not in funcs and t not in pool and t not in never_valid and any(claimed[o] != 1 for o in offs)]
    return sorted(pool), sorted(data)


def grow():
    '''Accept pointer candidates that are valid and anchored, until nothing changes.'''
    total = 0
    while True:
        valid_memo.clear()
        pool, data = pointer_candidates()
        added = 0
        for why, cands in (('pool pointer', pool), ('data pointer', data)):
            for t in cands:
                if t in funcs or claimed[t - BASE] or not valid(t):
                    continue
                if acceptable(settle(t)[0], why):
                    accept(t, 'thumb', why)
                    added += 1
        total += added
        if not added:
            return total


def try_unreferenced(entry, lo, hi):
    if entry in funcs or not any(ROM[entry - BASE:entry - BASE + 4]) or not valid(entry):
        return None
    f = settle(entry)[0]
    if lo <= entry - BASE and f.end - BASE <= hi:
        accept(entry, 'thumb', 'gap scan')
        return f
    return None


def fill_gaps():
    '''Unreferenced functions: free bytes between two claimed runs that decode as functions,
    chained forward from the start of the gap and backward from its end.'''
    valid_memo.clear()
    added, a = 0, min(funcs) - BASE
    hi = max(f.end for f in funcs.values()) - BASE
    while a < hi:
        if claimed[a]:
            a += 1
            continue
        start = a
        while a < hi and not claimed[a]:
            a += 1
        end = a
        p = (start + 3) & ~3
        while p + 2 <= end:                              # forward chain
            f = try_unreferenced(BASE + p, start, end)
            if f is None:
                break
            added += 1
            p = (f.end - BASE + 3) & ~3
        q = (end - 4) & ~3
        floor = max(p, end - 4096)
        while q >= floor:                                # backward chain: a prologue that ends at the gap end
            if ((u16(BASE + q) & 0xFF00) == 0xB500 and BASE + q not in funcs and valid(BASE + q)
                    and 0 <= end - (settle(BASE + q)[0].end - BASE) <= 3):
                accept(BASE + q, 'thumb', 'gap scan')
                added += 1
                end, floor = q, max(p, q - 4096)
            q -= 4
    return added


t0 = time.time()
kind, target, _ = adec(BASE)
assert kind == 'b', 'the cartridge does not start with an ARM branch'
accept(BASE, 'arm', 'rom entry')
accept(target, 'arm', 'rom entry')
# crt0 calls main through a pool pointer: an ARM pool word that is a Thumb pointer is a call target
for f in list(funcs.values()):
    if f.mode == 'arm':
        for v in f.pools.values():
            if v & 1 and in_rom(v - 1) and not (v - 1) & 3:
                accept(v - 1, 'thumb', 'startup pointer')
while grow() + fill_gaps():
    pass
elapsed = time.time() - t0

# ------------------------------------------------------------------------------------------ report
lo, hi = min(funcs), max(f.end for f in funcs.values())
region = claimed[lo - BASE:hi - BASE]
padding = gaps = k = 0
while k < len(region):
    if region[k]:
        k += 1
        continue
    start = k
    while k < len(region) and not region[k]:
        k += 1
    if k - start <= 3 and not any(ROM[lo - BASE + start:lo - BASE + k]):
        padding += k - start
    else:
        gaps += 1
thumb = [e for e, f in funcs.items() if f.mode == 'thumb']
far_sites = set().union(*(settled[e][1] for e in thumb))
called = {t for f in funcs.values() for t, _, _ in f.calls}
print(f'{len(funcs)} entries ({len(thumb)} Thumb, {len(funcs) - len(thumb)} ARM) in {elapsed:.1f}s')
print(f'  code region {lo:08X}..{hi:08X}: code {region.count(1)}, literal pool {region.count(2)}, '
      f'jump table {region.count(3)}, unclassified {region.count(0)} '
      f'({padding} zero padding, the rest in {gaps} gaps)')
print(f'  bl sites: {sum(1 for e in thumb for n in funcs[e].insns.values() if n == 4)}, '
      f'far jumps: {len(far_sites)} in {sum(1 for e in thumb if settled[e][1])} functions; '
      f'jump tables: {sum(len(f.tables) for f in funcs.values())} '
      f'with {sum(len(t) for f in funcs.values() for t in f.tables.values())} entries')
print('  found by:', dict(sorted(collections.Counter(origin.values()).items())))
print('  no direct caller:', dict(sorted(collections.Counter(origin[e] for e in funcs if e not in called).items())))

args = [a for a in sys.argv[2:] if a != '-v']
if args:                   # score against the ELF's function symbols
    truth = {}
    for line in open(args[0]):
        value, size, bind, name = line.split()[:4]
        a = int(value, 16) & ~1
        if in_rom(a):
            truth.setdefault(a, [0, name])
            truth[a][0] = max(truth[a][0], int(size, 0))
    found, real = set(funcs), set(truth)
    tp, fp, fn = found & real, found - real, real - found
    sized = [a for a in tp if truth[a][0]]
    agree = sum(1 for a in sized if truth[a][0] in (funcs[a].end - a, funcs[a].end - a + (-(funcs[a].end - a)) % 4))
    print(f'  truth {len(real)}: precision {100 * len(tp) / len(found):.2f}%, recall {100 * len(tp) / len(real):.2f}% '
          f'({len(fp)} false, {len(fn)} missed)')
    print(f'  extent equals the ELF size for {agree} of {len(sized)} sized functions found')
    print(f'  code end found {hi:08X}; last ELF function ends at {max(a + s[0] for a, s in truth.items()):08X}')
    print('  false entries found by:', dict(sorted(collections.Counter(origin[a] for a in fp).items())))
    if '-v' in sys.argv:
        for a in sorted(fp):
            print(f'    false  {a:08X} {origin[a]:15s} size {funcs[a].end - a}')
        for a in sorted(fn):
            print(f'    missed {a:08X} {truth[a][1]} size {truth[a][0]}')
    if len(args) > 1:      # a hand-curated function list, judged by the same ELF
        cfg = {int(l.split()[1], 16) for l in open(args[1]) if l.split()[:1] in (['thumb_func'], ['arm_func'])}
        inside = {a + i for f in funcs.values() for a, n in f.insns.items() for i in range(n)}
        print(f'  cfg entries: {len(cfg)}; functions in the ELF: {len(cfg & real)}; not functions in the ELF: {len(cfg - real)}')
        print(f'    of those {len(cfg - real)}: inside a function found here {len((cfg - real) & (inside - found))}, '
              f'at a 2-mod-4 address {sum(1 for a in cfg - real if a & 2)}')
        print(f'  ELF functions missing from the cfg: {len({a for a in real if lo <= a < hi} - cfg)}')
```
