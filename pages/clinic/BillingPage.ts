import { expect, type Locator, type Page } from '@playwright/test';
import { ENDPOINTS } from '../../api/ResourceApi';
import { waitForApiResponse } from '../../utils/network';
import { openFromSidebarGroup } from '../Sidebar';

/** The Billing tabs, and the ?view= value each one puts in the address. */
export const BILLING_TABS = {
  'Owes money': 'owes',
  'Needs review': 'review',
  'Credit on account': 'credit',
  'All patients': 'all',
  Documents: 'documents',
} as const;

export type BillingTab = keyof typeof BILLING_TABS;

/** Clinic → Billing: who owes money, what needs checking, and every invoice, receipt and advance. */
export class BillingPage {
  readonly tabs: Locator;
  readonly searchBox: Locator;
  /** The grid of the current tab: patients, the review queue or the ledger. */
  readonly grid: Locator;

  constructor(private readonly page: Page) {
    this.tabs = page.getByRole('tablist', { name: 'Billing views' });
    this.searchBox = page.getByRole('searchbox', { name: 'Search patients' });
    this.grid = page.getByRole('main').getByRole('grid');
  }

  /** Go to Billing through the main sidebar's Clinic group. */
  async openFromSidebar(): Promise<void> {
    await this.page.goto('/dashboard');
    const loaded = waitForApiResponse(this.page, 'GET', `${ENDPOINTS.billing}/patients`);
    await openFromSidebarGroup(this.page, 'Clinic', 'Billing');
    expect((await loaded).ok(), 'billing should load').toBe(true);
  }

  /** Open a tab directly and wait for its data. */
  async open(tab: BillingTab = 'Owes money'): Promise<void> {
    const loaded = waitForApiResponse(this.page, 'GET', `${ENDPOINTS.billing}/patients`);
    await this.page.goto(`/clinics/billing?view=${BILLING_TABS[tab]}`);
    expect((await loaded).ok(), 'billing should load').toBe(true);
    await expect(this.tab(tab)).toHaveAttribute('aria-selected', 'true');
  }

  /** A tab, e.g. "Needs review". Its name also holds the count, e.g. "Needs review 1". */
  tab(name: BillingTab): Locator {
    return this.tabs.getByRole('tab', { name: new RegExp(`^${name}`) });
  }

  async openTab(name: BillingTab): Promise<void> {
    await this.tab(name).click();
    await expect(this.tab(name)).toHaveAttribute('aria-selected', 'true');
  }

  /** The rows of the current tab's grid for the patient called `name`. */
  rowsFor(name: string): Locator {
    return this.grid.getByRole('row').filter({ hasText: name });
  }
}
