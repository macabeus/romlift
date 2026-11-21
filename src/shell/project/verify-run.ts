// The runner of the tree checks' assemble and link (architecture §2.1, §6.4, D108): carries out core/workflow/verify.ts's
// toolchainPlan in a fresh directory under the system temporary directory, never the working directory. It writes
// the tree (writeFreshTree), finds binutils, assembles each unit against its ROM range and links the image against
// the ROM's SHA-1, as the plan lists them; it decides nothing (D36). Exported from `romlift/node` so the bench and
// the gates run the same composition the CLI does.
import type { CheckResult } from '../../core/verify/report.ts';
import { generatedEntries } from '../../core/workflow/generate.ts';
import type { GenerateResult } from '../../core/workflow/generate.ts';
import { notRunOutcome, toolchainPlan } from '../../core/workflow/verify.ts';
import type { ToolchainFlags, ToolchainOutcome } from '../../core/workflow/verify.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import { withTempDir } from '../temp-dir.ts';
import { findBinutils } from '../toolchain/binutils.ts';
import { assembleCheck, linkCheck } from '../toolchain/link-check.ts';
import { writeFreshTree } from './fresh-tree.ts';

/** Where the tree of --assemble and --link is written: under os.tmpdir(), never the working directory. */
export const VERIFY_TEMP_PREFIX = 'romlift-verify-';

/**
 * The toolchain checks of a run, in a temporary directory named `<tempPrefix>…` under the system temporary directory;
 * not run when the self-checks or the model failed. A test passes its own prefix, so it can tell its directories from
 * those of any other verify on the machine.
 */
export async function runToolchainChecks(
  rom: Rom,
  result: GenerateResult,
  flags: ToolchainFlags,
  env: Readonly<Record<string, string | undefined>>,
  tempPrefix: string = VERIFY_TEMP_PREFIX,
): Promise<ToolchainOutcome> {
  const plan = toolchainPlan(result, flags);
  if (plan.kind === 'none') return { checks: [] };
  if (plan.kind === 'not-run') return plan.outcome;
  const ran = await withTempDir(tempPrefix, async (dir): Promise<ToolchainOutcome> => {
    const applied = await writeFreshTree(dir, {
      model: result.model,
      entries: generatedEntries(rom, result),
      paths: result.paths,
    });
    if (!applied.ok) return notRunOutcome(plan.ids, 'the tree could not be written', applied.diagnostics);
    const tools = findBinutils(env);
    if ('code' in tools) return notRunOutcome(plan.ids, 'binutils not found', [tools]);
    const checks: CheckResult[] = [];
    if (plan.assemble !== undefined) checks.push(await assembleCheck({ dir, rom, units: plan.assemble, tools }));
    if (plan.link === undefined) return { checks };
    const linked = await linkCheck({ dir, rom, units: plan.link, tools });
    checks.push(linked);
    return linked.sha1 === null ? { checks } : { checks, sha1: linked.sha1 };
  });
  return ran.ok ? ran.value : notRunOutcome(plan.ids, 'no temporary directory', [ran.diagnostic]);
}
