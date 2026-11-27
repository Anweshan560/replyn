import { test as setup, expect } from '../../fixtures/test';
import { NO_EMR_AUTH_FILE, env, getCredentials } from '../../config/env';
import { AccountMenu } from '../../pages/AccountMenu';

// Runs once before the tests in tests/clinic/no-emr: log in with the main account, like
// auth.setup.ts, but switch to the workspace without an EMR, where Replyn records money itself.
setup('log in and save the session for the workspace without an EMR', async ({ page, loginPage }) => {
  const { email, password } = getCredentials();

  await setup.step('log in with the test account', async () => {
    await loginPage.open();
    await loginPage.logIn(email, password);
    await expect(page).toHaveURL('/dashboard');
  });
  await setup.step(`switch to the workspace "${env.noEmrWorkspace}"`, () =>
    new AccountMenu(page).switchWorkspace(env.noEmrWorkspace),
  );

  await page.context().storageState({ path: NO_EMR_AUTH_FILE });
});
