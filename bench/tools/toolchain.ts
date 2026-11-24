// `npm run toolchain -- build [--only <name>] [--json]` (architecture §7.2, D123): builds the toolchain references
// under bench/dataset/toolchain/<name>/ into bench/.local/toolchain/<name>/ (bench/src/toolchain-refs.ts): an image
// linking a whole library archive of a compiler's installation, which a signature spec names as a reference. A
// reference whose record is current is left alone. A maintainer's tool of a romlift source checkout, as `npm run
// signatures` is, which also builds the references its spec names.
//
// Text: one line per reference. --json: one {"type":"reference","name","toolchain","commit","sha1","built"} line per
// reference, then {"type":"summary","ok","exitCode"}. Exit codes: 0 built or current, 1 a build error, 2 usage.
import { fileURLToPath } from 'node:url';

import { UsageError, parseArgs } from '../src/args.ts';
import { contextFromEnv } from '../src/context.ts';
import { BenchError } from '../src/files.ts';
import { runProcess } from '../src/process.ts';
import { buildToolchainReference, toolchainReferenceNames } from '../src/toolchain-refs.ts';

const USAGE = 'usage: npm run toolchain -- build [--only <name>] [--json]';

export async function main(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  try {
    const args = parseArgs(argv, { options: ['only'], flags: ['json'], maxPositionals: 1 });
    if (args.positionals[0] !== 'build') throw new UsageError(USAGE);
    const json = args.flags.has('json');
    const cx = contextFromEnv(env);
    const all = await toolchainReferenceNames(cx);
    const only = args.options['only'];
    if (only !== undefined && !all.includes(only))
      throw new BenchError(`${only} is no toolchain reference (${all.join(', ') || 'there is none'})`);
    for (const name of only === undefined ? all : [only]) {
      const { record, built } = await buildToolchainReference(
        cx,
        name,
        { run: runProcess, log: (line) => process.stderr.write(`${line}\n`) },
        env,
      );
      process.stdout.write(
        json
          ? `${JSON.stringify({ type: 'reference', name, toolchain: record.toolchain, commit: record.commit, sha1: record.sha1, built })}\n`
          : `${name}: ${built ? 'built' : 'current'} (${record.toolchain} ${record.commit}, SHA-1 ${record.sha1})\n`,
      );
    }
    if (json) process.stdout.write(`${JSON.stringify({ type: 'summary', ok: true, exitCode: 0 })}\n`);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    if (error instanceof BenchError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = await main(process.argv.slice(2), process.env);
