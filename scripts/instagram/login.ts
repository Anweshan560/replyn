/**
 * One-time (and whenever the session expires) login as the Instagram sender.
 *
 *   npm run instagram:login
 *
 * Opens a visible browser, fills in the sender's username and password, then waits while you deal
 * with anything Instagram asks (a code, "Was this you?"). Once logged in it saves the session to
 * secrets/instagram-sender.json and prints the base64 value for the IG_SENDER_SESSION GitHub secret
 * to a file next to it. The daily job reuses that session and never types the password.
 */
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import { SESSION_FILE, dismissPopups, getSenderLogin, pause } from './common';

const WAIT_FOR_LOGIN_MS = 5 * 60_000;

async function main(): Promise<void> {
  const { username, password } = getSenderLogin();
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();

  await page.goto('https://www.instagram.com/accounts/login/');
  await pause(1500, 2500);
  await dismissPopups(page);

  const usernameBox = page.locator('input[name="username"], input[name="email"]').first();
  await usernameBox.waitFor({ timeout: 30_000 });
  await usernameBox.pressSequentially(username, { delay: 90 });
  await pause(400, 900);
  await page
    .locator('input[name="password"], input[name="pass"]')
    .first()
    .pressSequentially(password, { delay: 90 });
  await pause(400, 900);
  await page.keyboard.press('Enter');

  console.log('\nLogging in. If Instagram asks for a code or "Was this you?", answer it in the browser.');
  console.log(`Waiting up to ${WAIT_FOR_LOGIN_MS / 60_000} minutes...\n`);

  const deadline = Date.now() + WAIT_FOR_LOGIN_MS;
  while (Date.now() < deadline) {
    const cookies = await context.cookies('https://www.instagram.com');
    const loggedIn = cookies.some((c) => c.name === 'sessionid' && c.value);
    if (loggedIn && !/\/(accounts\/login|challenge|two_factor)/.test(page.url())) break;
    await page.waitForTimeout(2000);
  }
  if (!(await context.cookies('https://www.instagram.com')).some((c) => c.name === 'sessionid')) {
    await browser.close();
    throw new Error('Not logged in after 5 minutes. Run `npm run instagram:login` again.');
  }

  await pause(2000, 3000);
  await dismissPopups(page);
  await context.storageState({ path: SESSION_FILE });
  const secretFile = `${SESSION_FILE}.base64.txt`;
  fs.writeFileSync(secretFile, Buffer.from(fs.readFileSync(SESSION_FILE)).toString('base64'));
  await browser.close();

  console.log(`Logged in. Session saved to ${SESSION_FILE}.`);
  console.log(`For CI: paste the contents of ${secretFile} into the IG_SENDER_SESSION repository secret.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
