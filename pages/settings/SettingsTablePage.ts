import { expect, type Locator, type Page } from '@playwright/test';
import { SettingsNavigation } from './SettingsNavigation';
import { waitForApiResponse } from '../../utils/network';
import { collapseSetupGuide } from '../setupGuide';

/** The labels and paths that differ between the Settings pages built on SettingsTablePage. */
export type SettingsTableSection = {
  /** Page URL, e.g. "/settings/websites". */
  path: string;
  /** Where the page is in the Settings menu, e.g. ["Workspace", "Websites"]. */
  menu: [group: string, link: string];
  /** Button above the table that opens the create dialog, e.g. "New website". */
  addButtonName: string;
  /** Title of the create dialog and its submit button, e.g. "Add Website" / "Add". */
  createDialog: { name: string; submitButton: string };
  /** Title of the edit dialog and its submit button, e.g. "Edit Website" / "Update". */
  editDialog: { name: string; submitButton: string };
  /** The row's menu button, e.g. "Website actions". */
  rowActionsButtonName: string;
  /** Title of the delete confirmation, e.g. "Delete website". */
  deleteDialogName: string;
  /** API path of the list, e.g. "/v1/websites". Single records live at "<apiPath>/<id>". */
  apiPath: string;
};

/**
 * Settings pages that list records in a table and add/edit them in dialogs:
 * Websites, Teams, Tags, Closing Notes, Snippets, Files and API Keys.
 * Subclasses say how to fill and check their dialog's fields; everything else is shared.
 */
export abstract class SettingsTablePage<TData> {
  readonly navigation: SettingsNavigation;
  readonly table: Locator;
  readonly addButton: Locator;
  readonly createDialog: Locator;
  readonly editDialog: Locator;
  readonly deleteDialog: Locator;

  constructor(
    protected readonly page: Page,
    protected readonly section: SettingsTableSection,
  ) {
    this.navigation = new SettingsNavigation(page);
    this.table = page.getByRole('grid');
    this.addButton = page.getByRole('button', { name: section.addButtonName, exact: true });
    this.createDialog = page.getByRole('dialog', { name: section.createDialog.name, exact: true });
    this.editDialog = page.getByRole('dialog', { name: section.editDialog.name, exact: true });
    this.deleteDialog = page.getByRole('dialog', { name: section.deleteDialogName, exact: true });
  }

  /** Fill every field of the create or edit dialog with `data`. */
  protected abstract fillDialog(dialog: Locator, data: TData): Promise<void>;

  /** Check every field of the edit dialog shows exactly `data`. */
  protected abstract expectDialogValues(dialog: Locator, data: TData): Promise<void>;

  /** The text that identifies a record's row, e.g. a website's domain. */
  abstract rowKey(data: TData): string;

  /** Go to this page through the sidebar and the Settings menu. */
  async openFromDashboard(): Promise<void> {
    await this.navigation.openFromDashboard(...this.section.menu);
    await expect(this.page).toHaveURL(this.section.path);
  }

  /** Open this page directly and wait until the list has loaded from the server. */
  async open(): Promise<void> {
    const listLoaded = waitForApiResponse(this.page, 'GET', this.section.apiPath);
    await this.page.goto(this.section.path);
    expect((await listLoaded).ok(), 'the list should load').toBe(true);
  }

  /** The table row of the record `data`. */
  rowFor(data: TData): Locator {
    return this.table.getByRole('row').filter({ hasText: this.rowKey(data) });
  }

  /** Press the add button and wait for the empty create dialog. */
  async openCreateDialog(): Promise<void> {
    // .first(): empty tables show a second, identical button in the "No … yet" message.
    await this.addButton.first().click();
    await expect(this.createDialog).toBeVisible();
  }

  /**
   * Create a record through the create dialog, starting from this page.
   * @returns the new record's id, taken from the server's answer.
   */
  async createRecord(data: TData): Promise<string> {
    await this.openCreateDialog();
    await this.fillDialog(this.createDialog, data);
    const created = waitForApiResponse(this.page, 'POST', this.section.apiPath);
    await this.createDialog
      .getByRole('button', { name: this.section.createDialog.submitButton, exact: true })
      .click();
    const response = await created;
    expect(response.status(), 'the server should create the record').toBe(201);
    await expect(this.createDialog).toBeHidden();
    return (await response.json()).data.id;
  }

  /** Reload the page, open the record's edit dialog, and check every field shows exactly `data`. */
  async expectSavedValues(data: TData): Promise<void> {
    await this.openEditDialog(data);
    await this.expectDialogValues(this.editDialog, data);
    await this.editDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(this.editDialog).toBeHidden();
  }

  /** Replace every field of the record `current` with `updated` and save. */
  async editRecord(current: TData, updated: TData): Promise<void> {
    await this.openEditDialog(current);
    await this.fillDialog(this.editDialog, updated);
    // Wait for the server, not just the dialog, so later checks see the saved values.
    const saved = this.page.waitForResponse(
      (response) =>
        ['PATCH', 'PUT'].includes(response.request().method()) && this.isRecordUrl(response.url()),
    );
    await this.editDialog
      .getByRole('button', { name: this.section.editDialog.submitButton, exact: true })
      .click();
    expect((await saved).ok(), 'the server should accept the changes').toBe(true);
    await expect(this.editDialog).toBeHidden();
  }

  /** Delete the record `data`, after checking the confirmation names it. */
  async deleteRecord(data: TData, confirmationNames: string | RegExp): Promise<void> {
    await this.chooseRowAction(data, 'Delete');
    await expect(this.deleteDialog).toBeVisible();
    await expect(this.deleteDialog).toContainText(confirmationNames);
    const deleted = waitForApiResponse(this.page, 'DELETE', this.recordApiPath());
    await this.deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click();
    expect((await deleted).ok(), 'the server should delete the record').toBe(true);
    await expect(this.deleteDialog).toBeHidden();
  }

  /** Reload the list, then open the record's edit dialog from its row menu. */
  private async openEditDialog(data: TData): Promise<void> {
    await this.chooseRowAction(data, 'Edit');
    await expect(this.editDialog).toBeVisible();
  }

  /** Reload the list, then choose an item from the record's row menu. */
  protected async chooseRowAction(data: TData, action: 'Edit' | 'Delete'): Promise<void> {
    await this.open();
    const menuButton = this.rowFor(data)
      .getByRole('button', { name: this.section.rowActionsButtonName })
      .first();
    const menuItem = this.page.getByRole('menuitem', { name: action, exact: true });
    await collapseSetupGuide(this.page);
    // Click, never a key press: parallel tests add and remove records, so the table re-renders
    // while this runs, and a key press can land on whatever has focus by then (Enter on a row
    // opens that row's edit dialog). A click hits this button or waits, e.g. while a toast covers
    // it. The menu can still miss a click during a re-render, so click again until this row's
    // button reports its menu open (checked first, as a second click would close it).
    await expect(
      async () => {
        if ((await menuButton.getAttribute('aria-expanded')) !== 'true') {
          await menuButton.click({ timeout: 5_000 });
        }
        await expect(menuButton).toHaveAttribute('aria-expanded', 'true', { timeout: 3_000 });
      },
      `the row menu of ${this.rowKey(data)} should open`,
    ).toPass({ timeout: 30_000 });
    await menuItem.click();
  }

  /** Matches the API path of a single record, e.g. "/v1/websites/<id>". */
  protected recordApiPath(): RegExp {
    return new RegExp(`^${this.section.apiPath}/[^/]+$`);
  }

  private isRecordUrl(url: string): boolean {
    return this.recordApiPath().test(new URL(url).pathname);
  }
}
