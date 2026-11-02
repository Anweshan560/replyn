// Known app bugs, from scripts/known-bugs.json (tests mark them with knownBug('<key>')).
//
//   npm run known-bugs                      list every known bug, its issue and its tests
//   npm run known-bugs -- --create          create a GitHub issue for each bug that has none yet
//                                            (needs the GitHub CLI: `gh auth login`), and save the
//                                            issue numbers back into known-bugs.json
//   npm run known-bugs -- --create --dry-run show the issues that would be created, without creating
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const FILE = path.join(import.meta.dirname, 'known-bugs.json');
const data = JSON.parse(readFileSync(FILE, 'utf8'));
const args = process.argv.slice(2);

/** Every test file, to check that each bug is still used by a test. */
function testFiles(dir = path.join(import.meta.dirname, '..', 'tests')) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? testFiles(full) : name.endsWith('.ts') ? [full] : [];
  });
}

function issueBody(bug) {
  return [
    `**Found by the automated tests on ${bug.found}** · Environment: ${data.environment}`,
    '',
    '### Steps to reproduce',
    ...bug.steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    '### Expected',
    bug.expected,
    '',
    '### Actual',
    bug.actual,
    '',
    '### Tests that check this',
    ...bug.tests.map((test) => `- \`${test}\``),
    '',
    '---',
    `These tests are marked \`knownBug('${bug.key}')\` and are expected to fail until this is fixed. ` +
      'Once it is fixed they pass, the daily run reports "known bug may be fixed", and the marker is removed ' +
      'so the tests guard against the bug coming back.',
  ].join('\n');
}

function gh(ghArgs, input) {
  return execFileSync('gh', ghArgs, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] }).trim();
}

function list() {
  const sources = testFiles()
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  console.log(`Known bugs (${data.bugs.length}) in ${data.repo}:\n`);
  for (const bug of data.bugs) {
    const issue = bug.issue ? `#${bug.issue}`.padEnd(5) : 'none ';
    const used = sources.includes(`knownBug('${bug.key}')`) ? '' : '   ⚠ no test uses it any more';
    console.log(
      `${issue}  ${bug.found}  ${bug.title}  (${bug.tests.length} test${bug.tests.length > 1 ? 's' : ''})${used}`,
    );
  }
  const missing = data.bugs.filter((bug) => !bug.issue).length;
  if (missing) console.log(`\n${missing} without an issue: npm run known-bugs -- --create`);
}

function create(dryRun) {
  const todo = data.bugs.filter((bug) => !bug.issue);
  if (!todo.length) return console.log('Every known bug already has an issue.');

  if (dryRun) {
    for (const bug of todo) {
      console.log(`\n=== ${bug.title}  [${bug.labels.join(', ')}]\n\n${issueBody(bug)}`);
    }
    return console.log(`\n${todo.length} issue(s) would be created in ${data.repo}.`);
  }

  // The labels must exist before issues can use them; --force updates them if they do.
  const colours = {
    'known-bug': 'd93f0b',
    security: 'b60205',
    api: '1d76db',
    ui: '5319e7',
    'needs-product-decision': 'fbca04',
  };
  for (const label of new Set(todo.flatMap((bug) => bug.labels))) {
    if (label === 'bug') continue; // GitHub creates it with every repository
    gh(['label', 'create', label, '--repo', data.repo, '--color', colours[label] ?? 'ededed', '--force']);
  }

  for (const bug of todo) {
    const url = gh(
      [
        'issue',
        'create',
        '--repo',
        data.repo,
        '--title',
        bug.title,
        '--body-file',
        '-',
        ...bug.labels.flatMap((label) => ['--label', label]),
      ],
      issueBody(bug),
    );
    bug.issue = Number(url.split('/').pop());
    // Save after every issue, so a failure half-way does not create duplicates on the next try.
    writeFileSync(FILE, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`#${bug.issue}  ${bug.title}`);
  }
  console.log(`\nCreated ${todo.length} issue(s); numbers saved in scripts/known-bugs.json.`);
}

if (args.includes('--create')) create(args.includes('--dry-run'));
else list();
