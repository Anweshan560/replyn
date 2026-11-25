import { expect, type Locator, type Page } from '@playwright/test';
import { SettingsTablePage } from './SettingsTablePage';
import { waitForApiResponse } from '../../utils/network';
import type { ApiKeyData } from '../../utils/testData';

/**
 * Settings → Workspace → API Keys, the "API keys" tab: keys for calling the API from other systems.
 * A new key is shown once, in an "API key created" dialog; deleting one asks to type its name.
 */
export class ApiKeysPage extends SettingsTablePage<ApiKeyData> {
  /** Shown right after a key is created, with the key itself. */
  readonly createdDialog: Locator;

  constructor(page: Page) {
    super(page, {
      path: '/settings/developer',
      menu: ['Connections', 'API Keys'],
      addButtonName: 'Add API key',
      createDialog: { name: 'Add API Key', submitButton: 'Create' },
      editDialog: { name: 'Edit API Key', submitButton: 'Update' },
      rowActionsButtonName: 'API key actions',
      deleteDialogName: 'Delete API key?',
      apiPath: '/v1/api-keys',
    });
    this.createdDialog = page.getByRole('dialog', { name: 'API key created' });
  }

  rowKey(apiKey: ApiKeyData): string {
    return apiKey.name;
  }

  /** Create the key, then close the "API key created" dialog that shows it. */
  override async createRecord(apiKey: ApiKeyData): Promise<string> {
    const id = await this.createKeepingKeyShown(apiKey);
    await this.closeCreatedDialog();
    return id;
  }

  /**
   * Create the key and leave the "API key created" dialog open, to read the key.
   * @returns the new key's id.
   */
  async createKeepingKeyShown(apiKey: ApiKeyData): Promise<string> {
    const id = await super.createRecord(apiKey);
    await expect(this.createdDialog).toBeVisible();
    await expect(this.createdDialog).toContainText(apiKey.name);
    return id;
  }

  /** The key in the "API key created" dialog. Never log it: it is a real credential. */
  shownKey(): Promise<string> {
    return this.createdDialog.getByRole('textbox', { name: 'API Key' }).inputValue();
  }

  async closeCreatedDialog(): Promise<void> {
    await this.createdDialog.getByRole('button', { name: 'Done' }).click();
    await expect(this.createdDialog).toBeHidden();
  }

  /** Delete the key: the dialog must name it, and only deletes once the name is typed. */
  override async deleteRecord(apiKey: ApiKeyData, confirmationNames: string | RegExp): Promise<void> {
    await this.chooseRowAction(apiKey, 'Delete');
    await expect(this.deleteDialog).toBeVisible();
    await expect(this.deleteDialog).toContainText(confirmationNames);
    const deleteButton = this.deleteDialog.getByRole('button', { name: 'Delete API Key' });
    await expect(deleteButton).toBeDisabled();
    await this.deleteDialog.getByRole('textbox', { name: 'Confirm API key name' }).fill(apiKey.name);
    const deleted = waitForApiResponse(this.page, 'DELETE', this.recordApiPath());
    await deleteButton.click();
    expect((await deleted).ok(), 'the server should delete the key').toBe(true);
    await expect(this.deleteDialog).toBeHidden();
  }

  protected async fillDialog(dialog: Locator, apiKey: ApiKeyData): Promise<void> {
    await dialog.getByRole('textbox', { name: 'Name' }).fill(apiKey.name);
  }

  protected async expectDialogValues(dialog: Locator, apiKey: ApiKeyData): Promise<void> {
    await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue(apiKey.name);
  }
}
