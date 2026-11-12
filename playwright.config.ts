import { defineConfig, devices } from '@playwright/test';
import { AGENT_AUTH_FILE, AUTH_FILE, env, getAgentCredentials } from './config/env';

const isCI = !!process.env.CI;
/** No visible browser on CI, or locally with HEADLESS=true (see `npm run test:headless`). */
const isHeadless = isCI || process.env.HEADLESS === 'true';

/**
 * Each feature folder (e.g. tests/clinic/doctors) holds both kinds of tests;
 * the file name decides the project: *.api.spec.ts runs as API, everything else as UI.
 */
const API_TESTS = /.*\.api\.spec\.ts/;

/**
 * Exclusive tests change settings every other test relies on: the organization (switching its type
 * even hides the Clinic menu), and the workspace's general settings, hours, SLAs, assignment rules,
 * AI and lifecycle stages. The report-number tests join them: they count contacts, bookings and
 * payments, which the parallel tests keep adding and removing. They have their own project, run one
 * test at a time, and only when asked for: `npm run test:exclusive`, or last in `npm run test:all`
 * (see env.runExclusiveTests).
 */
const EXCLUSIVE_TESTS =
  /(settings[\\/](organization|workspace|hours|sla|assignment|ai|lifecycle)|reports[\\/]numbers)[\\/].*\.spec\.ts/;

/**
 * Settings the workspace has only one of (today: the Wrap-Up outcomes). Tests change them and put
 * them back, so they run one at a time in their own project, alongside the parallel ones. Unlike
 * the exclusive tests they don't affect other tests, so they run in every normal run.
 */
const WORKSPACE_SETTINGS_TESTS = /settings[\\/]wrap-up[\\/].*\.spec\.ts/;

/**
 * Permission tests run logged in as the limited Agent account (tests/setup/agent.setup.ts), UI and
 * API alike. Without TEST_AGENT_USERNAME / TEST_AGENT_PASSWORD they are skipped.
 */
const PERMISSION_TESTS = /permissions[\\/].*\.spec\.ts/;
const hasAgentAccount = !!getAgentCredentials();

/**
 * Inbox tests that work on the one real Instagram conversation (from the daily message job, see
 * README, "Daily Instagram message"): replies, assigning, closing, snoozing, notes. They would undo
 * each other's changes in parallel, so they have a project of their own and run one at a time
 * (UI and API). Some also log in as the Agent, for mentions and live updates.
 */
const INBOX_CONVERSATION_TESTS = /inbox[\\/](conversation|instagram|workflows)[\\/].*\.spec\.ts/;

/**
 * Quarantine: a flaky test tagged @quarantine (with a comment saying why and since when) is left out
 * of every normal run, so it cannot turn the daily run red, and runs on its own with
 * `npm run test:quarantine` (QUARANTINE_TESTS=true). On CI that run comes after the regression and
 * only warns. Fix it within a week, then remove the tag. See README, "Flaky tests".
 */
const QUARANTINE = /@quarantine/;
const quarantineRun = process.env.QUARANTINE_TESTS === 'true';

/**
 * The smoke tests on other browsers and on phones, and the screenshot comparisons, only when asked
 * for: `npm run test:browsers` (CROSS_BROWSER=true) and `npm run test:visual` (VISUAL=true). Normal
 * runs leave them out, so they need only Chromium. They run weekly on CI (Linux), where the
 * reference screenshots are taken. See README, "Browsers and screenshots".
 */
const CROSS_BROWSERS = {
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
  'mobile-chrome': devices['Pixel 7'],
  'mobile-safari': devices['iPhone 15'],
};
const crossBrowserRun = process.env.CROSS_BROWSER === 'true';
const visualRun = process.env.VISUAL === 'true';
const VISUAL_TESTS = /visual[\\/].*\.spec\.ts/;

/** A project's tag filter: its own grep/grepInvert, plus leaving out (or only running) quarantine. */
function tagFilter(grep?: RegExp, grepInvert?: RegExp): { grep?: RegExp; grepInvert?: RegExp[] } {
  if (quarantineRun) {
    return {
      // Both the project's own tag (e.g. @smoke) and @quarantine.
      grep: grep ? new RegExp(`^(?=.*${grep.source})(?=.*${QUARANTINE.source})`) : QUARANTINE,
      grepInvert: grepInvert ? [grepInvert] : undefined,
    };
  }
  return { grep, grepInvert: [...(grepInvert ? [grepInvert] : []), QUARANTINE] };
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  // A stray test.only must never silently shrink the CI run.
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // The beta server can take a few seconds to show new data, so allow 10s per check.
  expect: { timeout: 10_000 },
  // Total time per test. UI tests load the app up to 4 times, and on a busy machine each load can
  // take 10-15 s before the app even asks for its data. Each single check still has only 10 s.
  timeout: 120_000,

  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['./reporters/failure-reporter.ts'],
    // Writes failed tests to the shared Google Sheet as test cases (see README, "Failed tests sheet").
    ['./reporters/failed-tests-sheet-reporter.ts'],
    // On GitHub Actions: a pass/fail table on the run's summary page.
    ['./reporters/github-summary-reporter.ts'],
  ],
  outputDir: './test-results',

  use: {
    baseURL: env.baseUrl,
    // The app asks "Turn on desktop notifications?" while this permission is undecided, and the
    // dialog gets in the way of tests. Granting it up front means the app never asks.
    permissions: ['notifications'],
    headless: isHeadless,
    // Slow actions down only when the browser is visible, so you can follow along.
    launchOptions: { slowMo: isHeadless ? 0 : 300 },
    screenshot: { mode: 'only-on-failure', fullPage: true },
    trace: 'retain-on-failure',
  },

  projects: [
    // Logs in once and saves the session that the other projects reuse.
    {
      name: 'setup',
      testDir: './tests/setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // The same for the limited Agent account, used only by the permission tests. A project of its
    // own, so a failed Agent login never stops the other tests.
    {
      name: 'agent-setup',
      testDir: './tests/setup',
      testMatch: /agent\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Quick check that the app is up: login, and one key page per area (tests tagged @smoke).
    // They start logged in, except the login test, which logs in itself.
    {
      name: 'smoke',
      ...tagFilter(/@smoke/),
      testIgnore: [
        API_TESTS,
        EXCLUSIVE_TESTS,
        WORKSPACE_SETTINGS_TESTS,
        PERMISSION_TESTS,
        INBOX_CONVERSATION_TESTS,
        VISUAL_TESTS,
      ],
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
    },
    ...(crossBrowserRun
      ? Object.entries(CROSS_BROWSERS).map(([name, device]) => ({
          name,
          ...tagFilter(/@smoke/),
          testIgnore: [API_TESTS, EXCLUSIVE_TESTS, WORKSPACE_SETTINGS_TESTS, PERMISSION_TESTS, VISUAL_TESTS],
          dependencies: ['setup'],
          use: { ...device, storageState: AUTH_FILE },
        }))
      : []),
    // Screenshot comparisons against reference images in tests/visual/*-snapshots (taken on Linux).
    ...(visualRun
      ? [
          {
            name: 'visual',
            testMatch: VISUAL_TESTS,
            dependencies: ['setup'],
            use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
          },
        ]
      : []),
    // Browser tests of the user interface: every *.spec.ts that is not an API test.
    {
      name: 'ui',
      ...tagFilter(undefined, /@smoke/),
      testIgnore: [
        API_TESTS,
        EXCLUSIVE_TESTS,
        WORKSPACE_SETTINGS_TESTS,
        PERMISSION_TESTS,
        INBOX_CONVERSATION_TESTS,
        VISUAL_TESTS,
      ],
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
    },
    // API tests (*.api.spec.ts). A headless browser is still used, only to get login tokens.
    {
      name: 'api',
      testMatch: API_TESTS,
      ...tagFilter(),
      testIgnore: [EXCLUSIVE_TESTS, WORKSPACE_SETTINGS_TESTS, PERMISSION_TESTS, INBOX_CONVERSATION_TESTS],
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: AUTH_FILE,
        headless: true,
        launchOptions: { slowMo: 0 },
      },
    },
    // Workspace-wide settings (UI and API): one test at a time, next to the parallel projects.
    {
      name: 'workspace-settings',
      testMatch: WORKSPACE_SETTINGS_TESTS,
      ...tagFilter(),
      dependencies: ['setup'],
      workers: 1,
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
    },
    // Before the inbox tests: switch on the workflow that the next morning's message should start.
    // Its teardown runs after them and closes the test conversation (tests/inbox/setup).
    {
      name: 'inbox-setup',
      testDir: './tests/inbox/setup',
      testMatch: /inbox\.setup\.ts/,
      dependencies: ['setup'],
      teardown: 'inbox-teardown',
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
    },
    {
      name: 'inbox-teardown',
      testDir: './tests/inbox/setup',
      testMatch: /inbox\.teardown\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
    },
    // The shared Instagram conversation (UI and API): one test at a time, next to the parallel projects.
    {
      name: 'inbox',
      testMatch: INBOX_CONVERSATION_TESTS,
      ...tagFilter(),
      dependencies: ['setup', 'agent-setup', 'inbox-setup'],
      workers: 1,
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
    },
    // What the Agent role may and may not do (UI and API), logged in as the Agent.
    {
      name: 'permissions',
      testMatch: PERMISSION_TESTS,
      ...tagFilter(),
      dependencies: ['agent-setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: hasAgentAccount ? AGENT_AUTH_FILE : undefined,
      },
    },
    // Deletes old test data (only records marked "qa" + 6 digits) when SWEEP_TEST_DATA=true:
    // `npm run test:sweep`. See tests/cleanup.
    {
      name: 'cleanup',
      testDir: './tests/cleanup',
      testMatch: /.*\.cleanup\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: AUTH_FILE,
        headless: true,
        launchOptions: { slowMo: 0 },
      },
    },
    // Exclusive tests (UI and API): on their own, after everything else, one test at a time.
    {
      name: 'exclusive',
      testMatch: EXCLUSIVE_TESTS,
      ...tagFilter(),
      dependencies: ['setup'],
      workers: 1,
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
    },
  ],
});
