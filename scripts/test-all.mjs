// Runs the whole suite in two parts:
//   1. every test except the exclusive ones, in parallel
//   2. the exclusive tests (organization and workspace-wide settings), on their own, because they
//      change settings the other tests rely on
// Part 2 runs even if part 1 failed, and the exit code is non-zero if either part failed.
// Extra arguments are passed to both parts, e.g. `npm run test:all -- --headed`.
import { spawnSync } from 'node:child_process';

const extraArgs = process.argv.slice(2);

function run(label, args, env = {}) {
  console.log(`\n=== ${label} ===\n`);
  const result = spawnSync('npx', ['playwright', 'test', ...args, ...extraArgs], {
    stdio: 'inherit',
    shell: true, // needed on Windows to find npx
    env: { ...process.env, ...env },
  });
  return result.status ?? 1;
}

const main = run('All tests except the exclusive ones', []);
const exclusive = run(
  'Exclusive tests: organization and workspace-wide settings (on their own)',
  // Their own results and report folders, so they don't replace those of part 1.
  ['--project=exclusive', '--output=test-results/exclusive'],
  {
    EXCLUSIVE_TESTS: 'true',
    PLAYWRIGHT_HTML_OUTPUT_DIR: 'playwright-report/exclusive',
  },
);

process.exit(main || exclusive);
