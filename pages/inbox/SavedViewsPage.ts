import { expect, type Locator, type Page } from '@playwright/test';
import { ENDPOINTS } from '../../api/ResourceApi';
import { waitForApiResponse } from '../../utils/network';
import { collapseSetupGuide } from '../setupGuide';
import type { SavedViewData } from '../../utils/testData';

/** Where views are saved since the 2026-11-25 redesign: segments of the inbox surface. */
const VIEWS_PATH = new RegExp(`^${ENDPOINTS.segments}/?$`);
const VIEW_PATH = new RegExp(`^${ENDPOINTS.segments}/[^/]+$`);

/**
 * Inbox → Views: saved filters listed in the inbox sidebar. A view is created in the New view
 * dialog (name, who sees it, and filter rules); its actions menu offers Rename and Delete.
 */
export class SavedViewsPage {
  readonly newViewButton: Locator;
  readonly createDialog: Locator;
  readonly sidebar: Locator;

  constructor(
    private readonly page: Page,
    private readonly workspaceId: string,
  ) {
    this.newViewButton = page.getByRole('button', { name: 'New view', exact: true });
    this.createDialog = page.getByRole('dialog', { name: 'New view' });
    this.sidebar = page.getByRole('navigation', { name: 'Inbox navigation' });
  }

  /** The inbox's own address: each workspace has its own inbox. */
  get inboxPath(): string {
    return `/inbox/${this.workspaceId}`;
  }

  /** Go to the inbox through the sidebar, as a user would. */
  async openFromDashboard(): Promise<void> {
    await this.page.goto('/dashboard');
    await this.page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Inbox' })
      .click();
    await expect(this.page).toHaveURL(this.inboxPath);
  }

  /** Open the inbox directly and wait until the saved views have loaded. */
  async open(): Promise<void> {
    const loaded = this.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === ENDPOINTS.segments &&
        new URL(response.url()).searchParams.get('surface') === 'inbox',
    );
    await this.page.goto(this.inboxPath);
    expect((await loaded).ok(), 'the saved views should load').toBe(true);
  }

  /** The view's link in the sidebar. Its name ends with the number of conversations in it. */
  sidebarLink(view: Pick<SavedViewData, 'name'>): Locator {
    return this.sidebar.getByRole('link', { name: new RegExp(`^${escapeRegExp(view.name)}( \\d+)?$`) });
  }

  /**
   * Create a view through the New view dialog, starting from the inbox.
   * @param onFilled runs once the rule is filled in, before Create view (e.g. to read the count).
   * @returns the new view's id, taken from the server's answer.
   */
  async createView(
    view: SavedViewData,
    { onFilled }: { onFilled?: () => Promise<void> } = {},
  ): Promise<string> {
    await this.openCreateDialog();
    await this.fillDialog(view);
    await onFilled?.();
    const created = waitForApiResponse(this.page, 'POST', VIEWS_PATH);
    await this.createDialog.getByRole('button', { name: 'Create view' }).click();
    const response = await created;
    expect(response.status(), 'the server should create the view').toBe(201);
    await expect(this.createDialog).toBeHidden();
    return (await response.json()).data.id;
  }

  /** The dialog's live count, e.g. "80 open conversations match". */
  get matchesText(): Locator {
    return this.createDialog.getByRole('heading', { level: 6 });
  }

  async openCreateDialog(): Promise<void> {
    await this.newViewButton.click();
    await expect(this.createDialog).toBeVisible();
  }

  /** Rename a view from its actions menu: the name turns into a text field in the sidebar. */
  async renameView(view: Pick<SavedViewData, 'name'>, newName: string): Promise<void> {
    await this.chooseAction(view, 'Rename');
    const saved = waitForApiResponse(this.page, 'PUT', VIEW_PATH);
    await this.page.keyboard.press('ControlOrMeta+A');
    await this.page.keyboard.type(newName);
    await this.page.keyboard.press('Enter');
    expect((await saved).ok(), 'the server should save the new name').toBe(true);
  }

  /** Delete a view from its actions menu, confirming the dialog names it. */
  async deleteView(view: Pick<SavedViewData, 'name'>): Promise<void> {
    await this.chooseAction(view, 'Delete');
    const confirm = this.page.getByRole('dialog', { name: 'Delete view?' });
    await expect(confirm).toContainText(view.name);
    const deleted = waitForApiResponse(this.page, 'DELETE', VIEW_PATH);
    await confirm.getByRole('button', { name: 'Delete view' }).click();
    expect((await deleted).ok(), 'the server should delete the view').toBe(true);
    await expect(confirm).toBeHidden();
  }

  /** The actions button shows while the view's link is hovered. */
  private async chooseAction(view: Pick<SavedViewData, 'name'>, action: 'Rename' | 'Delete'): Promise<void> {
    await collapseSetupGuide(this.page);
    await this.sidebarLink(view).hover();
    await this.sidebar.getByRole('button', { name: `${view.name} actions`, exact: true }).click();
    await this.page
      .getByRole('menu', { name: `${view.name} actions` })
      .getByRole('menuitem', { name: action })
      .click();
  }

  /** Fill the name, who sees it, and one rule "<field> contains <value>". */
  private async fillDialog(view: SavedViewData): Promise<void> {
    const dialog = this.createDialog;
    await dialog.getByRole('textbox', { name: 'Name' }).fill(view.name);
    // The radio's input sits under the app's styled circle, which takes the click.
    const share = dialog
      .getByRole('radiogroup', { name: 'Who sees it' })
      .getByRole('radio', { name: view.share });
    // Agents are offered no choice: only check it when the choice is there.
    if (await share.count()) {
      await share.check({ force: true });
      await expect(share).toBeChecked();
    }

    await dialog.getByRole('button', { name: 'Add rule' }).click();
    // The field picker's button has no size; its visible box (a group) takes the click.
    const fieldButton = dialog.getByRole('button', { name: /Filter field$/ }).last();
    await dialog
      .getByRole('group')
      .filter({ has: this.page.getByRole('button', { name: /Filter field$/ }) })
      .last()
      .click();
    await this.page
      .getByRole('dialog', { name: 'Filter field' })
      .getByRole('option', { name: view.rule.field, exact: true })
      .click();
    await expect(fieldButton).toHaveAccessibleName(`${view.rule.field} Filter field`);
    await expect(dialog.getByRole('button', { name: /Select operator$/ }).last()).toHaveText(
      view.rule.operator,
    );
    await dialog.getByRole('textbox', { name: 'Enter value' }).last().fill(view.rule.value);
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
