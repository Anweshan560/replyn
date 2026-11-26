import { expect, type Locator, type Page } from '@playwright/test';
import { ClinicListPage, type ClinicSection } from './ClinicListPage';
import { waitForApiResponse } from '../../utils/network';
import type { ClinicRecordData } from '../../utils/testData';

/** A Clinic section whose records open in a full-page form, e.g. "/doctors/new". */
export type ClinicFormSection = ClinicSection & {
  /** Submit button on the empty form. */
  createButtonName: string;
};

/**
 * Doctors and Treatments: both add and edit records on a full page with the same core fields
 * (name, website, EMR ID, description). Subclasses add their own fields by overriding the two
 * `Extra` hooks.
 */
export abstract class ClinicFormPage<TData extends ClinicRecordData> extends ClinicListPage {
  readonly nameInput: Locator;
  readonly websiteInput: Locator;
  readonly emrIdInput: Locator;
  readonly descriptionEditor: Locator;
  readonly createButton: Locator;
  readonly saveChangesButton: Locator;
  /** Shown when the form is submitted with an empty name. */
  readonly nameRequiredError: Locator;
  /** Shown when the server fails to save the form. */
  readonly saveFailedError: Locator;

  constructor(page: Page, section: ClinicFormSection) {
    super(page, section);
    this.nameInput = page.getByRole('textbox', { name: 'Name', exact: true });
    this.websiteInput = page.getByRole('textbox', { name: 'Page on your website' });
    this.emrIdInput = page.getByRole('textbox', { name: 'ID in the EMR' });
    // CSS on purpose: the rich-text editor is a plain <div contenteditable> with no role,
    // label or placeholder attribute, so no getBy* locator can reach it. The form has only one.
    this.descriptionEditor = page.locator('.ProseMirror[contenteditable="true"]');
    this.createButton = page.getByRole('button', { name: section.createButtonName, exact: true });
    this.saveChangesButton = page.getByRole('button', { name: 'Save changes' });
    this.nameRequiredError = page.getByText('Name is required');
    // The app uses a curly apostrophe ("Couldn’t"), so match either kind.
    this.saveFailedError = page.getByText(/Couldn.t save/);
  }

  /** Press the add button on the list page and wait for the empty form. */
  async openNewForm(): Promise<void> {
    await this.addButton.click();
    await expect(this.page).toHaveURL(`${this.section.listPath}/new`);
  }

  /** Fill every field of the form with `data`. */
  async fillForm(data: TData): Promise<void> {
    await this.nameInput.fill(data.name);
    await this.websiteInput.fill(data.website);
    await this.emrIdInput.fill(data.emrId);
    await this.descriptionEditor.fill(data.description);
    await this.fillExtraFields(data);
  }

  /** Press the create button on the "new" form. */
  async submitNewForm(): Promise<void> {
    // The app's floating setup-guide button covers the form's footer buttons, so a mouse
    // click is blocked. Pressing Enter on the button triggers it without moving the mouse.
    await this.createButton.press('Enter');
  }

  /**
   * Create a record through the form, starting from the list page.
   * @returns the new record's id, read from the URL of the page the app opens after saving.
   */
  async createRecord(data: TData): Promise<string> {
    await this.openNewForm();
    await this.fillForm(data);
    await this.submitNewForm();
    // Waiting for the record's own page also guarantees the save has finished.
    await expect(this.page).toHaveURL(new RegExp(`${this.section.listPath}/(?!new$)[^/]+$`));
    return new URL(this.page.url()).pathname.split('/').pop()!;
  }

  /** Reload the record's page and check every field shows exactly `data`. */
  async expectSavedValues(data: TData): Promise<void> {
    // Reloading proves the values came from the server, not from what is still in the form.
    // Wait for the record's own API response: the app can be slow to start after a reload.
    const recordLoaded = waitForApiResponse(this.page, 'GET', this.recordApiPath());
    await this.page.reload();
    expect((await recordLoaded).ok(), 'the record should load').toBe(true);
    await expect(this.nameInput).toHaveValue(data.name);
    await expect(this.websiteInput).toHaveValue(data.website);
    await expect(this.emrIdInput).toHaveValue(data.emrId);
    await expect(this.descriptionEditor).toHaveText(data.description);
    await this.expectExtraFields(data);
  }

  /** Open an existing record's page (its edit form) from the list. */
  async openRecord(name: string): Promise<void> {
    await this.chooseRowAction(name, 'Edit');
  }

  /** Replace every field of an existing record with `updated` and save. */
  async editRecord(currentName: string, updated: TData): Promise<void> {
    await this.chooseRowAction(currentName, 'Edit');
    await this.fillForm(updated);
    // "Save changes" is enabled only while there are unsaved edits.
    await expect(this.saveChangesButton).toBeEnabled();
    // The button turns disabled as soon as saving *starts*, so wait for the server's answer
    // instead; otherwise a reload straight after could cancel the save.
    const saved = waitForApiResponse(this.page, 'PATCH', this.recordApiPath());
    await this.saveChangesButton.press('Enter'); // Enter, not click: see submitNewForm()
    expect((await saved).ok(), 'the server should accept the changes').toBe(true);
    await expect(this.saveChangesButton).toBeDisabled();
  }

  /** Hook: fill fields that only this section's form has. */
  protected async fillExtraFields(_data: TData): Promise<void> {}

  /** Hook: check fields that only this section's form has. */
  protected async expectExtraFields(_data: TData): Promise<void> {}
}
