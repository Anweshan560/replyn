import { expect, type Locator, type Page } from '@playwright/test';
import { ENDPOINTS } from '../../api/ResourceApi';
import { waitForApiResponse } from '../../utils/network';
import type { ContactData } from '../../utils/testData';

/** The side panel's tabs. */
export type ContactTab = 'Overview' | 'Messages' | 'Appointments' | 'Billing' | 'History' | 'Details';

/**
 * The side panel that opens over the Contacts list (View details, Edit): the contact's stage,
 * notes and timeline, its tabs, and Resolve.
 */
export class ContactPanel {
  readonly root: Locator;
  readonly stageButton: Locator;
  readonly resolveButton: Locator;
  readonly moreActionsButton: Locator;
  readonly closeButton: Locator;
  readonly notes: Locator;
  readonly noteInput: Locator;
  /** The Details tab's "N unsaved change(s)" bar and its Save button. */
  readonly saveButton: Locator;
  readonly resolveDialog: Locator;

  /** `name` is the contact's full name, which is the panel's title. */
  constructor(
    private readonly page: Page,
    name: string,
  ) {
    this.root = page.getByRole('dialog', { name, exact: true });
    this.stageButton = this.root.getByRole('button', { name: 'Stage' });
    this.resolveButton = this.root.getByRole('button', { name: 'Resolve' });
    // .first(): the menu button is nested in a second button with the same name.
    this.moreActionsButton = this.root.getByRole('button', { name: 'More actions' }).first();
    this.closeButton = this.root.getByRole('button', { name: 'Close contact' });
    this.notes = this.root.getByRole('region', { name: 'Notes' });
    this.noteInput = this.root.getByRole('textbox', { name: 'Write a note, @ to mention' });
    this.saveButton = this.root.getByRole('button', { name: 'Save', exact: true });
    this.resolveDialog = page.getByRole('dialog', { name: 'Resolve' });
  }

  tab(name: ContactTab): Locator {
    return this.root
      .getByRole('tablist', { name: 'Contact sections' })
      .getByRole('tab', { name, exact: true });
  }

  async openTab(name: ContactTab): Promise<void> {
    await this.tab(name).click();
    await expect(this.tab(name)).toHaveAttribute('aria-selected', 'true');
  }

  /** A field on the Details tab, e.g. "Last name". */
  detailsField(label: 'First name' | 'Last name' | 'Phone' | 'Email' | 'Address'): Locator {
    return this.root.getByRole('textbox', { name: label, exact: true });
  }

  /** On the Details tab, replace every text field with `contact` and press Save. */
  async saveDetails(contactId: string, contact: ContactData): Promise<void> {
    await this.openTab('Details');
    await this.detailsField('First name').fill(contact.firstName);
    await this.detailsField('Last name').fill(contact.lastName);
    // The phone field formats the number as it is typed, so type it key by key like a user.
    await this.detailsField('Phone').clear();
    await this.detailsField('Phone').pressSequentially(contact.phone);
    await this.detailsField('Email').fill(contact.email);
    await this.detailsField('Address').fill(contact.address);
    const saved = waitForApiResponse(this.page, 'PATCH', `${ENDPOINTS.contacts}/${contactId}`);
    await this.saveButton.click();
    expect((await saved).ok(), 'the server should save the changes').toBe(true);
    await expect(this.saveButton).toBeHidden();
  }

  /** Pick a new stage from the Stage button and wait for the server to save it. */
  async changeStage(contactId: string, stageName: string): Promise<void> {
    await this.stageButton.click();
    const saved = waitForApiResponse(this.page, 'PATCH', `${ENDPOINTS.contacts}/${contactId}`);
    await this.page.getByRole('listbox', { name: 'Stage' }).getByRole('option', { name: stageName }).click();
    expect((await saved).ok(), 'the server should save the new stage').toBe(true);
    await expect(this.stageButton).toContainText(stageName);
  }

  /** Write a note on the Overview tab and save it. */
  async addNote(contactId: string, text: string): Promise<void> {
    await this.openTab('Overview');
    await this.noteInput.fill(text);
    const saved = waitForApiResponse(this.page, 'POST', `${ENDPOINTS.contacts}/${contactId}/activity`);
    await this.notes.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await saved).status(), 'the server should save the note').toBe(201);
  }

  /** A saved note in the Notes section. */
  note(text: string): Locator {
    return this.notes.getByRole('button', { name: new RegExp(escapeRegExp(text)) });
  }

  /** Resolve the conversation with a closing-note category and summary. */
  async resolve(contactId: string, category: string, summary: string): Promise<void> {
    await this.resolveButton.click();
    await expect(this.resolveDialog).toBeVisible();
    await this.resolveDialog.getByRole('button', { name: /Select closing note category/ }).click();
    await this.page
      .getByRole('listbox', { name: /Category/ })
      .getByRole('option', { name: category, exact: true })
      .click();
    await this.resolveDialog.getByRole('textbox', { name: 'Summary' }).fill(summary);
    const saved = waitForApiResponse(this.page, 'PATCH', `${ENDPOINTS.contacts}/${contactId}`);
    // This dialog's "Close" is its submit button: it closes the conversation.
    await this.resolveDialog.getByRole('button', { name: 'Close', exact: true }).click();
    expect((await saved).ok(), 'the server should resolve the conversation').toBe(true);
    await expect(this.resolveDialog).toBeHidden();
  }

  /** On the Billing tab: Add advance for `amount` with a note, and save. */
  async addAdvance(contactId: string, amount: number, note: string): Promise<void> {
    await this.openTab('Billing');
    await this.root.getByRole('button', { name: 'Add advance' }).click();
    const dialog = this.page.getByRole('dialog', { name: 'Add an advance' });
    await expect(dialog).toBeVisible();
    const amountInput = dialog.getByRole('textbox', { name: 'Amount' });
    await amountInput.fill(String(amount));
    // The amount field takes the value when it loses focus.
    await amountInput.press('Tab');
    await dialog.getByRole('textbox', { name: 'Note' }).fill(note);
    const saved = waitForApiResponse(this.page, 'POST', `${ENDPOINTS.clinicContacts}/${contactId}/advances`);
    await dialog.getByRole('button', { name: 'Save' }).click();
    expect((await saved).status(), 'the server should save the advance').toBe(201);
    await expect(dialog).toBeHidden();
  }

  /** A money record on the Billing tab, e.g. the advance "ADV-000004". */
  billingDocument(code: string): Locator {
    return this.root.getByRole('button', { name: new RegExp(escapeRegExp(code)) });
  }

  /** The items of the More actions menu, in order. */
  async moreActionsItems(): Promise<string[]> {
    await this.moreActionsButton.click();
    const menu = this.page.getByRole('menu', { name: 'More actions' });
    await expect(menu).toBeVisible();
    const items = await menu.getByRole('menuitem').allInnerTexts();
    await this.page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    return items.map((item) => item.trim());
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
