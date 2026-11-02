import { expect, type Locator, type Page } from '@playwright/test';
import { waitForApiResponse } from '../../utils/network';
import { ENDPOINTS } from '../../api/ResourceApi';
import type { WidgetData } from '../../utils/testData';

/** <Area> → Widgets: the widgets list and the create dialog. */
export class WidgetsPage {
  readonly table: Locator;
  readonly addButton: Locator;
  private readonly dialog: Locator;

  constructor(private readonly page: Page) {
    this.table = page.getByRole('table');
    this.addButton = page.getByRole('button', { name: 'Add widget' });
    this.dialog = page.getByRole('dialog', { name: 'New widget' });
  }

  /** Go from the dashboard to the widgets list through the menu, as a user would. */
  async openFromDashboard(): Promise<void> {
    await this.page.goto('/dashboard');
    await this.page.getByRole('link', { name: 'Widgets', exact: true }).click();
    await expect(this.table).toBeVisible();
  }

  /** The list row of the widget named `name`. */
  rowFor(name: string): Locator {
    return this.table.getByRole('row').filter({ hasText: name });
  }

  /** Fill in and save the create dialog; returns the new widget's id from the server's answer. */
  async createRecord(widget: WidgetData): Promise<string> {
    await this.addButton.click();
    await this.dialog.getByRole('textbox', { name: 'Name' }).fill(widget.name);
    const created = waitForApiResponse(this.page, 'POST', ENDPOINTS.widgets);
    await this.dialog.getByRole('button', { name: 'Create' }).click();
    const response = await created;
    expect(response.status(), 'the server should create the widget').toBe(201);
    await expect(this.dialog).toBeHidden();
    return (await response.json()).data.id;
  }
}
