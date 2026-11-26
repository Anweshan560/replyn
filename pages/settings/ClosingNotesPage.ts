import { expect, type Locator, type Page } from '@playwright/test';
import { SettingsTablePage } from './SettingsTablePage';
import type { ClosingNoteData } from '../../utils/testData';

/** Settings → Inbox → Closing Notes: reasons agents pick when they close a conversation. */
export class ClosingNotesPage extends SettingsTablePage<ClosingNoteData> {
  constructor(page: Page) {
    super(page, {
      path: '/settings/closing-notes',
      menu: ['Inbox', 'Closing Notes'],
      addButtonName: 'New closing note',
      createDialog: { name: 'Create Closing Note', submitButton: 'Create' },
      editDialog: { name: 'Edit Closing Note', submitButton: 'Update' },
      rowActionsButtonName: 'Closing note actions',
      deleteDialogName: 'Delete closing note',
      apiPath: '/v1/closing-notes',
    });
  }

  rowKey(note: ClosingNoteData): string {
    return note.category;
  }

  protected async fillDialog(dialog: Locator, note: ClosingNoteData): Promise<void> {
    await dialog.getByRole('textbox', { name: 'Category' }).fill(note.category);
    await dialog.getByRole('textbox', { name: 'Description (optional)' }).fill(note.summary);
  }

  protected async expectDialogValues(dialog: Locator, note: ClosingNoteData): Promise<void> {
    await expect(dialog.getByRole('textbox', { name: 'Category' })).toHaveValue(note.category);
    await expect(dialog.getByRole('textbox', { name: 'Description (optional)' })).toHaveValue(note.summary);
  }
}
