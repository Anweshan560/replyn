import { expect, type Locator, type Page } from '@playwright/test';

/** The account menu at the bottom of the sidebar: profile, workspace switcher, preferences. */
export class AccountMenu {
  readonly openButton: Locator;
  readonly menu: Locator;

  constructor(private readonly page: Page) {
    this.openButton = page.getByRole('button', { name: /account menu/ });
    this.menu = page.getByRole('menu', { name: /account menu/ });
  }

  /** The "Switch" entry, named after the current organization and workspace, e.g. "replyn · Testing". */
  private get switchItem(): Locator {
    return this.menu.getByRole('group', { name: 'Switch' }).getByRole('menuitem');
  }

  /**
   * Make `workspace` the current workspace, unless it already is. The app remembers the choice in
   * the browser only, so a fresh login otherwise opens whichever workspace the API lists first.
   */
  async switchWorkspace(workspace: string): Promise<void> {
    await this.openButton.click();
    await expect(this.switchItem).toBeVisible();
    if ((await this.switchItem.textContent())?.endsWith(` · ${workspace}`)) {
      await this.page.keyboard.press('Escape');
      return;
    }
    const workspaces = this.page.getByRole('group', { name: 'Workspaces' });
    const item = workspaces.getByRole('menuitem', { name: workspace, exact: true });
    // A click that lands while the menu is still opening sometimes leaves the list closed, so
    // click again until it opens. A workspace that does not exist fails here after 30 s.
    await expect(async () => {
      if (!(await workspaces.isVisible())) await this.switchItem.click();
      await expect(item).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    await item.click();
    await expect(this.page).toHaveURL('/dashboard');

    await this.openButton.click();
    await expect(this.switchItem).toHaveText(new RegExp(` · ${workspace}$`));
    await this.page.keyboard.press('Escape');
  }
}
