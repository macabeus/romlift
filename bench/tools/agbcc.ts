// `npm run agbcc` (D120): builds the checkout's agbcc, tools/agbcc (the submodule, at templates/agbcc.json's commit),
// in place when it is not yet built at that pin, and prints its directory. The fixtures, `bench run --scaffold` and
// the test/local tests use that build; a clone gets the submodule with `git submodule update --init tools/agbcc`.
import { checkoutAgbcc } from '../src/agbcc.ts';
import { contextFromEnv } from '../src/context.ts';
import { BenchError } from '../src/files.ts';
import { runProcess } from '../src/process.ts';

try {
  const dir = await checkoutAgbcc(contextFromEnv(process.env), {
    run: runProcess,
    log: (line) => process.stderr.write(`${line}\n`),
  });
  process.stdout.write(`${dir}\n`);
} catch (error) {
  if (!(error instanceof BenchError)) throw error;
  process.stderr.write(`agbcc: ${error.message}\n`);
  process.exitCode = 1;
}
