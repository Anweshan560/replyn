import { test as setup, expect } from '../../fixtures/test';
import { AUTH_FILE, env, getCredentials } from '../../config/env';
import { AccountMenu } from '../../pages/AccountMenu';

// Runs once before the UI and API tests: log in and save the session,
// so those tests start already logged in instead of logging in every time.
setup('log in and save the session', async ({ page, loginPage }) => {
  const { email, password } = getCredentials();

  await setup.step('log in with the test account', async () => {
    await loginPage.open();
    await loginPage.logIn(email, password);
    await expect(page).toHaveURL('/dashboard');
  });
  // The saved session includes this choice, so every test starts in the test workspace.
  await setup.step(`switch to the workspace "${env.testWorkspace}"`, () =>
    new AccountMenu(page).switchWorkspace(env.testWorkspace),
  );

  await page.context().storageState({ path: AUTH_FILE });
});
