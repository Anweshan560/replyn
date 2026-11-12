import { test, expect } from '../../fixtures/test';

/**
 * Screenshot comparison of parts of the app that should look the same every week: the login page,
 * the main sidebar and the Settings menu. Anything that changes from day to day (trial days left,
 * unread counts, the setup guide) is masked. Reference images live next to this file in
 * visual.spec.ts-snapshots/, taken on Linux by the weekly CI workflow; a difference of more than 1%
 * of the pixels fails. Runs only with `npm run test:visual` (VISUAL=true). See README, "Browsers and
 * screenshots".
 */
const options = { maxDiffPixelRatio: 0.01, animations: 'disabled' as const };

test.describe('Visual comparison', { tag: ['@visual'] }, () => {
  test.describe('logged out', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('should look the same: login page', async ({ page, loginPage }) => {
      await loginPage.open();
      await page.waitForLoadState('networkidle').catch(() => {});
      await expect(page).toHaveScreenshot('login.png', { ...options, fullPage: true });
    });
  });

  test('should look the same: main sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    const sidebar = page
      .getByRole('complementary')
      .filter({ has: page.getByRole('navigation', { name: 'Main navigation' }) });
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toHaveScreenshot('main-sidebar.png', {
      ...options,
      mask: [
        page.getByRole('button', { name: /^Free trial/ }),
        page.getByRole('button', { name: /^AI credits/ }),
        page.getByRole('button', { name: /^Setup,/ }),
        page.getByRole('button', { name: 'Notifications' }),
        page.getByRole('button', { name: /account menu/ }),
      ],
    });
  });

  test('should look the same: Settings menu', async ({ page }) => {
    await page.goto('/settings');
    const menu = page
      .getByRole('navigation')
      .filter({ hasNot: page.getByRole('link', { name: 'Inbox' }) })
      .first();
    await expect(menu).toBeVisible();
    await expect(menu).toHaveScreenshot('settings-menu.png', options);
  });
});
