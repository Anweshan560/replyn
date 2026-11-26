import { expect, type Locator, type Page, type Response } from '@playwright/test';
import type { ContactSearch, FilterRule, FilterRules } from '../../api/ContactsApi';

/** Waits for the Contacts list's next search whose body passes `matches` (ContactsPage provides it). */
type ListSearchWaiter = (matches: (body: ContactSearch) => boolean) => Promise<Response>;

/** The rules of a list search, without the "and" / "or" between them. */
function rulesOf(body: ContactSearch): FilterRule[] {
  return (body.filter?.rules ?? []).filter((rule): rule is FilterRule => typeof rule === 'object');
}

/**
 * Contacts → Filter: a menu of fields (Suggested, Contact, Activity, Source, Visits and money,
 * Custom fields). Picking one adds a filter pill and opens its editor; the filter goes in the
 * address as ?filter={"rules":[...]} and the list reloads. "Advanced rules (and / or)" opens a
 * dialog that joins rules with "and" or "or".
 */
export class ContactFilterMenu {
  /** "Filter 2" once filters are applied (the plain "Filter" button before). */
  readonly activeFiltersButton: Locator;
  readonly clearFiltersButton: Locator;
  readonly advancedDialog: Locator;
  /** "2 contacts match", in the Advanced rules dialog. */
  readonly advancedMatchCount: Locator;

  constructor(
    private readonly page: Page,
    private readonly waitForListSearch: ListSearchWaiter,
  ) {
    const banner = page.getByRole('banner');
    this.activeFiltersButton = banner.getByRole('button', { name: /^Filter \d+$/ });
    this.clearFiltersButton = banner.getByRole('button', { name: 'Clear filters' });
    this.advancedDialog = page.getByRole('dialog', { name: 'Advanced rules' });
    this.advancedMatchCount = this.advancedDialog.getByRole('heading', { level: 6 });
  }

  /** Open the Filter menu and pick a field, e.g. "Last name". */
  async pickField(field: string): Promise<void> {
    await this.page
      .getByRole('banner')
      .getByRole('button', { name: /^Filter( \d+)?$/ })
      .click();
    await this.page
      .getByRole('menu', { name: 'Filter' })
      .getByRole('menuitem', { name: field, exact: true })
      .first()
      .click();
  }

  /** Add "<field> contains <text>" (a text field, e.g. "Last name") and wait for the list. */
  async addTextFilter(field: string, text: string): Promise<void> {
    await this.pickField(field);
    const editor = this.page.getByRole('dialog', { name: `${field} filter` });
    await expect(editor.getByRole('paragraph')).toHaveText(`${field} contains`);
    const filtered = this.waitForListSearch((body) =>
      rulesOf(body).some((rule) => rule.operator === 'contains' && rule.value === text),
    );
    await editor.getByRole('textbox', { name: 'Enter value' }).fill(text);
    expect((await filtered).ok(), 'the filtered list should load').toBe(true);
    await this.page.keyboard.press('Escape');
  }

  /** Add Tags → `tagName` and wait for the list. */
  async addTagFilter(tagName: string, tagId: string): Promise<void> {
    await this.pickField('Tags');
    const tags = this.page.getByRole('dialog', { name: 'Tags' });
    await tags.getByRole('searchbox', { name: 'Search tags' }).fill(tagName);
    const filtered = this.waitForListSearch((body) =>
      rulesOf(body).some(
        (rule) => rule.field === 'tags' && JSON.stringify(rule.value) === JSON.stringify([tagId]),
      ),
    );
    await tags.getByRole('menuitemcheckbox', { name: tagName }).click();
    expect((await filtered).ok(), 'the filtered list should load').toBe(true);
    await this.page.keyboard.press('Escape');
  }

  /** Add "Created at in the last <amount> <unit>" and wait for the list. */
  async addCreatedInTheLast(
    amount: number,
    unit: 'Minutes' | 'Hours' | 'Days' | 'Weeks' | 'Months',
  ): Promise<void> {
    await this.pickField('Created at');
    const editor = this.page.getByRole('dialog', { name: 'Created at filter' });
    const apiUnit = unit.toLowerCase();
    if (unit !== 'Days') {
      await editor.getByRole('button', { name: /Time unit$/ }).click();
      await this.page.getByRole('listbox', { name: 'Time unit' }).getByRole('option', { name: unit }).click();
    }
    const filtered = this.waitForListSearch((body) =>
      rulesOf(body).some(
        (rule) =>
          rule.field === 'createdAt' &&
          JSON.stringify(rule.value) === JSON.stringify({ amount, unit: apiUnit }),
      ),
    );
    await editor.getByRole('spinbutton', { name: 'Amount' }).fill(String(amount));
    expect((await filtered).ok(), 'the filtered list should load').toBe(true);
    await this.page.keyboard.press('Escape');
  }

  /** Add a yes/no field, e.g. "Has follow-up": it applies at once as "is yes". */
  async addYesFilter(field: string, apiField: string): Promise<void> {
    const filtered = this.waitForListSearch((body) =>
      rulesOf(body).some((rule) => rule.field === apiField && rule.value === true),
    );
    await this.pickField(field);
    expect((await filtered).ok(), 'the filtered list should load').toBe(true);
    await this.page.keyboard.press('Escape');
  }

  /** Remove every filter with "Clear filters" and wait for the unfiltered list. */
  async clearFilters(): Promise<void> {
    const reloaded = this.waitForListSearch((body) => rulesOf(body).length === 0);
    await this.clearFiltersButton.click();
    expect((await reloaded).ok(), 'the list should reload').toBe(true);
  }

  /** The filter rules in the address bar (?filter=...), or [] when there are none. */
  async rulesInAddress(): Promise<FilterRules> {
    const filter = new URL(this.page.url()).searchParams.get('filter');
    return filter ? JSON.parse(filter).rules : [];
  }

  // --- Advanced rules ---------------------------------------------------------------------------

  async openAdvanced(): Promise<void> {
    await this.pickField('Advanced rules (and / or)');
    await expect(this.advancedDialog).toBeVisible();
  }

  /** Add a rule "<field> contains <text>" at the end of the Advanced rules dialog. */
  async addAdvancedTextRule(field: string, text: string): Promise<void> {
    await this.advancedDialog.getByRole('button', { name: 'Add rule' }).first().click();
    // A new rule starts as "Status is equal to"; its field button is zero-sized under the pill
    // (a group), which takes the click.
    const pill = this.page.getByRole('button', { name: /Filter field$/ });
    await this.advancedDialog.getByRole('group').filter({ has: pill }).last().click();
    await this.page
      .getByRole('dialog', { name: 'Filter field' })
      .getByRole('option', { name: field, exact: true })
      .click();
    await expect(this.advancedDialog.getByRole('button', { name: /Select operator$/ }).last()).toHaveText(
      'contains',
    );
    await this.advancedDialog.getByRole('textbox', { name: 'Enter value' }).last().fill(text);
  }

  /** Join the first two rules with "and" or "or". */
  async joinAdvancedRulesWith(join: 'and' | 'or'): Promise<void> {
    await this.advancedDialog
      .getByRole('button', { name: /^(and|or)$/ })
      .first()
      .click();
    await this.page.getByRole('menuitemradio', { name: join, exact: true }).click();
    await expect(this.advancedDialog.getByRole('button', { name: join, exact: true }).first()).toBeVisible();
  }

  /** Apply the Advanced rules and wait for the list. */
  async applyAdvanced(): Promise<void> {
    const filtered = this.waitForListSearch((body) => rulesOf(body).length > 0);
    await this.advancedDialog.getByRole('button', { name: 'Apply' }).click();
    expect((await filtered).ok(), 'the filtered list should load').toBe(true);
    await expect(this.advancedDialog).toBeHidden();
  }
}
