import { expect, type Locator, type Page } from '@playwright/test';
import { SettingsTablePage } from './SettingsTablePage';
import { TAG_COLORS, type TagData } from '../../utils/testData';

/** Settings → Inbox → Tags: labels for organizing contacts and conversations. */
export class TagsPage extends SettingsTablePage<TagData> {
  constructor(page: Page) {
    super(page, {
      path: '/settings/tags',
      menu: ['Contacts', 'Tags'],
      addButtonName: 'New tag',
      createDialog: { name: 'Create Tag', submitButton: 'Create' },
      editDialog: { name: 'Edit Tag', submitButton: 'Update' },
      rowActionsButtonName: 'Tag actions',
      deleteDialogName: 'Delete tag',
      apiPath: '/v1/tags',
    });
  }

  rowKey(tag: TagData): string {
    return tag.name;
  }

  protected async fillDialog(dialog: Locator, tag: TagData): Promise<void> {
    await dialog.getByRole('textbox', { name: 'Name' }).fill(tag.name);
    await dialog.getByRole('button', { name: tag.colorName, exact: true }).click();
  }

  protected async expectDialogValues(dialog: Locator, tag: TagData): Promise<void> {
    await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue(tag.name);
    await expect(this.hexInput(dialog)).toHaveValue(TAG_COLORS[tag.colorName]);
  }

  /** The hex code of the chosen colour, e.g. "#a855f7". */
  private hexInput(dialog: Locator): Locator {
    // The hex field has no label in the app, so it is found by position: the 2nd textbox, after Name.
    return dialog.getByRole('textbox').nth(1);
  }
}
