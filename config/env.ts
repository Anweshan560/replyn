import 'dotenv/config';

/**
 * Everything the suite reads from the environment: `.env` locally, repository secrets on CI.
 * Defaults point at the beta environment so only credentials are mandatory.
 */
export const env = {
  /** The web app under test. */
  baseUrl: process.env.BASE_URL || 'https://beta.replyn.dev',
  /** The app's REST API. */
  apiUrl: process.env.API_URL || 'https://api.replyn.dev',
  /** Clerk, the service that handles login. Public: it is in the app's own sign-in page. */
  clerkUrl: process.env.CLERK_URL || 'https://expert-albacore-78.clerk.accounts.dev',
  /**
   * The workspace every test runs in, by name. Setup switches to it after logging in: the app
   * otherwise opens whichever workspace its API happens to list first, which can change.
   */
  testWorkspace: process.env.TEST_WORKSPACE || 'Testing',
  /** Sent as `x-tenant-id` on every API call. */
  tenantId: process.env.TENANT_ID || 'replyn',
  /**
   * Slowest acceptable API response. Normal responses take 100–300 ms; the budget leaves
   * room for network noise so the check only fails on a real slowdown.
   */
  apiResponseBudgetMs: Number(process.env.API_RESPONSE_BUDGET_MS) || 3000,
  /**
   * Exclusive tests change settings the other tests rely on: the organization (switching its type
   * hides the Clinic menu), the workspace's hours, lifecycle stages, assignment rules and AI. They
   * must never run alongside other tests, so they run only when this is "true", which
   * `npm run test:exclusive` (and `test:all`, after everything else) sets.
   */
  runExclusiveTests: process.env.EXCLUSIVE_TESTS === 'true',
  /**
   * The clean-up job (tests/cleanup) deletes old test data only when this is "true", which
   * `npm run test:sweep` sets. With SWEEP_DRY_RUN=true it only lists what it would delete.
   */
  sweepTestData: process.env.SWEEP_TEST_DATA === 'true',
  sweepDryRun: process.env.SWEEP_DRY_RUN === 'true',
} as const;

/** Where tests/setup/auth.setup.ts saves the logged-in browser session. */
export const AUTH_FILE = 'playwright/.auth/user.json';

/** Where tests/setup/agent.setup.ts saves the Agent account's session, for the permission tests. */
export const AGENT_AUTH_FILE = 'playwright/.auth/agent.json';

/**
 * The second, limited test account (role "Agent" in the test workspace), or undefined when
 * TEST_AGENT_USERNAME / TEST_AGENT_PASSWORD are not set. The permission tests skip without it.
 */
export function getAgentCredentials(): Credentials | undefined {
  const email = process.env.TEST_AGENT_USERNAME;
  const password = process.env.TEST_AGENT_PASSWORD;
  return email && password ? { email, password } : undefined;
}

/** Login details of the test account. */
export type Credentials = {
  email: string;
  password: string;
};

/**
 * Read the test account from the environment.
 * Throws inside the test that needs it, so other tests still run when it is missing.
 */
export function getCredentials(): Credentials {
  const email = process.env.TEST_USERNAME;
  const password = process.env.TEST_PASSWORD;
  if (!email || !password) {
    throw new Error('TEST_USERNAME and TEST_PASSWORD must be set in .env');
  }
  return { email, password };
}
