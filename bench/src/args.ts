// The bench's small argument parser: `--name value` options, `--flag` switches and positionals,
// checked against what each command accepts, so an unknown option is a usage error, not ignored.

export interface BenchArgs {
  readonly positionals: readonly string[];
  readonly options: Readonly<Record<string, string>>;
  readonly flags: ReadonlySet<string>;
}

export class UsageError extends Error {
  override readonly name = 'UsageError';
}

export interface ArgSpec {
  /** Options that take a value. */
  readonly options?: readonly string[];
  /** Switches. */
  readonly flags?: readonly string[];
  readonly maxPositionals?: number;
}

export function parseArgs(argv: readonly string[], spec: ArgSpec): BenchArgs {
  const positionals: string[] = [];
  const options: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (spec.flags?.includes(name)) {
        flags.add(name);
      } else if (spec.options?.includes(name)) {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) throw new UsageError(`--${name} needs a value`);
        options[name] = value;
        i++;
      } else {
        throw new UsageError(`unknown option ${arg}`);
      }
    } else {
      positionals.push(arg);
    }
  }
  if (positionals.length > (spec.maxPositionals ?? 0)) throw new UsageError(`unexpected argument ${positionals[spec.maxPositionals ?? 0] ?? ''}`);
  return { positionals, options, flags };
}
