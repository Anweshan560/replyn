import { mkdirSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import type { FullConfig, Reporter, Suite, TestCase, TestResult, TestStep } from '@playwright/test/reporter';
import { env } from '../config/env';
import { SheetTab, readServiceAccount } from './googleSheets';

/**
 * After every run, write each failed test to a Google Sheet as a test case: its steps, steps to
 * reproduce, expected and actual result, the error, and where to find the screenshot or CI run.
 *
 * - One row per test. When it fails again on a later run, the same row is updated (last failed,
 *   times failed, latest error); the first-failed date and the two manual columns are kept.
 * - A failed row whose test passes on a later run is marked "Passing again".
 * - Known bugs marked with test.fail() are expected to fail, so they are not added.
 * - A test that fails and then passes on retry is added as "Flaky".
 *
 * Set up with FAILED_TESTS_SHEET_ID and a service-account key (see README, "Failed tests sheet").
 * Without them it does nothing. FAILED_TESTS_SHEET_DRY_RUN=true writes the rows to
 * test-results/failed-tests-sheet.json instead of the sheet. A sheet problem never fails the run.
 */

const TAB = 'Failed tests';

const HEADER = [
  'Test ID',
  'Area',
  'Test case',
  'Type',
  'Status',
  'Test steps',
  'Steps to reproduce',
  'Expected result',
  'Actual result',
  'Error details',
  'Source',
  'First failed',
  'Last failed',
  'Times failed',
  'Last run on',
  'Evidence',
  'Bug status (fill in)',
  'Notes (fill in)',
];
/** Columns the reporter writes (A to P); the last two are left to people. */
const WRITTEN_COLUMNS = 16;
const COLUMN = Object.fromEntries(HEADER.map((name, index) => [name, index])) as Record<string, number>;
const MAX_CELL = 5000;

type Row = string[];

/** Remove terminal colour codes. */
const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');

/**
 * Values that must never reach the sheet: every environment variable whose name says it is a
 * secret (TEST_PASSWORD, GOOGLE_SERVICE_ACCOUNT_KEY, …). The sheet is shared with people.
 */
const SECRETS = Object.entries(process.env)
  .filter(([name, value]) => /PASSWORD|SECRET|TOKEN|KEY|PRIVATE/i.test(name) && value && value.length >= 4)
  .map(([, value]) => value!)
  .sort((a, b) => b.length - a.length);

/** Hide secrets, login tokens and the text typed into password fields. */
function redact(text: string): string {
  let safe = text;
  for (const secret of SECRETS) safe = safe.split(secret).join('••••••');
  return safe
    .replace(/(Bearer\s+)[\w.~+/=-]+/gi, '$1••••••')
    .replace(/("?(?:password|token|secret|authorization)"?\s*[:=]\s*)"[^"]*"/gi, '$1"••••••"');
}

const cell = (text: string) => redact(text.length > MAX_CELL ? `${text.slice(0, MAX_CELL)}\n… (cut)` : text);
/** Column number (0-based) to letter, enough for A to Z. */
const letter = (index: number) => String.fromCharCode(65 + index);

/** Date and time in Nepal time, e.g. "2026-11-02 06:41". */
function now(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kathmandu', hour12: false }).slice(0, 16);
}

export default class FailedTestsSheetReporter implements Reporter {
  private config!: FullConfig;
  private suite!: Suite;

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
  }

  async onEnd(): Promise<void> {
    const failed: Row[] = [];
    const passed = new Set<string>();

    for (const test of this.suite.allTests()) {
      const outcome = test.outcome();
      if (outcome === 'unexpected' || outcome === 'flaky') {
        failed.push(this.row(test, outcome === 'flaky' ? 'Flaky' : 'Failed'));
      } else if (outcome === 'expected' && test.results.at(-1)?.status === 'passed') {
        passed.add(this.testId(test));
      }
    }

    try {
      if (process.env.FAILED_TESTS_SHEET_DRY_RUN === 'true') return this.dryRun(failed);

      const sheetId = process.env.FAILED_TESTS_SHEET_ID;
      const account = readServiceAccount();
      if (!sheetId || !account) {
        if (failed.length) {
          console.log('Failed-tests sheet: not set up, so the failures were not written (see README).');
        }
        return;
      }

      const tab = await SheetTab.open(account, sheetId, TAB);
      const { updated, added, passingAgain } = await this.save(tab, failed, passed);
      console.log(
        `Failed-tests sheet: ${added} added, ${updated} updated, ${passingAgain} passing again ` +
          `(https://docs.google.com/spreadsheets/d/${sheetId})`,
      );
    } catch (error) {
      console.warn(`Failed-tests sheet: could not update it: ${(error as Error).message}`);
    }
  }

  /** Merge this run into the sheet. */
  private async save(tab: SheetTab, failed: Row[], passed: Set<string>) {
    const existing = await tab.rows();
    const updates: { range: string; values: string[][] }[] = [];
    if (!existing.length) updates.push({ range: 'A1', values: [HEADER] });

    // Row number in the sheet (1-based, header is row 1) of each test already there.
    const rowNumber = new Map(existing.slice(1).map((row, index) => [row[0], index + 2]));
    const toAdd: Row[] = [];

    for (const row of failed) {
      const number = rowNumber.get(row[0]);
      if (!number) {
        toAdd.push(row);
        continue;
      }
      const previous = existing[number - 1];
      row[COLUMN['First failed']] = previous[COLUMN['First failed']] || row[COLUMN['First failed']];
      row[COLUMN['Times failed']] = String((Number(previous[COLUMN['Times failed']]) || 0) + 1);
      updates.push({ range: `A${number}:${letter(WRITTEN_COLUMNS - 1)}${number}`, values: [row] });
    }

    let passingAgain = 0;
    for (const id of passed) {
      const number = rowNumber.get(id);
      const status = number && existing[number - 1][COLUMN.Status];
      if (number && (status === 'Failed' || status === 'Flaky')) {
        updates.push({ range: `${letter(COLUMN.Status)}${number}`, values: [[`Passing again (${now()})`]] });
        passingAgain++;
      }
    }

    await tab.write(updates);
    await tab.append(toAdd);
    return { updated: failed.length - toAdd.length, added: toAdd.length, passingAgain };
  }

  private dryRun(failed: Row[]): void {
    const file = path.join(this.config.projects[0]?.outputDir ?? 'test-results', 'failed-tests-sheet.json');
    mkdirSync(path.dirname(file), { recursive: true });
    const rows = failed.map((row) =>
      Object.fromEntries(HEADER.slice(0, WRITTEN_COLUMNS).map((h, i) => [h, row[i]])),
    );
    writeFileSync(file, JSON.stringify(rows, null, 2), 'utf8');
    console.log(`Failed-tests sheet (dry run): ${failed.length} row(s) written to ${file}`);
  }

  /** A stable, readable key: file, describe blocks and title, and the project it ran in. */
  private testId(test: TestCase): string {
    // titlePath() is ['', project, file, ...describes, title].
    const [, project, file, ...titles] = test.titlePath();
    return `${file.replace(/\\/g, '/')} › ${titles.join(' › ')} [${project}]`;
  }

  private row(test: TestCase, status: 'Failed' | 'Flaky'): Row {
    // For a flaky test, describe the attempt that failed, not the retry that passed.
    const result =
      [...test.results]
        .reverse()
        .find((attempt) => attempt.status !== 'passed' && attempt.status !== 'skipped') ??
      test.results.at(-1)!;
    const [, , file, ...titles] = test.titlePath();
    const isApi = /\.api\.spec\.ts$/.test(file);
    const steps = this.steps(result);
    const failing = steps.findIndex((step) => step.failed);
    const error = plain(result.errors.map((e) => e.message || e.value || '').join('\n\n')).trim();
    const { expected, actual } = this.expectedAndActual(error, steps[failing]?.title);
    const timestamp = now();

    const row: Row = [];
    row[COLUMN['Test ID']] = this.testId(test);
    row[COLUMN.Area] = path.dirname(file).replace(/\\/g, ' / ').replace(/^\.$/, '-');
    row[COLUMN['Test case']] = titles.join(' › ');
    row[COLUMN.Type] = isApi ? 'API' : file.endsWith('.setup.ts') ? 'Setup' : 'UI';
    row[COLUMN.Status] = status;
    row[COLUMN['Test steps']] = cell(
      steps.length
        ? steps
            .map((step, i) => `${i + 1}. ${step.title}${step.failed ? '   ❌ FAILED HERE' : ''}`)
            .join('\n')
        : '(this test has no named steps)',
    );
    row[COLUMN['Steps to reproduce']] = cell(this.reproduce(steps, failing, isApi, result));
    row[COLUMN['Expected result']] = cell(expected);
    row[COLUMN['Actual result']] = cell(actual);
    row[COLUMN['Error details']] = cell(
      error || `Test ended as "${result.status}" without an error message.`,
    );
    row[COLUMN.Source] = `tests/${file.replace(/\\/g, '/')}:${test.location.line}`;
    row[COLUMN['First failed']] = timestamp;
    row[COLUMN['Last failed']] = timestamp;
    row[COLUMN['Times failed']] = '1';
    row[COLUMN['Last run on']] = process.env.GITHUB_ACTIONS
      ? `GitHub Actions (${process.env.GITHUB_REF_NAME ?? 'unknown branch'})`
      : `Local (${hostname()})`;
    row[COLUMN.Evidence] = this.evidence(result);
    return row.map(redact);
  }

  /**
   * The test's named steps (test.step), in order, nested ones indented. A test without named
   * steps falls back to its Playwright actions and checks, e.g. "Click getByRole('button')".
   */
  private steps(result: TestResult): { title: string; failed: boolean }[] {
    const named: { title: string; failed: boolean }[] = [];
    const walk = (steps: TestStep[], depth: number) => {
      for (const step of steps) {
        if (step.category === 'test.step') {
          named.push({ title: `${'   '.repeat(depth)}${step.title}`, failed: false });
          const index = named.length - 1;
          walk(step.steps, depth + 1);
          // Mark the innermost named step that failed.
          if (step.error && !named.slice(index + 1).some((s) => s.failed)) named[index].failed = true;
        } else if (step.category === 'hook' && step.error) {
          named.push({ title: `Preparation before the test (${step.title})`, failed: true });
        }
      }
    };
    walk(result.steps, 0);
    if (named.length) return named;

    return (
      result.steps
        .filter((step) => step.category === 'pw:api' || step.category === 'expect')
        // Titles like "Click" say little alone, so add the line that did it, e.g. "Click (LoginPage.ts:42)".
        .map((step) => ({
          title: step.location
            ? `${step.title} (${path.basename(step.location.file)}:${step.location.line})`
            : step.title,
          failed: Boolean(step.error),
        }))
    );
  }

  private reproduce(
    steps: { title: string; failed: boolean }[],
    failing: number,
    isApi: boolean,
    result: TestResult,
  ): string {
    const setup = isApi
      ? [
          `Call the API at ${env.apiUrl} with the test account's login token (workspace "${env.testWorkspace}").`,
        ]
      : [
          `Open ${env.baseUrl} and log in with the test account.`,
          `Switch to the workspace "${env.testWorkspace}".`,
        ];
    const upTo = failing >= 0 ? steps.slice(0, failing + 1) : steps;
    const lines = [...setup, ...upTo.map((step) => step.title.trim())].map((line, i) => `${i + 1}. ${line}`);
    if (failing >= 0) lines.push(`→ The last step fails (see Expected / Actual result).`);
    else if (result.status === 'timedOut')
      lines.push('→ The test ran out of time; it was stuck after the last step.');
    return lines.join('\n');
  }

  /** Pull "Expected: …" and "Received: …" out of Playwright's error, when it has them. */
  private expectedAndActual(error: string, failingStep?: string): { expected: string; actual: string } {
    // The "Call log" at the end lists what Playwright tried; it is in Error details already.
    const callLog = error.indexOf('\nCall log:');
    const lines = (callLog >= 0 ? error.slice(0, callLog) : error).split('\n').map((line) => line.trim());
    const expectedLines = lines.filter((line) => /^(Expected\b[^:]*|Locator):/.test(line));
    const receivedLines = lines.filter((line) => /^Received\b[^:]*:/.test(line));
    // A diff (e.g. from toEqual) starts with "- Expected  - 1" and lists "-" / "+" lines.
    const hasDiff = lines.some((line) => /^- Expected\s+- \d+/.test(line));
    const diffMinus = hasDiff ? lines.filter((line) => /^- (?!Expected)/.test(line)).slice(0, 15) : [];
    const diffPlus = hasDiff ? lines.filter((line) => /^\+ (?!Received)/.test(line)).slice(0, 15) : [];
    // Why a check on the page failed, e.g. "Error: element(s) not found".
    const cause = lines.filter((line) => /^Error: /.test(line) && !/^Error: expect\(/.test(line));

    const expected = [
      failingStep && `Step "${failingStep.trim()}" should succeed.`,
      ...expectedLines,
      ...(diffMinus.length ? ['Expected values:', ...diffMinus] : []),
    ].filter(Boolean);
    const actual = [
      ...receivedLines,
      ...(diffPlus.length ? ['Received values:', ...diffPlus] : []),
      ...cause.map((line) => line.replace(/^Error: /, '')),
    ];
    return {
      expected: expected.join('\n') || 'The test should pass.',
      actual: actual.join('\n') || lines.find(Boolean) || 'The test failed (no error message).',
    };
  }

  /** Where to look: the CI run, or the screenshot and trace on the machine that ran it. */
  private evidence(result: TestResult): string {
    const lines: string[] = [];
    if (process.env.GITHUB_ACTIONS) {
      lines.push(
        `CI run (report and screenshots under Artifacts): ${process.env.GITHUB_SERVER_URL}/` +
          `${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
      );
    }
    for (const attachment of result.attachments) {
      if (!attachment.path) continue;
      if (attachment.contentType.startsWith('image/')) lines.push(`Screenshot: ${attachment.path}`);
      if (attachment.name === 'trace') lines.push(`Trace: npx playwright show-trace "${attachment.path}"`);
    }
    return lines.join('\n') || 'No screenshot (API tests have no page).';
  }
}
