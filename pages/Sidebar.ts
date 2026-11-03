import type { Locator, Page } from '@playwright/test';
import { AccountMenu } from './AccountMenu';

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
