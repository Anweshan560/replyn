import type { Locator, Page } from '@playwright/test';

/**
 * What a user with a limited role sees: the sidebar links their role allows, and the
 * "You don't have access to this" message on pages it doesn't.
 */
export class AccessPage {
  /** The links in the sidebar (Home, Inbox, Contacts, ...). */
  readonly sidebarLinks: Locator;
  readonly noAccessHeading: Locator;

  constructor(private readonly page: Page) {
    this.sidebarLinks = page.getByRole('navigation').getByRole('link');
    this.noAccessHeading = page.getByText("You don't have access to this");
  }

  /** Open a page by its URL, as a user would by typing it or following an old link. */
  async open(path: string): Promise<void> {
    await this.page.goto(path);
  }

  /** The message naming the permission the role is missing, e.g. "Can manage roles". */
  missingPermission(permission: string): Locator {
    return this.page.getByText(`Ask a workspace admin to add “${permission}” to your role.`);
  }

  /** Each sidebar link's address without ids, e.g. "/inbox" for "/inbox/<workspace id>". */
  async sidebarPaths(): Promise<string[]> {
    await this.sidebarLinks.first().waitFor();
    const hrefs = await this.sidebarLinks.evaluateAll((links) =>
      links.map((link) => link.getAttribute('href') ?? ''),
    );
    return hrefs.map((href) => href.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}/g, ''));
  }
}
