import { test, expect } from '../../fixtures/test';
import type { NotificationRecord } from '../../api/SidebarApi';
import { ENDPOINTS } from '../../api/ResourceApi';
import { env } from '../../config/env';
import { waitForApiResponse } from '../../utils/network';

// The widgets at the bottom of the sidebar. Read only: the tests never press "Mark all read",
// open a notification (which marks it read), or change availability or dark mode.
test.describe('Sidebar widgets', { tag: ['@sidebar'] }, () => {
  test('should show the unread count on the bell and the latest notifications in its panel', async ({
    page,
    sidebar,
  }) => {
    const countLoaded = waitForApiResponse(page, 'GET', `${ENDPOINTS.notificationsFeed}/unread-count`);
    const feedLoaded = waitForApiResponse(page, 'GET', ENDPOINTS.notificationsFeed);
    await page.goto('/dashboard');
    const count: number = (await (await countLoaded).json()).data.count;
    const feed: NotificationRecord[] = (await (await feedLoaded).json()).data.result;

    await test.step(`the bell says ${count} unread`, async () => {
      await expect(sidebar.notificationsButton).toHaveAccessibleName(
        count ? `Notifications, ${count} unread` : /^Notifications/,
      );
    });
    await test.step('the panel opens with the newest notifications', async () => {
      await sidebar.notificationsButton.click();
      await expect(sidebar.notificationsPanel).toBeVisible();
      for (const notification of feed.slice(0, 3)) {
        await expect(sidebar.notificationsPanel.getByText(notification.title).first()).toBeVisible();
      }
    });
    await test.step('Escape closes it', async () => {
      await page.keyboard.press('Escape');
      await expect(sidebar.notificationsPanel).toBeHidden();
    });
  });

  test('should show the AI credits left and open Settings → Credits', async ({ page, sidebar }) => {
    const balanceLoaded = waitForApiResponse(page, 'GET', `${ENDPOINTS.credits}/balance`);
    await page.goto('/dashboard');
    const credits = Math.floor(Number((await (await balanceLoaded).json()).data.balance));

    await test.step(`the widget says ${credits} left`, async () => {
      await expect(sidebar.creditsLink).toHaveAccessibleName(`AI credits, ${credits} left`);
    });
    await test.step('it opens /settings/credits with the activity list', async () => {
      await sidebar.creditsLink.click();
      await expect(page).toHaveURL('/settings/credits');
      await expect(page.getByText('Activity', { exact: true })).toBeVisible();
      if (credits === 0) await expect(page.getByText('Out of credits')).toBeVisible();
    });
  });

  test('should name the current workspace, the plan and Log out in the account menu', async ({
    page,
    sidebar,
  }) => {
    await page.goto('/dashboard');
    await sidebar.accountMenu.openButton.click();
    const menu = sidebar.accountMenu.menu;

    await test.step(`Switch names the test workspace "${env.testWorkspace}"`, async () => {
      await expect(menu.getByRole('group', { name: 'Switch' })).toContainText(` · ${env.testWorkspace}`);
    });
    await test.step('Plan, Profile, Dark mode, Help and Log out are offered', async () => {
      await expect(menu.getByRole('group', { name: 'Plan' }).getByRole('menuitem')).toBeVisible();
      for (const item of ['Profile', 'Dark mode', 'Help & information', 'Log out']) {
        await expect(menu.getByRole('menuitem', { name: item })).toBeVisible();
      }
    });
    await test.step('Escape closes it', async () => {
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
    });
  });

  test('should open the search box from Search', async ({ page, sidebar }) => {
    await page.goto('/dashboard');
    await sidebar.searchButton.click();
    await expect(sidebar.searchBox).toBeVisible();
  });

  test('should open Tutorials and Settings from their links', async ({ page, sidebar }) => {
    await page.goto('/dashboard');

    await test.step('Tutorials', async () => {
      await sidebar.tutorialsLink.click();
      await expect(page).toHaveURL(/\/tutorials/);
      await expect(page.getByText('Tutorials').first()).toBeVisible();
    });
    await test.step('Settings', async () => {
      await sidebar.settingsLink.click();
      await expect(page).toHaveURL(/\/settings/);
    });
  });
});
