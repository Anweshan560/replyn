import { expect, type Locator, type Page } from '@playwright/test';
import { waitForListResponse } from '../../utils/network';
import { ENDPOINTS } from '../../api/ResourceApi';

export const BROADCAST_COLUMNS = [
  'Name',
  'Channel',
  'Segment',
  'Status',
  'Schedule',
  'Progress',
  'Created',
] as const;

/** The status names in Filters → Status, in the order the page lists them. */
export const BROADCAST_STATUS_LABELS = [
  'Pending',
  'Scheduled',
  'Processing',
  'Sending',
  'Paused',
  'Completed',
  'Cancelled',
  'Failed',
] as const;

/**
 * Broadcasts: the list with its search and status filter, and the New broadcast form. Tests never
 * create a broadcast: the test workspace has no WhatsApp channel, and a broadcast sends real
 * messages.
 */
export class BroadcastsPage {
  readonly heading: Locator;
  readonly searchBox: Locator;
  readonly filtersButton: Locator;
  readonly newButton: Locator;
  /** "0 broadcasts" under the list. */
  readonly total: Locator;
  readonly filtersDialog: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Broadcasts', exact: true });
    this.searchBox = page.getByPlaceholder('Search broadcasts');
    this.filtersButton = page.getByRole('button', { name: 'Filters' }).first();
    this.newButton = page.getByRole('button', { name: 'New broadcast' });
    this.total = page.getByText(/^\d+ broadcasts?$/);
    this.filtersDialog = page.getByRole('dialog', { name: 'Filters' });
  }

  /** Go from the dashboard to Broadcasts through the menu, as a user would. */
  async openFromDashboard(): Promise<void> {
    await this.page.goto('/dashboard');
    await this.page.getByRole('link', { name: 'Broadcasts', exact: true }).click();
    await expect(this.page).toHaveURL('/broadcasts');
    await expect(this.heading).toBeVisible();
  }

  columnHeader(name: string): Locator {
    return this.page.getByRole('columnheader', { name, exact: true });
  }

  /** Type into the search box; waits for the list the page asks for with `?search=<text>`. */
  async search(text: string): Promise<void> {
    const listed = waitForListResponse(this.page, ENDPOINTS.broadcasts, { search: text });
    await this.searchBox.fill(text);
    await listed;
  }

  /** Open Filters → Status. */
  async openStatusFilter(): Promise<void> {
    await this.filtersButton.click();
    await expect(this.filtersDialog).toBeVisible();
    await this.filtersDialog.getByRole('button', { name: /Filter by status/ }).click();
  }

  /** Pick a status in the open status filter; waits for the list asked for with `?statuses=<status>`. */
  async pickStatus(label: (typeof BROADCAST_STATUS_LABELS)[number]): Promise<void> {
    const listed = waitForListResponse(this.page, ENDPOINTS.broadcasts, { statuses: label.toLowerCase() });
    await this.page.getByRole('option', { name: label, exact: true }).click();
    await listed;
  }
}

/** Broadcasts → New broadcast (/broadcasts/create). */
export class NewBroadcastForm {
  readonly heading: Locator;
  readonly nameBox: Locator;
  readonly segmentPicker: Locator;
  readonly channelPicker: Locator;
  readonly templatePicker: Locator;
  readonly createButton: Locator;
  readonly cancelButton: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'New broadcast' });
    this.nameBox = page.getByRole('textbox', { name: 'Name*' });
    this.segmentPicker = page.getByRole('button', { name: /Segment\*$/ });
    this.channelPicker = page.getByRole('button', { name: /Channel\*$/ });
    this.templatePicker = page.getByRole('button', { name: /Template\*$/ });
    this.createButton = page.getByRole('button', { name: 'Create Broadcast' });
    this.cancelButton = page.getByRole('button', { name: 'Cancel', exact: true });
  }

  /** The names in the Segment list. */
  async segmentOptions(): Promise<string[]> {
    await this.segmentPicker.click();
    const options = this.page.getByRole('option');
    await expect(options.first()).toBeVisible();
    const names = (await options.allInnerTexts()).map((name) => name.trim());
    await this.page.keyboard.press('Escape');
    return names;
  }
}
