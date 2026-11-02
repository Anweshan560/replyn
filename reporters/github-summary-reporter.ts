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
    const failed = tests.filter((test) => test.outcome() === 'unexpected');
    const flaky = tests.filter((test) => test.outcome() === 'flaky');
    const skipped = tests.filter((test) => test.outcome() === 'skipped');
    const expected = tests.filter((test) => test.outcome() === 'expected');
    // Known bugs: marked test.fail() and failing as expected.
    const knownBugs = expected.filter((test) => test.expectedStatus === 'failed');
    const passed = expected.length - knownBugs.length;
    const projects = [...new Set(tests.map((test) => test.parent.project()?.name))].join(', ');

    const icon = failed.length ? '❌' : flaky.length ? '⚠️' : '✅';
    const lines = [
      `## ${icon} Playwright: ${failed.length ? `${failed.length} failed` : 'all passed'} (${projects})`,
      '',
      '| Passed | Failed | Flaky | Known bugs | Skipped | Time |',
      '|---|---|---|---|---|---|',
      `| ${passed} | ${failed.length} | ${flaky.length} | ${knownBugs.length} | ${skipped.length} | ${minutes(result.duration)} |`,
      '',
    ];

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
    lines.push('Full report with screenshots and traces: **Artifacts** at the bottom of this page.', '');

    appendFileSync(file, lines.join('\n'));
  }
}

function minutes(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

/** A markdown table of tests: name, first error line, source. */
function table(tests: TestCase[]): string[] {
  const rows = tests.map((test) => {
    const [, project, file, ...titles] = test.titlePath();
    const result =
      [...test.results].reverse().find((attempt) => attempt.errors.length) ?? test.results.at(-1);
    const error = (result?.errors[0]?.message ?? result?.status ?? '')
      .replace(/\u001b\[[0-9;]*m/g, '')
      .split('\n')
      .find((line) => line.trim())
      ?.trim()
      .slice(0, 160);
    return `| ${escape(titles.join(' › '))} | ${project} | ${escape(error ?? '')} | \`${file.replace(/\\/g, '/')}:${test.location.line}\` |`;
  });
  return ['| Test | Project | Error | Source |', '|---|---|---|---|', ...rows];
}

/** Keep table cells on one line and stop "|" from splitting them. */
function escape(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
