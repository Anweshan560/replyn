import { expect, type Locator, type Page } from '@playwright/test';
import { ENDPOINTS } from '../../api/ResourceApi';
import { waitForApiResponse } from '../../utils/network';
import { collapseSetupGuide } from '../setupGuide';
import type { SavedViewData } from '../../utils/testData';

/**
 * Inbox → Views: saved filters listed in the inbox sidebar. A view is created and edited in a
 * dialog with one or more filter rules; its "Manage" menu offers Edit and Delete.
 */
export class SavedViewsPage {
  readonly newViewButton: Locator;
  readonly createDialog: Locator;
  readonly editDialog: Locator;

  constructor(
    private readonly page: Page,
    private readonly workspaceId: string,
  ) {
    this.newViewButton = page.getByRole('button', { name: 'New view', exact: true });
    this.createDialog = page.getByRole('dialog', { name: 'New view' });
    this.editDialog = page.getByRole('dialog', { name: 'Edit view' });
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
    const loaded = waitForApiResponse(this.page, 'GET', ENDPOINTS.customViews);
    await this.page.goto(this.inboxPath);
    expect((await loaded).ok(), 'the saved views should load').toBe(true);
  }

  /** The view's link in the sidebar, e.g. "🚀 VIP patients". */
  sidebarLink(view: SavedViewData): Locator {
    return this.page.getByRole('link', { name: `${view.icon.emoji} ${view.name}`, exact: true });
  }

  /**
   * Create a view through the New view dialog, starting from the inbox. The sidebar's "Advanced
   * filters" opens the same dialog as "New view".
   * @param onFilled runs once the rule is filled in, before Create view (e.g. to read "Matches …").
   * @returns the new view's id, taken from the server's answer.
   */
  async createView(
    view: SavedViewData,
    {
      from = 'New view',
      onFilled,
    }: { from?: 'New view' | 'Advanced filters'; onFilled?: () => Promise<void> } = {},
  ): Promise<string> {
    if (from === 'Advanced filters') {
      await this.page.getByRole('button', { name: 'Advanced filters', exact: true }).click();
      await expect(this.createDialog).toBeVisible();
    } else {
      await this.openCreateDialog();
    }
    await this.createDialog.getByRole('button', { name: 'Add rule' }).click();
    await this.fillDialog(this.createDialog, view);
    await onFilled?.();
    const created = waitForApiResponse(this.page, 'POST', ENDPOINTS.customViews);
    await this.createDialog.getByRole('button', { name: 'Create view' }).click();
    const response = await created;
    expect(response.status(), 'the server should create the view').toBe(201);
    await expect(this.createDialog).toBeHidden();
    return (await response.json()).data.id;
  }

  /** The dialog's live count, e.g. "Matches 3 open conversations". */
  get matchesText(): Locator {
    return this.createDialog.getByText(/^Matches \d+ open conversations?$/);
  }

  async openCreateDialog(): Promise<void> {
    await this.newViewButton.click();
    await expect(this.createDialog).toBeVisible();
  }

  /** Reload, open the view's edit dialog and check it shows exactly `view`. */
  async expectSavedValues(view: SavedViewData): Promise<void> {
    await this.open();
    await this.chooseManageAction(view, 'Edit');
    const dialog = this.editDialog;
    await expect(this.ruleFieldButton(dialog)).toHaveAccessibleName(`${view.rule.field} Filter field`);
    await expect(this.ruleOperatorButton(dialog)).toHaveAccessibleName(
      `${view.rule.operator} Filter operator`,
    );
    await expect(dialog.getByRole('textbox', { name: 'Enter value' })).toHaveValue(view.rule.value);
    await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue(view.name);
    await expect(dialog.getByRole('button', { name: 'View icon' })).toHaveText(view.icon.emoji);
    await expect(dialog.getByRole('radio', { name: view.share, exact: true })).toBeChecked();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  }

  /** Change every part of the view `current` (its rule, name, icon and sharing) to `updated`. */
  async editView(current: SavedViewData, updated: SavedViewData): Promise<void> {
    await this.open();
    await this.chooseManageAction(current, 'Edit');
    await this.fillDialog(this.editDialog, updated);
    const saved = waitForApiResponse(this.page, 'PUT', new RegExp(`^${ENDPOINTS.customViews}/[^/]+$`));
    await this.editDialog.getByRole('button', { name: 'Save view' }).click();
    expect((await saved).ok(), 'the server should save the changes').toBe(true);
    await expect(this.editDialog).toBeHidden();
  }

  /** Delete the view from its Manage menu. The app deletes it at once and says so in a toast. */
  async deleteView(view: SavedViewData): Promise<void> {
    await this.open();
    const deleted = waitForApiResponse(this.page, 'DELETE', new RegExp(`^${ENDPOINTS.customViews}/[^/]+$`));
    await this.chooseManageAction(view, 'Delete');
    expect((await deleted).ok(), 'the server should delete the view').toBe(true);
    await expect(this.page.getByRole('alert').filter({ hasText: 'View deleted' })).toBeVisible();
  }

  private async chooseManageAction(view: SavedViewData, action: 'Edit' | 'Delete'): Promise<void> {
    await collapseSetupGuide(this.page);
    await this.page.getByRole('button', { name: `Manage ${view.name}`, exact: true }).click();
    await this.page
      .getByRole('menu', { name: `Manage ${view.name}` })
      .getByRole('menuitem', { name: action })
      .click();
    if (action === 'Edit') await expect(this.editDialog).toBeVisible();
  }

  /** Fill the dialog's first rule, name, icon and sharing. The rule must already be there. */
  private async fillDialog(dialog: Locator, view: SavedViewData): Promise<void> {
    // The field picker's button has no size; its visible box is the wrapper around it.
    await this.ruleFieldButton(dialog).locator('..').click();
    await this.page
      .getByRole('listbox', { name: /Filter field/ })
      .getByRole('option', { name: view.rule.field, exact: true })
      .click();
    await expect(this.ruleFieldButton(dialog)).toHaveAccessibleName(`${view.rule.field} Filter field`);

    await this.ruleOperatorButton(dialog).click();
    await this.page
      .getByRole('listbox', { name: 'Filter operator' })
      .getByRole('option', { name: view.rule.operator, exact: true })
      .click();
    await dialog.getByRole('textbox', { name: 'Enter value' }).fill(view.rule.value);

    await dialog.getByRole('textbox', { name: 'Name' }).fill(view.name);

    await dialog.getByRole('button', { name: 'View icon' }).click();
    await this.page.getByRole('searchbox', { name: 'Search emoji' }).fill(view.icon.search);
    await this.page
      .getByRole('listbox', { name: /Emoji grid/ })
      .getByRole('option', { name: view.icon.emoji, exact: true })
      .click();
    await expect(dialog.getByRole('button', { name: 'View icon' })).toHaveText(view.icon.emoji);

    // The real radio input sits under the app's styled circle, so click the option's label.
    await dialog
      .getByRole('radiogroup', { name: 'Who can see this view' })
      .getByText(view.share, { exact: true })
      .click();
    await expect(dialog.getByRole('radio', { name: view.share, exact: true })).toBeChecked();
  }

  private ruleFieldButton(dialog: Locator): Locator {
    return dialog.getByRole('button', { name: /Filter field$/ }).first();
  }

  private ruleOperatorButton(dialog: Locator): Locator {
    return dialog.getByRole('button', { name: /Filter operator$/ }).first();
  }
}
