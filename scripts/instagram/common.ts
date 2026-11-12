import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

/**
 * The Instagram sender: a throwaway account that DMs the Instagram account connected to Replyn once a
 * day, so the inbox tests always have a fresh inbound message to find and reply to.
 * See README, "Daily Instagram message".
 */

/** Where the sender's logged-in session is kept. /secrets/ is git-ignored. */
export const SESSION_FILE = path.join('secrets', 'instagram-sender.json');

/** Every daily message starts with this, then the UTC date, so tests can find today's message. */
export const MESSAGE_PREFIX = 'AUTOTEST';

/** The sender's login, needed only by `npm run instagram:login` (so never on CI). */
export function getSenderLogin(): { username: string; password: string } {
  const username = process.env.IG_SENDER_USERNAME?.trim();
  const password = process.env.IG_SENDER_PASSWORD?.trim();
  if (!username || !password) {
    throw new Error('IG_SENDER_USERNAME and IG_SENDER_PASSWORD must be set in .env');
  }
  return { username, password };
}

/** The Instagram account connected to Replyn, which the sender messages (without the @). */
export function getReceiverHandle(): string {
  const handle = process.env.IG_RECEIVER_HANDLE?.trim().replace(/^@/, '');
  if (!handle) throw new Error('IG_RECEIVER_HANDLE must be set (.env locally, a repository secret on CI)');
  return handle;
}

/**
 * On CI the session arrives base64-encoded in IG_SENDER_SESSION (a repository secret); write it to
 * SESSION_FILE so both runs read it the same way. Returns false when there is no session at all.
 */
export function ensureSessionFile(): boolean {
  const fromSecret = process.env.IG_SENDER_SESSION?.trim();
  if (fromSecret) {
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    fs.writeFileSync(SESSION_FILE, Buffer.from(fromSecret, 'base64').toString('utf8'));
  }
  return fs.existsSync(SESSION_FILE);
}

/** Today's date in UTC, e.g. 2026-11-12. The inbox tests compute the same value. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Closes the pop-ups Instagram shows after login ("Save login info?", "Turn on notifications"). */
export async function dismissPopups(page: Page): Promise<void> {
  for (const name of [/^Not now$/i, /^Allow all cookies$/i, /^Decline optional cookies$/i]) {
    const button = page.getByRole('button', { name }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click().catch(() => {});
      await page.waitForTimeout(800);
    }
  }
}

export function pause(min: number, max: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, min + Math.random() * (max - min)));
}
