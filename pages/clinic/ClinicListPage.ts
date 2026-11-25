import { expect, type Locator, type Page } from '@playwright/test';
import { waitForApiResponse } from '../../utils/network';
import { openFromSidebarGroup } from '../Sidebar';

/** What identifies one section of Clinic (Doctors, Treatments, Departments). */
export type ClinicSection = {
  /** Path of the list page, e.g. "/doctors". */
  listPath: string;
  /** Link in the Clinic side menu, e.g. "Doctors". */
  menuLinkName: string;
  /** Button on the list page that starts adding a record. */
  addButtonName: string;
  /** Button that opens a row's Edit/Delete menu, e.g. "Doctor actions". */
  rowActionsButtonName: string;
  /** API path the section saves to, e.g. "/v1/clinics/doctors". */
  apiPath: string;
};

/**
 * What every Clinic section has in common: a link in the Clinic menu, a list of records,
 * and an Edit/Delete menu on every row. Subclasses add the section's form.
 */
export abstract class ClinicListPage {
  readonly table: Locator;
  readonly addButton: Locator;
  /** The "Are you sure?" dialog. Matched by its text: in some sections it has no title. */
  readonly deleteDialog: Locator;

  constructor(
    protected readonly page: Page,
    protected readonly section: ClinicSection,
  ) {
    this.table = page.getByRole('grid');
    this.addButton = page.getByRole('button', { name: section.addButtonName, exact: true });
    this.deleteDialog = page.getByRole('dialog').filter({ hasText: 'will be deleted' });
  }

  /** Go from the dashboard to this section through the Clinic menu, as a user would. */
  async openFromDashboard(): Promise<void> {
    await this.page.goto('/dashboard');
    await openFromSidebarGroup(this.page, 'Clinic', this.section.menuLinkName);
    await expect(this.page).toHaveURL(this.section.listPath);
  }

  /** Open the list page directly and wait until its records have arrived from the server. */
  async openList(): Promise<void> {
    // The app can take several seconds to start up before it even asks for the list, so wait
    // for the list's own API response rather than for a row to appear within a fixed timeout.
    const listLoaded = waitForApiResponse(this.page, 'GET', this.section.apiPath);
    await this.page.goto(this.section.listPath);
    expect((await listLoaded).ok(), 'the list should load').toBe(true);
  }

  /** The list row whose name is exactly `name` (so "Dr. A" never matches "Dr. A B"). */
  rowFor(name: string): Locator {
    return this.page.getByRole('row').filter({ has: this.page.getByText(name, { exact: true }) });
  }

  /** Open the list, then choose Edit or Delete from the row's menu. */
  protected async chooseRowAction(name: string, action: 'Edit' | 'Delete'): Promise<void> {
    await this.openList();
    await this.rowFor(name).getByRole('button', { name: this.section.rowActionsButtonName }).first().click();
    await this.page.getByRole('menuitem', { name: action }).click();
  }

  /** Choose Delete on a record and wait for the confirmation, which must name that record. */
  async openDeleteDialog(name: string): Promise<void> {
    await this.chooseRowAction(name, 'Delete');
    await expect(this.deleteDialog).toContainText(`${name} will be deleted`);
  }

  /** Delete a record from the list, after checking the confirmation names the right record. */
  async deleteRecord(name: string): Promise<void> {
    await this.openDeleteDialog(name);
    // Wait for the server, not just the dialog, so later checks see the record already gone.
    const deleted = waitForApiResponse(this.page, 'DELETE', this.recordApiPath());
    await this.deleteDialog.getByRole('button', { name: 'Delete' }).click();
    expect((await deleted).ok(), 'the server should delete the record').toBe(true);
    await expect(this.deleteDialog).toBeHidden();
  }

  /** Matches the API path of a single record, e.g. "/v1/clinics/doctors/<id>". */
  protected recordApiPath(): RegExp {
    return new RegExp(`^${this.section.apiPath}/[^/]+$`);
  }
}
