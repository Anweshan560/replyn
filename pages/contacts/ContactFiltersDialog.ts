import { expect, type Locator, type Page } from '@playwright/test';
import { ENDPOINTS } from '../../api/ResourceApi';
import type { Segment } from '../../api/ContactsApi';
import { waitForApiResponse } from '../../utils/network';

/**
 * Contacts → New segment: build rules, watch the "N contacts match" preview, and save the rules as
 * a segment. Since the 2026-11-25 redesign this one dialog does what the old Filters dialog did.
 */
export class ContactFiltersDialog {
  readonly root: Locator;
  readonly segmentNameInput: Locator;
  readonly addRuleButton: Locator;
  readonly createSegmentButton: Locator;
  /** "2 contacts match", "1 contact matches". */
  readonly matchCount: Locator;
  readonly preview: Locator;

  constructor(private readonly page: Page) {
    this.root = page.getByRole('dialog', { name: 'New segment' });
    this.segmentNameInput = this.root.getByRole('textbox', { name: 'Name' });
    this.addRuleButton = this.root.getByRole('button', { name: 'Add rule' });
    this.createSegmentButton = this.root.getByRole('button', { name: 'Create segment' });
    this.matchCount = this.root.getByRole('heading', { level: 6 });
    this.preview = this.root.getByRole('grid', { name: 'Matching contacts' });
  }

  async open(): Promise<void> {
    await this.page.getByRole('button', { name: 'New segment', exact: true }).first().click();
    await expect(this.root).toBeVisible();
  }

  /** Add a rule "First name contains `text`". A new rule starts as "Status is equal to …". */
  async addFirstNameContainsRule(text: string): Promise<void> {
    await this.addRuleButton.click();
    await this.chooseField('First name');
    await expect(this.root.getByRole('button', { name: /Select operator$/ }).last()).toHaveText('contains');
    await this.root.getByRole('textbox', { name: 'Enter value' }).last().fill(text);
  }

  /**
   * Set the last rule's field, e.g. "First name". Its real button is zero-sized under the visible
   * pill (a group), which takes the click.
   */
  async chooseField(field: string): Promise<void> {
    const fieldButton = this.root.getByRole('button', { name: /Filter field$/ }).last();
    const pill = this.page.getByRole('button', { name: /Filter field$/ });
    await this.root.getByRole('group').filter({ has: pill }).last().click();
    await this.page
      .getByRole('dialog', { name: 'Filter field' })
      // The options have no accessible name since 2026-11-27: each holds the field and its
      // description as text.
      .getByRole('option')
      .filter({ has: this.page.getByText(field, { exact: true }) })
      .click();
    await expect(fieldButton).toHaveAccessibleName(`${field} Filter field`);
  }

  /** A contact's row in the preview. */
  previewRow(name: string): Locator {
    return this.preview.getByRole('row').filter({ hasText: name });
  }

  /** Name the rules and save them as a segment; returns the new segment. */
  async saveAsSegment(name: string): Promise<Segment> {
    await this.segmentNameInput.fill(name);
    const created = waitForApiResponse(this.page, 'POST', ENDPOINTS.segments);
    await this.createSegmentButton.click();
    const response = await created;
    expect(response.status(), 'the server should create the segment').toBe(201);
    await expect(this.root).toBeHidden();
    return (await response.json()).data;
  }
}
