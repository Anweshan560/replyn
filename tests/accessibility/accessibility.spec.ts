import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/test';
import baseline from './a11y-baseline.json';

/**
 * Accessibility checks with axe (WCAG 2.1 A and AA) on the main pages. Every page already breaks
 * some rules, listed in a11y-baseline.json; a test fails only when a page breaks a rule that is not
 * listed (something new got worse). The full axe result is attached to the report either way.
 * Read only: pages are opened, nothing is changed. See README, "Accessibility checks".
 */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

type BaselinePage = keyof typeof baseline.pages;

async function checkPage(page: Page, name: BaselinePage): Promise<void> {
  // Wait for the page's data, so the scan sees the finished page.
  await page.waitForLoadState('networkidle').catch(() => {});
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  await test.info().attach(`axe ${name}`, {
    body: JSON.stringify(result.violations, null, 2),
    contentType: 'application/json',
  });

  const known: string[] = baseline.pages[name];
  const found = result.violations.map((violation) => violation.id);
  const fixed = known.filter((rule) => !found.includes(rule));
  if (fixed.length) {
    test.info().annotations.push({
      type: 'accessibility improved',
      description: `${name} no longer breaks: ${fixed.join(', ')}. Remove them from tests/accessibility/a11y-baseline.json.`,
    });
  }

  const newProblems = result.violations
    .filter((violation) => !known.includes(violation.id))
    .map(
      (v) => `[${v.impact}] ${v.id} (${v.nodes.length}×): ${v.help}. First: ${v.nodes[0]?.target.join(' ')}`,
    );
  expect(newProblems, `new accessibility problems on ${name}`).toEqual([]);
}

test.describe('Accessibility', { tag: ['@a11y'] }, () => {
  test.describe('logged out', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('should not break new accessibility rules on the login page', async ({ page, loginPage }) => {
      await loginPage.open();
      await checkPage(page, '/login');
    });
  });

  for (const path of [
    '/dashboard',
    '/contacts',
    '/appointments',
    '/broadcasts',
    '/workflows',
    '/reports',
    '/settings/tags',
  ] as const) {
    test(`should not break new accessibility rules on ${path}`, async ({ page }) => {
      await page.goto(path);
      await checkPage(page, path);
    });
  }

  test('should not break new accessibility rules on the inbox', async ({ page, workspaceId }) => {
    await page.goto(`/inbox/${workspaceId}`);
    await checkPage(page, '/inbox');
  });
});
