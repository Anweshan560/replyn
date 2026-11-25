import { expect, type Locator, type Page, type Request, type Response } from '@playwright/test';
import { ENDPOINTS } from '../../api/ResourceApi';
import type { ContactSearch } from '../../api/ContactsApi';
import { env } from '../../config/env';
import { waitForApiResponse } from '../../utils/network';
import { CreateContactDialog } from './CreateContactDialog';
import { ContactFiltersDialog } from './ContactFiltersDialog';
import { ContactPanel } from './ContactPanel';

/** The items of a contact row's "Contact actions" menu. */
export type ContactRowAction =
  | 'View details'
  | 'Message'
  | 'Edit'
  | 'Copy contact ID'
  | 'Opt out of broadcasts'
  | 'Opt back in to broadcasts'
  | 'Block'
  | 'Unblock';

const SEARCH_PATH = `${ENDPOINTS.contacts}/search`;

/**
 * The Contacts page: the contact list with its toolbar, the left panel of stages, segments and
 * treatments, and the card (pipeline) view.
 */
export class ContactsPage {
  readonly table: Locator;
  readonly searchBox: Locator;
  readonly clearSearchButton: Locator;
  /** The left panel: Everyone, stages, segments and treatments. */
  readonly sidebar: Locator;
  readonly addContactButton: Locator;
  readonly filterButton: Locator;
  readonly columnsButton: Locator;
  readonly listViewButton: Locator;
  readonly cardViewButton: Locator;
  readonly perPageButton: Locator;
  readonly pagination: Locator;
  /** The bar that appears once rows are selected. */
  readonly bulkActions: Locator;
  readonly newSegmentButton: Locator;
  /** Only shown while a segment is selected. */
  readonly segmentActionsButton: Locator;
  readonly createDialog: CreateContactDialog;
  readonly filtersDialog: ContactFiltersDialog;
  readonly newSegmentDialog: Locator;
  readonly deleteSegmentDialog: Locator;
  /** Shown instead of the table when nothing matches. */
  readonly noMatches: Locator;
  /** The body of every list search the page sends; see watchSearches(). */
  private readonly searchBodies = new WeakMap<Request, ContactSearch>();
  private watching: Promise<unknown> | undefined;

  constructor(private readonly page: Page) {
    this.table = page.getByRole('grid', { name: 'Contacts table' });
    this.searchBox = page.getByRole('searchbox', { name: 'Search contacts', exact: true });
    this.clearSearchButton = page.getByRole('banner').getByRole('button', { name: 'Clear search' });
    this.sidebar = page.getByRole('navigation', { name: 'Contacts navigation' });
    this.addContactButton = page.getByRole('button', { name: 'Add Contact' });
    // Since the 2026-11-25 redesign Filter opens a menu of fields to filter by.
    this.filterButton = page.getByRole('banner').getByRole('button', { name: 'Filter', exact: true });
    this.columnsButton = page.getByRole('banner').getByRole('button', { name: 'Columns' });
    this.listViewButton = page.getByRole('radio', { name: 'List view' });
    this.cardViewButton = page.getByRole('radio', { name: 'Card view' });
    this.perPageButton = page.getByRole('button', { name: 'Per page' });
    this.pagination = page.getByRole('navigation', { name: 'pagination' });
    this.bulkActions = page.getByRole('toolbar', { name: 'Contact bulk actions' });
    this.newSegmentButton = page.getByRole('button', { name: 'New segment', exact: true });
    this.segmentActionsButton = page.getByLabel('Segment actions');
    this.createDialog = new CreateContactDialog(page);
    this.filtersDialog = new ContactFiltersDialog(page);
    this.newSegmentDialog = page.getByRole('dialog', { name: 'New segment' });
    this.deleteSegmentDialog = page.getByRole('dialog', { name: 'Delete segment?' });
    this.noMatches = page.getByText('No contacts match');
  }

  /** Go to Contacts through the main sidebar. */
  async openFromSidebar(): Promise<void> {
    await this.watchSearches();
    await this.page.goto('/dashboard');
    const listLoaded = this.waitForListSearch();
    await this.page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Contacts' })
      .click();
    expect((await listLoaded).ok(), 'the contact list should load').toBe(true);
    await this.collapseSetupGuide();
  }

  /** Open the page directly, e.g. open("?search=Smith"), and wait for the list to load. */
  async open(query = ''): Promise<void> {
    await this.watchSearches();
    const listLoaded = this.waitForListSearch();
    await this.page.goto(`/contacts${query}`);
    expect((await listLoaded).ok(), 'the contact list should load').toBe(true);
    await this.collapseSetupGuide();
  }

  /** The list's row for the contact called `name` (first and last name). */
  rowFor(name: string): Locator {
    return this.table.getByRole('row').filter({ hasText: name });
  }

  /** Every contact row (not the header row). */
  contactRows(): Locator {
    return this.table.getByRole('rowgroup').nth(1).getByRole('row');
  }

  /** The names of the listed contacts, top to bottom. */
  async contactNames(): Promise<string[]> {
    // The name cell starts with the contact's initials (e.g. "JS"); the name is its last line.
    const cells = await this.contactRows().getByRole('rowheader').allInnerTexts();
    return cells.map((cell) => cell.trim().split('\n').pop()!.trim());
  }

  /** The text of one column for every contact row, e.g. every row's Lifecycle. */
  async columnValues(column: string): Promise<string[]> {
    const headers = await this.table.getByRole('columnheader').allInnerTexts();
    const index = headers.findIndex((header) => header.trim() === column);
    if (index < 0) throw new Error(`The table has no "${column}" column (it has: ${headers.join(', ')})`);
    // Every cell of a row is a gridcell except the name, which is a rowheader; count both.
    const rows = this.contactRows();
    const values: string[] = [];
    for (let row = 0; row < (await rows.count()); row++) {
      const cells = rows.nth(row).locator('[role="gridcell"], [role="rowheader"]');
      values.push((await cells.nth(index).innerText()).trim());
    }
    return values;
  }

  /** Type into the search box and wait for the list to show the results. */
  async search(text: string): Promise<void> {
    const results = this.waitForListSearch((body) => body.search === text);
    await this.searchBox.fill(text);
    expect((await results).ok(), 'the search should succeed').toBe(true);
  }

  /** Press the search box's clear button and wait for the full list. */
  async clearSearch(): Promise<void> {
    const results = this.waitForListSearch((body) => body.search === undefined);
    await this.clearSearchButton.click();
    expect((await results).ok(), 'the list should reload').toBe(true);
  }

  /** A link in the left panel, e.g. "Everyone", a stage, a segment or a treatment. */
  sidebarLink(name: string): Locator {
    // Stage links start with their emoji (e.g. "🔥 Hot Lead"), so match the end of the name.
    // Segment links end with their contact count (e.g. "VIP patients 2"), which is allowed.
    return this.sidebar.getByRole('link', { name: new RegExp(`${escapeRegExp(name)}( \\d+)?$`) });
  }

  /**
   * Click a link in the left panel and wait for the list to reload. Each section shows only its
   * first few links, so type into the panel's own search box first, the way a user finds one.
   */
  async openSidebarLink(name: string): Promise<void> {
    const link = this.sidebarLink(name);
    if (!(await link.isVisible())) {
      await this.sidebar.getByRole('searchbox', { name: 'Search contacts filters' }).fill(name);
    }
    const listLoaded = this.waitForListSearch();
    await link.click();
    expect((await listLoaded).ok(), 'the list should reload').toBe(true);
  }

  /** Open a row's "Contact actions" menu and choose `action`. */
  async chooseRowAction(name: string, action: ContactRowAction): Promise<void> {
    const menuButton = this.rowFor(name).getByRole('button', { name: 'Contact actions' }).first();
    // As on the Settings pages: parallel tests add contacts, the table re-renders, and a click can
    // land during a re-render and leave the menu closed. Click again until the menu reports open
    // (checked first, as a second click would close it).
    await expect(async () => {
      if ((await menuButton.getAttribute('aria-expanded')) !== 'true') {
        await menuButton.click({ timeout: 5_000 });
      }
      await expect(menuButton).toHaveAttribute('aria-expanded', 'true', { timeout: 3_000 });
    }, `the row menu of ${name} should open`).toPass({ timeout: 30_000 });
    await this.page
      .getByRole('menu', { name: 'Contact actions' })
      .getByRole('menuitem', { name: action, exact: true })
      .click();
  }

  /** The side panel of the contact called `name`. */
  panelFor(name: string): ContactPanel {
    return new ContactPanel(this.page, name);
  }

  /** Choose View details in the contact's row menu and wait for its side panel. */
  async openDetails(name: string): Promise<ContactPanel> {
    await this.chooseRowAction(name, 'View details');
    const panel = this.panelFor(name);
    await expect(panel.root).toBeVisible();
    return panel;
  }

  /**
   * Block or unblock from the row menu and confirm. `id` is the contact's id, to wait for its
   * update to reach the server.
   */
  async setBlocked(name: string, id: string, blocked: boolean): Promise<void> {
    await this.chooseRowAction(name, blocked ? 'Block' : 'Unblock');
    const confirmation = this.page.getByRole('dialog').filter({
      hasText: `Are you sure you want to ${blocked ? 'block' : 'unblock'} this contact?`,
    });
    await expect(confirmation).toBeVisible();
    const saved = waitForApiResponse(this.page, 'PATCH', `${ENDPOINTS.contacts}/${id}`);
    await confirmation.getByRole('button', { name: blocked ? 'Yes, Block!' : 'Yes, Unblock!' }).click();
    expect((await saved).ok(), 'the server should save the change').toBe(true);
    await expect(confirmation).toBeHidden();
  }

  /** More → Blocked: the list of blocked contacts. */
  async openBlockedList(): Promise<void> {
    await this.page.getByLabel('More', { exact: true }).click();
    const listLoaded = this.waitForListSearch();
    await this.page.getByRole('menuitem', { name: 'Blocked' }).click();
    expect((await listLoaded).ok(), 'the blocked list should load').toBe(true);
  }

  /** Tick a row's checkbox. */
  async selectRow(name: string): Promise<void> {
    // The real checkbox is hidden under the app's styled box, which takes the clicks (like the
    // Snippets radio buttons), so click its cell the way a user does, then confirm it got ticked.
    const checkbox = this.rowFor(name).getByRole('checkbox');
    await this.rowFor(name)
      .getByRole('gridcell', { name: /^Select row/ })
      .click();
    await expect(checkbox).toBeChecked();
  }

  /** Tick the header's "Select all" checkbox. */
  async selectAll(): Promise<void> {
    const checkbox = this.table.getByRole('checkbox', { name: 'Select all' });
    await this.table.getByRole('columnheader', { name: 'Select all' }).click();
    await expect(checkbox).toBeChecked();
  }

  /** The "Last Activity" column header, which sorts the list. */
  sortHeader(column = 'Last Activity'): Locator {
    return this.table.getByRole('columnheader', { name: column });
  }

  /** Click a column header to sort by it and wait for the re-sorted list. */
  async sortBy(column: string, direction: 'asc' | 'desc'): Promise<void> {
    const sorted = this.waitForListSearch((body) => body.sortDirection === direction);
    await this.sortHeader(column).click();
    expect((await sorted).ok(), 'the sorted list should load').toBe(true);
  }

  /** Choose how many contacts a page shows, e.g. 10. */
  async setPageSize(size: 10 | 25 | 50 | 100): Promise<void> {
    // The setup guide's "Show setup guide" button floats over the bottom right of the page, on
    // top of this button, and always takes the click. Open it from the keyboard instead, as a
    // keyboard user would: focus it and press Enter.
    const listLoaded = this.waitForListSearch((body) => body.limit === size);
    await this.perPageButton.focus();
    await this.perPageButton.press('Enter');
    await this.page
      .getByRole('listbox', { name: 'Per page' })
      .getByRole('option', { name: String(size), exact: true })
      .click();
    expect((await listLoaded).ok(), 'the list should reload').toBe(true);
  }

  /** Press a page number in the pagination, e.g. 2. */
  async goToPage(pageNumber: number): Promise<void> {
    const listLoaded = this.waitForListSearch((body) => body.page === pageNumber);
    await this.pagination.getByRole('button', { name: String(pageNumber), exact: true }).click();
    expect((await listLoaded).ok(), 'the page should load').toBe(true);
  }

  /** Turn a column on or off in the Columns menu. */
  async toggleColumn(column: string): Promise<void> {
    await this.columnsButton.click();
    await this.page
      .getByRole('menu', { name: 'Columns' })
      .getByRole('menuitemcheckbox', { name: column, exact: true })
      .click();
    await this.page.keyboard.press('Escape');
    await expect(this.page.getByRole('menu', { name: 'Columns' })).toBeHidden();
  }

  /** Whether the Columns menu shows `column` as turned on. */
  async isColumnOn(column: string): Promise<boolean> {
    await this.columnsButton.click();
    const item = this.page
      .getByRole('menu', { name: 'Columns' })
      .getByRole('menuitemcheckbox', { name: column, exact: true });
    const on = (await item.getAttribute('aria-checked')) === 'true';
    await this.page.keyboard.press('Escape');
    return on;
  }

  /** The column header called `column`. */
  columnHeader(column: string): Locator {
    return this.table.getByRole('columnheader', { name: column, exact: true });
  }

  /** In card view: the column of a stage that holds the contact called `contactName`. */
  cardColumn(stageName: string, contactName: string): Locator {
    // A column is the smallest block holding both the stage title and the card. Locators list
    // outer blocks before inner ones, so the last match is the column itself.
    return this.page
      .getByRole('main')
      .locator('div')
      .filter({ has: this.stageHeading(stageName) })
      .filter({ hasText: contactName })
      .last();
  }

  /** In card view: the number in a stage column's header. */
  async cardCount(stageName: string): Promise<number> {
    // The header is the smallest block holding the stage title and the count chip.
    const header = this.page
      .getByRole('main')
      .locator('div')
      .filter({ has: this.stageHeading(stageName) })
      .filter({ has: this.page.locator('[data-slot="chip"]') })
      .last();
    return Number(await header.locator('[data-slot="chip"]').innerText());
  }

  /** In card view: the title of a stage column, e.g. "Hot Lead". */
  stageHeading(stageName: string): Locator {
    // Not scoped to main: cardColumn() and cardCount() use it inside filter({ has }), which looks
    // for it within each block. No other level-6 heading carries a stage name.
    return this.page.getByRole('heading', { name: stageName, exact: true, level: 6 });
  }

  /** Delete the selected segment through Segment actions, confirming the dialog names it. */
  async deleteSelectedSegment(name: string, segmentId: string): Promise<void> {
    await this.segmentActionsButton.click();
    await this.page.getByRole('menuitem', { name: 'Delete segment' }).click();
    await expect(this.deleteSegmentDialog).toBeVisible();
    await expect(this.deleteSegmentDialog).toContainText(name);
    const deleted = waitForApiResponse(this.page, 'DELETE', `${ENDPOINTS.segments}/${segmentId}`);
    await this.deleteSegmentDialog.getByRole('button', { name: 'Delete segment' }).click();
    expect((await deleted).ok(), 'the server should delete the segment').toBe(true);
    await expect(this.deleteSegmentDialog).toBeHidden();
  }

  /**
   * Wait for the list's own search request (not the page's separate one-row count request).
   * Pass `matches` to wait for a request with particular parameters, e.g. a search text.
   * Only works after open() or openFromSidebar(), which start watchSearches().
   */
  waitForListSearch(matches: (body: ContactSearch) => boolean = () => true): Promise<Response> {
    return this.page.waitForResponse((response) => {
      const body = this.searchBodies.get(response.request());
      return body !== undefined && body.sortBy !== undefined && matches(body);
    });
  }

  /**
   * Remember the body of every contact search the page sends. Playwright does not show a request's
   * body on its response (this app's request reports an empty body there), but a route handler
   * sees it. The handler only reads the body; the request goes on to the server unchanged.
   */
  private async watchSearches(): Promise<void> {
    this.watching ??= this.page.route(`${env.apiUrl}${SEARCH_PATH}`, async (route) => {
      this.searchBodies.set(route.request(), route.request().postDataJSON() ?? {});
      await route.fallback();
    });
    await this.watching;
  }

  /** The setup guide floats over the bottom right of the page; fold it away when it is open. */
  private async collapseSetupGuide(): Promise<void> {
    const collapse = this.page.getByRole('button', { name: 'Collapse setup guide' });
    if (await collapse.isVisible()) await collapse.click();
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
