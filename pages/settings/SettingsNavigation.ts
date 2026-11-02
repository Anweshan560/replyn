import { expect, type Locator, type Page } from '@playwright/test';

/** The Settings menu: reached from the sidebar's Settings link, grouped into collapsible sections. */
export class SettingsNavigation {
  readonly menu: Locator;

  constructor(private readonly page: Page) {
    this.menu = page.getByRole('navigation', { name: 'Settings navigation' });
  }

  /**
   * Go from the dashboard to a settings page as a user would: sidebar → Settings → group → page.
   * @param group the section, e.g. "Organization"
   * @param pageName the link inside it, e.g. "Members"
   */
  async openFromDashboard(group: string, pageName: string): Promise<void> {
    await this.page.goto('/dashboard');
    await this.page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(this.page).toHaveURL('/settings');

    const groupLinks = this.menu.getByRole('group', { name: group });
    const link = groupLinks.getByRole('link', { name: pageName, exact: true });
    // A pop-up "Settings" menu sometimes opens over the navigation (seen on CI) and swallows the
    // click, so close any open menu with Escape and try again until the click goes through.
    await expect(async () => {
      if (await this.page.getByRole('menu').first().isVisible()) {
        await this.page.keyboard.press('Escape');
      }
      // Sections start collapsed; open this one unless it already is.
      if (!(await groupLinks.isVisible())) {
        await this.menu.getByRole('button', { name: group, exact: true }).click({ timeout: 5_000 });
      }
      await link.click({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  }
}
