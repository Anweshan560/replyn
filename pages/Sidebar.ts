import { expect, type Locator, type Page } from '@playwright/test';
import { AccountMenu } from './AccountMenu';

/**
 * Open a page from a collapsible group of the main sidebar, e.g. Clinic → Doctors.
 *
 * Since the 2026-11-25 redesign the sidebar is a narrow rail of icons. Hovering it opens the full
 * menu, where a group like Clinic is a button that expands to show its pages (its rail icon is
 * a link that only goes to the group's first page). The menu can close again if the mouse leaves
 * it before the click lands, so the whole sequence is retried.
 * @param group the group's name, e.g. "Clinic"
 * @param linkName the page inside it, e.g. "Doctors". A count after the name ("Appointments 59")
 *   is allowed.
 */
export async function openFromSidebarGroup(page: Page, group: string, linkName: string): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const groupLinks = nav.getByRole('group', { name: group });
  const escaped = linkName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const link = groupLinks.getByRole('link', { name: new RegExp(`^${escaped}( \\d+)?$`) });
  const groupButton = nav.getByRole('button', { name: group, exact: true });
  await expect(async () => {
    if (!(await groupLinks.isVisible())) {
      // Hovering the rail turns the group's icon into its expand button.
      await nav.getByRole('link', { name: group, exact: true }).or(groupButton).hover({ timeout: 5_000 });
      if ((await groupButton.getAttribute('aria-expanded', { timeout: 5_000 })) !== 'true') {
        await groupButton.click({ timeout: 5_000 });
      }
    }
    await link.click({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
}

/**
 * The widgets at the bottom of the sidebar (the app has no top bar): Search, Tutorials, Settings,
 * AI credits, Notifications and the account menu. Their accessible names carry the numbers, e.g.
 * "AI credits, 0 left" and "Notifications, 2 unread".
 */
export class Sidebar {
  readonly searchButton: Locator;
  /** Shown once Search expands the sidebar. */
  readonly searchBox: Locator;
  readonly tutorialsLink: Locator;
  readonly settingsLink: Locator;
  readonly creditsLink: Locator;
  readonly notificationsButton: Locator;
  readonly notificationsPanel: Locator;
  readonly accountMenu: AccountMenu;

  constructor(page: Page) {
    const sidebar = page.getByRole('complementary');
    this.searchButton = sidebar.getByRole('button', { name: 'Search', exact: true });
    this.searchBox = sidebar.getByRole('textbox', { name: /search/i }).or(sidebar.getByPlaceholder('Search'));
    this.tutorialsLink = sidebar.getByRole('link', { name: 'Tutorials', exact: true });
    this.settingsLink = sidebar.getByRole('link', { name: 'Settings', exact: true });
    this.creditsLink = sidebar.getByRole('link', { name: /^AI credits/ });
    this.notificationsButton = sidebar.getByRole('button', { name: /^Notifications/ }).last();
    this.notificationsPanel = page.getByRole('dialog').filter({ has: page.getByText('Mark all read') });
    this.accountMenu = new AccountMenu(page);
  }
}
