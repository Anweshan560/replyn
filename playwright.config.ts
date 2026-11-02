import { defineConfig, devices } from '@playwright/test';
import { AUTH_FILE, env } from './config/env';

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
      testMatch: /.*\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Quick check that the app is up and login works.
    {
      name: 'smoke',
      grep: /@smoke/,
      testIgnore: [API_TESTS, EXCLUSIVE_TESTS, WORKSPACE_SETTINGS_TESTS],
      use: { ...devices['Desktop Chrome'] },
    },
    // Browser tests of the user interface: every *.spec.ts that is not an API test.
    {
      name: 'ui',
      grepInvert: /@smoke/,
      testIgnore: [API_TESTS, EXCLUSIVE_TESTS, WORKSPACE_SETTINGS_TESTS],
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
    },
    // API tests (*.api.spec.ts). A headless browser is still used, only to get login tokens.
    {
      name: 'api',
      testMatch: API_TESTS,
      testIgnore: [EXCLUSIVE_TESTS, WORKSPACE_SETTINGS_TESTS],
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
      dependencies: ['setup'],
      workers: 1,
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
    },
    // Exclusive tests (UI and API): on their own, after everything else, one test at a time.
    {
      name: 'exclusive',
      testMatch: EXCLUSIVE_TESTS,
      dependencies: ['setup'],
      workers: 1,
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
    },
  ],
});
