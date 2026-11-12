/**
 * Sends today's message from the Instagram sender to the account connected to Replyn.
 *
 *   npm run instagram:send            (no visible browser)
 *   npm run instagram:send -- --headed
 *   npm run instagram:send -- --check    (only checks the session is still valid; sends nothing)
 *
 * Uses the session saved by `npm run instagram:login` (or the IG_SENDER_SESSION secret on CI).
 * Exit codes: 0 sent, 2 session expired (log in again), 1 anything else.
 */
import fs from 'node:fs';
import { chromium, type Page } from '@playwright/test';
import {
  MESSAGE_PREFIX,
  SESSION_FILE,
  dismissPopups,
  ensureSessionFile,
  getReceiverHandle,
  pause,
  todayUtc,
} from './common';

const SESSION_EXPIRED = 2;

/** A little variety, so the account does not send the identical text every day. */
const GREETINGS = [
  'Hi! Quick question about your services.',
  'Hello, is anyone available today?',
  'Hey there, could you get back to me?',
  'Good morning! Just checking in.',
  'Hi, I would like some information please.',
];

class SessionExpiredError extends Error {}

function buildMessage(): string {
  const time = new Date().toISOString().slice(11, 16);
  const greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
  return `${MESSAGE_PREFIX} ${todayUtc()} ${time} ${greeting}`;
}

async function assertLoggedIn(page: Page): Promise<void> {
  if (/\/accounts\/login|\/challenge/.test(page.url())) {
    throw new SessionExpiredError('The Instagram session has expired. Run `npm run instagram:login`.');
  }
}

async function openThread(page: Page, receiverHandle: string): Promise<void> {
  await page.goto(`https://www.instagram.com/${receiverHandle}/`);
  await pause(2500, 4000);
  await assertLoggedIn(page);
  await dismissPopups(page);

  const messageButton = page
    .getByRole('button', { name: /^Message$/ })
    .or(page.getByRole('link', { name: /^Message$/ }))
    .first();
  await messageButton.waitFor({ timeout: 20_000 });
  await pause(800, 1500);
  await messageButton.click();
  await pause(3000, 5000);
  await assertLoggedIn(page);
  await dismissPopups(page);
}

/** Open the DM inbox, as the sender would, and fail if Instagram asks to log in again. */
async function checkSession(page: Page): Promise<void> {
  await page.goto('https://www.instagram.com/direct/inbox/');
  await pause(3000, 5000);
  await assertLoggedIn(page);
  const cookies = await page.context().cookies('https://www.instagram.com');
  if (!cookies.some((c) => c.name === 'sessionid' && c.value)) {
    throw new SessionExpiredError('The Instagram session has expired. Run `npm run instagram:login`.');
  }
}

async function main(): Promise<void> {
  const receiverHandle = getReceiverHandle();
  if (!ensureSessionFile()) {
    throw new SessionExpiredError('No Instagram session found. Run `npm run instagram:login` first.');
  }
  const headed = process.argv.includes('--headed');
  const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 200 : 0 });
  const context = await browser.newContext({
    storageState: SESSION_FILE,
    locale: 'en-US',
    viewport: { width: 1280, height: 860 },
  });
  const page = await context.newPage();

  try {
    if (process.argv.includes('--check')) {
      await checkSession(page);
      console.log('The Instagram session is valid.');
      return;
    }
    await openThread(page, receiverHandle);

    const composer = page
      .getByRole('textbox', { name: /message/i })
      .or(page.locator('div[contenteditable="true"][role="textbox"]'))
      .first();
    await composer.waitFor({ timeout: 20_000 });

    const message = buildMessage();
    await composer.click();
    await composer.pressSequentially(message, { delay: 70 });
    await pause(500, 1200);
    await page.keyboard.press('Enter');

    // Sent once the text shows in the thread (and the composer is empty again).
    await page.getByText(message, { exact: true }).last().waitFor({ timeout: 20_000 });
    await pause(1500, 2500);

    // Instagram refreshes its cookies; keep the newest ones for next time (locally; CI uses the secret).
    await context.storageState({ path: SESSION_FILE });
    console.log(`Sent to @${receiverHandle}: ${message}`);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `message=${message}\n`);
  } catch (error) {
    await page
      .screenshot({ path: 'test-results/instagram-send-failure.png', fullPage: true })
      .catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(error instanceof SessionExpiredError ? SESSION_EXPIRED : 1);
});
