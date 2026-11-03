import { test as setup, expect } from '../../fixtures/test';
import { AGENT_AUTH_FILE, env, getAgentCredentials } from '../../config/env';
import { AccountMenu } from '../../pages/AccountMenu';

// Runs once before the permission tests: log in with the limited Agent account and save its
// session, like auth.setup.ts does for the main (admin) account.
setup('log in as the Agent and save the session', async ({ page, loginPage }) => {
  const credentials = getAgentCredentials();
  setup.skip(!credentials, 'TEST_AGENT_USERNAME and TEST_AGENT_PASSWORD are not set');

  await setup.step('log in with the Agent account', async () => {
    await loginPage.open();
    await loginPage.logIn(credentials!.email, credentials!.password);
    await expect(page).toHaveURL('/dashboard');
  });
  // The Agent is in more than one workspace; the permission tests check the test workspace.
  await setup.step(`switch to the workspace "${env.testWorkspace}"`, () =>
    new AccountMenu(page).switchWorkspace(env.testWorkspace),
  );

  await page.context().storageState({ path: AGENT_AUTH_FILE });
});
