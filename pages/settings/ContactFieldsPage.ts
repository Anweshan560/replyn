import { expect, type Locator, type Page } from '@playwright/test';
import { SettingsNavigation } from './SettingsNavigation';
import { ENDPOINTS } from '../../api/ResourceApi';
import { waitForApiResponse } from '../../utils/network';
import { collapseSetupGuide } from '../setupGuide';
import type { ContactFieldData } from '../../utils/testData';

/**
 * Settings → Workspace → Contact Fields: the built-in fields, then the workspace's own.
 * Archiving hides a field; "Show archived fields" lists archived ones to restore or delete for good.
 */
export class ContactFieldsPage {
  readonly navigation: SettingsNavigation;
  readonly newFieldButton: Locator;
  readonly createDialog: Locator;
  readonly editDialog: Locator;
  readonly showArchivedCheckbox: Locator;
  readonly archivedFields: Locator;

  constructor(private readonly page: Page) {
    this.navigation = new SettingsNavigation(page);
    this.newFieldButton = page.getByRole('button', { name: 'New Field', exact: true });
    this.createDialog = page.getByRole('dialog', { name: 'New contact field' });
    this.editDialog = page.getByRole('dialog', { name: 'Edit field' });
    this.showArchivedCheckbox = page.getByRole('checkbox', { name: /^Show archived fields/ });
    this.archivedFields = page.getByRole('region', { name: 'Archived fields' });
  }

  async openFromDashboard(): Promise<void> {
    await this.navigation.openFromDashboard('Contacts', 'Contact Fields');
    await expect(this.page).toHaveURL('/settings/contact-fields');
  }

  /** Open the page directly and wait until the active fields have loaded. */
  async open(): Promise<void> {
    const loaded = waitForApiResponse(this.page, 'GET', ENDPOINTS.contactFields);
    await this.page.goto('/settings/contact-fields');
    expect((await loaded).ok(), 'the fields should load').toBe(true);
  }

  /** The active field's Edit button: there is one only while the field is listed. */
  editButton(field: ContactFieldData): Locator {
    return this.page.getByRole('button', { name: `Edit ${field.name}`, exact: true });
  }

  /** The line under the name, e.g. "Text · qa_insurance_123456". */
  summary(field: ContactFieldData): Locator {
    return this.page.getByRole('main').getByText(`${field.type} · ${field.key}`, { exact: true });
  }

  /** An archived field's entry in the "Archived fields" list. */
  archivedEntry(field: ContactFieldData): Locator {
    // The innermost box holding both the name and a Restore button is this field's entry.
    return this.archivedFields
      .locator('div')
      .filter({ has: this.page.getByText(field.name, { exact: true }) })
      .filter({ has: this.page.getByRole('button', { name: 'Restore' }) })
      .last();
  }

  /** Open the New contact field dialog. */
  async openCreateDialog(): Promise<void> {
    await this.newFieldButton.click();
    await expect(this.createDialog).toBeVisible();
  }

  /**
   * Create a field through the dialog, starting from this page.
   * @returns the new field's id, taken from the server's answer.
   */
  async createField(field: ContactFieldData): Promise<string> {
    await this.openCreateDialog();
    await this.createDialog.getByRole('textbox', { name: 'Name' }).fill(field.name);
    await this.createDialog.getByRole('textbox', { name: 'Storage key' }).fill(field.key);
    await this.chooseType(field.type);
    await this.fillEditableFields(this.createDialog, field);
    const created = waitForApiResponse(this.page, 'POST', ENDPOINTS.contactFields);
    await this.createDialog.getByRole('button', { name: 'Add field' }).click();
    const response = await created;
    expect(response.status(), 'the server should create the field').toBe(201);
    await expect(this.createDialog).toBeHidden();
    return (await response.json()).data.id;
  }

  /** Reload, open the field's edit dialog and check it shows exactly `field`. */
  async expectSavedValues(field: ContactFieldData): Promise<void> {
    await this.openEditDialog(field);
    const dialog = this.editDialog;
    await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue(field.name);
    // The key and type can't change once the field exists, so they are shown but locked.
    await expect(dialog.getByRole('textbox', { name: 'Storage key' })).toHaveValue(field.key);
    await expect(dialog.getByRole('textbox', { name: 'Storage key' })).toBeDisabled();
    await expect(this.typeButton(dialog)).toHaveText(field.type);
    await expect(this.typeButton(dialog)).toBeDisabled();
    if (field.type === 'Choice') {
      await expect(dialog.getByRole('textbox', { name: 'Options' })).toHaveValue(field.options.join('\n'));
    }
    await expect(dialog.getByRole('textbox', { name: 'Placeholder' })).toHaveValue(field.placeholder);
    await expect(this.showOnContactsCheckbox(dialog)).toBeChecked({ checked: field.showOnContacts });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  }

  /** Change the field `current` to `updated` (name, options, placeholder, visibility) and save. */
  async editField(current: ContactFieldData, updated: ContactFieldData): Promise<void> {
    await this.openEditDialog(current);
    await this.editDialog.getByRole('textbox', { name: 'Name' }).fill(updated.name);
    await this.fillEditableFields(this.editDialog, updated);
    const saved = waitForApiResponse(this.page, 'PATCH', this.fieldApiPath());
    await this.editDialog.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await saved).ok(), 'the server should save the changes').toBe(true);
    await expect(this.editDialog).toBeHidden();
  }

  /** Archive the field, confirming the dialog that names it. */
  async archiveField(field: ContactFieldData): Promise<void> {
    await this.open();
    await collapseSetupGuide(this.page);
    await this.page.getByRole('button', { name: `Archive ${field.name}`, exact: true }).click();
    const dialog = this.page.getByRole('dialog', { name: `Archive ${field.name}?` });
    await expect(dialog).toBeVisible();
    const archived = waitForApiResponse(this.page, 'DELETE', this.fieldApiPath());
    await dialog.getByRole('button', { name: /^Archive/ }).click();
    expect((await archived).ok(), 'the server should archive the field').toBe(true);
    await expect(dialog).toBeHidden();
  }

  /** Tick "Show archived fields" and wait for the archived list. */
  async showArchived(): Promise<void> {
    // The real checkbox sits under the app's styled box, so click its label as a user does.
    await this.page.getByText(/^Show archived fields/).click();
    await expect(this.showArchivedCheckbox).toBeChecked();
    await expect(this.archivedFields).toBeVisible();
  }

  /** Restore an archived field from the archived list (shown with showArchived()). */
  async restoreField(field: ContactFieldData): Promise<void> {
    const restored = waitForApiResponse(this.page, 'POST', this.fieldApiPath('/restore'));
    await collapseSetupGuide(this.page);
    await this.archivedEntry(field).getByRole('button', { name: 'Restore' }).click();
    expect((await restored).ok(), 'the server should restore the field').toBe(true);
  }

  /** Delete an archived field for good, confirming the warning (shown with showArchived()). */
  async deletePermanently(field: ContactFieldData): Promise<void> {
    await collapseSetupGuide(this.page);
    await this.page.getByRole('button', { name: `Delete ${field.name} permanently` }).click();
    const dialog = this.page.getByRole('dialog', { name: `Delete ${field.name} permanently?` });
    await expect(dialog).toContainText('This cannot be undone');
    const deleted = waitForApiResponse(this.page, 'DELETE', this.fieldApiPath('/permanent'));
    await dialog.getByRole('button', { name: 'Delete permanently' }).click();
    expect((await deleted).ok(), 'the server should delete the field').toBe(true);
    await expect(dialog).toBeHidden();
  }

  /** The message under a dialog field, e.g. "Give the field a name". */
  fieldError(dialog: Locator, message: string): Locator {
    return dialog.getByText(message, { exact: true });
  }

  typeButton(dialog: Locator): Locator {
    return dialog.getByRole('button', { name: / Type$/ });
  }

  private showOnContactsCheckbox(dialog: Locator): Locator {
    return dialog.getByRole('checkbox', { name: 'Show this field on contacts' });
  }

  private async chooseType(type: ContactFieldData['type']): Promise<void> {
    await this.typeButton(this.createDialog).click();
    await this.page
      .getByRole('listbox', { name: 'Type' })
      .getByRole('option', { name: type, exact: true })
      .click();
    await expect(this.typeButton(this.createDialog)).toHaveText(type);
  }

  /** The fields that can still change after the field exists. */
  private async fillEditableFields(dialog: Locator, field: ContactFieldData): Promise<void> {
    if (field.type === 'Choice') {
      await dialog.getByRole('textbox', { name: 'Options' }).fill(field.options.join('\n'));
    }
    await dialog.getByRole('textbox', { name: 'Placeholder' }).fill(field.placeholder);
    const checkbox = this.showOnContactsCheckbox(dialog);
    if ((await checkbox.isChecked()) !== field.showOnContacts) {
      // The real checkbox sits under the app's styled box, so click its label as a user does.
      await dialog.getByText('Show this field on contacts', { exact: true }).click();
    }
    await expect(checkbox).toBeChecked({ checked: field.showOnContacts });
  }

  private async openEditDialog(field: ContactFieldData): Promise<void> {
    await this.open();
    await collapseSetupGuide(this.page);
    await this.editButton(field).click();
    await expect(this.editDialog).toBeVisible();
  }

  /** Matches the API path of one field, e.g. "/v1/contact-fields/<id>", plus `suffix`. */
  private fieldApiPath(suffix = ''): RegExp {
    return new RegExp(`^${ENDPOINTS.contactFields}/[^/]+${suffix}$`);
  }
}
