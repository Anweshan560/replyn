import { test as setup, expect } from '../../fixtures/test';
import { NO_EMR_AGENT_AUTH_FILE, env, getNoEmrAgentCredentials } from '../../config/env';
import { AccountMenu } from '../../pages/AccountMenu';

// Runs once before the tests in tests/clinic/no-emr: log in with the Agent account of the workspace
// without an EMR (TEST_AGENT_USERNAME1) and save its session, switched to that workspace.
setup(
  'log in as the Agent of the workspace without an EMR and save the session',
  async ({ page, loginPage }) => {
    const credentials = getNoEmrAgentCredentials();
    setup.skip(!credentials, 'TEST_AGENT_USERNAME1 and TEST_AGENT_PASSWORD1 are not set');

    await setup.step('log in with the Agent account', async () => {
      await loginPage.open();
      await loginPage.logIn(credentials!.email, credentials!.password);
      await expect(page).toHaveURL('/dashboard');
    });
    await setup.step(`switch to the workspace "${env.noEmrWorkspace}"`, () =>
      new AccountMenu(page).switchWorkspace(env.noEmrWorkspace),
    );

    await page.context().storageState({ path: NO_EMR_AGENT_AUTH_FILE });
  },
);
