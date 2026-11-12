import { appendFileSync } from 'node:fs';
import type { FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter';

/**
 * On GitHub Actions, write a short result table to the run's summary page, so the outcome can be
 * read without downloading the report: totals, then every failed and flaky test with its first
 * error line and source. Does nothing outside GitHub Actions (no GITHUB_STEP_SUMMARY).
 * `npm run test:all` runs Playwright twice; each run adds its own section.
 */
export default class GithubSummaryReporter implements Reporter {
  private suite!: Suite;

  onBegin(_config: unknown, suite: Suite): void {
    this.suite = suite;
  }

  onEnd(result: FullResult): void {
    const file = process.env.GITHUB_STEP_SUMMARY;
    if (!file) return;

    const tests = this.suite.allTests();
    if (!tests.some((test) => test.results.length)) return; // nothing ran, e.g. `--list`
    const unexpected = tests.filter((test) => test.outcome() === 'unexpected');
    // A known bug (knownBug / test.fail) whose test now passes: the bug is probably fixed.
    const fixedBugs = unexpected.filter(isFixedKnownBug);
    const failed = unexpected.filter((test) => !isFixedKnownBug(test));
    const flaky = tests.filter((test) => test.outcome() === 'flaky');
    const skipped = tests.filter((test) => test.outcome() === 'skipped');
    // Read by the workflow's alert job: a green run can still hide tests that needed a retry.
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `flaky=${flaky.length}\n`);
    const expected = tests.filter((test) => test.outcome() === 'expected');
    // Known bugs: marked test.fail() and failing as expected.
    const knownBugs = expected.filter((test) => test.expectedStatus === 'failed');
    const passed = expected.length - knownBugs.length;
    const projects = [...new Set(tests.map((test) => test.parent.project()?.name))].join(', ');

    const icon = failed.length ? '❌' : flaky.length || fixedBugs.length ? '⚠️' : '✅';
    const headline = failed.length
      ? `${failed.length} failed`
      : fixedBugs.length
        ? `${fixedBugs.length} known bug(s) may be fixed`
        : 'all passed';
    const lines = [
      `## ${icon} Playwright: ${headline} (${projects})`,
      '',
      '| Passed | Failed | Flaky | Known bugs | Skipped | Time |',
      '|---|---|---|---|---|---|',
      `| ${passed} | ${failed.length} | ${flaky.length} | ${knownBugs.length} | ${skipped.length} | ${minutes(result.duration)} |`,
      '',
    ];

    lines.push(...byProject(tests), '');
    if (failed.some((test) => /No "AUTOTEST" Instagram message/.test(firstError(test)))) {
      lines.push(
        '> ⚠️ The inbox tests found no Instagram message from the last 24 hours: check the latest ' +
          '**Instagram Sender** run (see README, "Daily Instagram message").',
        '',
      );
    }

    if (fixedBugs.length) {
      lines.push(
        '### 🎉 Known bugs that now pass (probably fixed)',
        '',
        'These tests were expected to fail because of a known bug, but passed. Check the issue: if the ' +
          'bug is fixed, close the issue and remove the `knownBug(...)` line from the test.',
        '',
        '| Test | Issue | Source |',
        '|---|---|---|',
        ...fixedBugs.map((test) => {
          const issue = [...test.annotations, ...(test.results.at(-1)?.annotations ?? [])].find(
            (annotation) => annotation.type === 'known bug',
          )?.description;
          const [, , file, ...titles] = test.titlePath();
          return `| ${escape(titles.join(' › '))} | ${escape(issue ?? '-')} | \`${file.replace(/\\/g, '/')}:${test.location.line}\` |`;
        }),
        '',
      );
    }
    if (failed.length) lines.push('### Failed', '', ...table(failed), '');
    if (flaky.length) {
      lines.push('### Flaky (failed, then passed on retry)', '', ...table(flaky), '');
    }
    if (result.status === 'interrupted' || result.status === 'timedout') {
      lines.push(`> The run ended early (${result.status}), so some tests did not run.`, '');
    }
    const sheetId = process.env.FAILED_TESTS_SHEET_ID;
    if (failed.length + flaky.length && sheetId) {
      lines.push(
        `Steps to reproduce for each one: [Failed tests sheet](https://docs.google.com/spreadsheets/d/${sheetId}).`,
        '',
      );
    }
    lines.push(...slowest(tests, 5), '');
    lines.push('Full report with screenshots and traces: **Artifacts** at the bottom of this page.', '');

    appendFileSync(file, lines.join('\n'));
  }
}

function minutes(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

/** The first line of a test's last error (or its status), without colour codes. */
function firstError(test: TestCase): string {
  const result = [...test.results].reverse().find((attempt) => attempt.errors.length) ?? test.results.at(-1);
  return (
    (result?.errors[0]?.message ?? result?.status ?? '')
      .replace(/\u001b\[[0-9;]*m/g, '')
      .split('\n')
      .find((line) => line.trim())
      ?.trim()
      .slice(0, 160) ?? ''
  );
}

/** A markdown table of tests: name, first error line, source. */
function table(tests: TestCase[]): string[] {
  const rows = tests.map((test) => {
    const [, project, file, ...titles] = test.titlePath();
    return `| ${escape(titles.join(' › '))} | ${project} | ${escape(firstError(test))} | \`${file.replace(/\\/g, '/')}:${test.location.line}\` |`;
  });
  return ['| Test | Project | Error | Source |', '|---|---|---|---|', ...rows];
}

/** Per project (ui, api, inbox, …): how many passed, failed, were flaky or skipped. */
function byProject(tests: TestCase[]): string[] {
  const rows = new Map<string, { passed: number; failed: number; flaky: number; skipped: number }>();
  for (const test of tests) {
    if (!test.results.length && test.outcome() !== 'skipped') continue;
    const name = test.parent.project()?.name ?? '-';
    const row = rows.get(name) ?? { passed: 0, failed: 0, flaky: 0, skipped: 0 };
    const outcome = test.outcome();
    if (outcome === 'expected') row.passed++;
    else if (outcome === 'unexpected') row.failed++;
    else if (outcome === 'flaky') row.flaky++;
    else row.skipped++;
    rows.set(name, row);
  }
  if (rows.size < 2) return [];
  return [
    '<details><summary>By project</summary>',
    '',
    '| Project | Passed | Failed | Flaky | Skipped |',
    '|---|---|---|---|---|',
    ...[...rows].map(
      ([name, r]) =>
        `| ${name} | ${r.passed} | ${r.failed ? `**${r.failed}**` : 0} | ${r.flaky} | ${r.skipped} |`,
    ),
    '',
    '</details>',
  ];
}

/** The slowest tests (all attempts added up), to spot tests that are getting slower. */
function slowest(tests: TestCase[], count: number): string[] {
  const timed = tests
    .map((test) => ({ test, ms: test.results.reduce((sum, result) => sum + result.duration, 0) }))
    .filter(({ ms }) => ms > 0)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, count);
  if (!timed.length) return [];
  return [
    `<details><summary>${count} slowest tests</summary>`,
    '',
    '| Test | Project | Time |',
    '|---|---|---|',
    ...timed.map(({ test, ms }) => {
      const [, project, , ...titles] = test.titlePath();
      return `| ${escape(titles.join(' › '))} | ${project} | ${minutes(ms)} |`;
    }),
    '',
    '</details>',
  ];
}

/** Keep table cells on one line and stop "|" from splitting them. */
function escape(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** A test expected to fail (a known bug) that passed instead. */
export function isFixedKnownBug(test: TestCase): boolean {
  return test.expectedStatus === 'failed' && test.results.at(-1)?.status === 'passed';
}
