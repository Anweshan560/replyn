import { expect, type Locator, type Page } from '@playwright/test';
import { SettingsTablePage } from './SettingsTablePage';
import type { WebsiteData } from '../../utils/testData';

/** Settings → Workspace → Websites: the domains tracked for contact referrals. */
export class WebsitesPage extends SettingsTablePage<WebsiteData> {
  constructor(page: Page) {
    super(page, {
      path: '/settings/websites',
      menu: ['Connections', 'Websites'],
      addButtonName: 'New website',
      createDialog: { name: 'Add Website', submitButton: 'Add' },
      editDialog: { name: 'Edit Website', submitButton: 'Update' },
      rowActionsButtonName: 'Website actions',
      deleteDialogName: 'Delete website',
      apiPath: '/v1/websites',
    });
  }

  /** Rows are identified by the domain. */
  rowKey(website: WebsiteData): string {
    return website.domain;
  }

  protected async fillDialog(dialog: Locator, website: WebsiteData): Promise<void> {
    await dialog.getByRole('textbox', { name: 'Domain' }).fill(website.domain);
    await dialog.getByRole('textbox', { name: 'Name' }).fill(website.name);
  }

  protected async expectDialogValues(dialog: Locator, website: WebsiteData): Promise<void> {
    await expect(dialog.getByRole('textbox', { name: 'Domain' })).toHaveValue(website.domain);
    await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue(website.name);
  }
}
