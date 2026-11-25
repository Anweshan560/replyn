import { expect, type Locator, type Page } from '@playwright/test';
import { ENDPOINTS } from '../../api/ResourceApi';
import type { Contact } from '../../api/ContactsApi';
import { waitForApiResponse } from '../../utils/network';
import type { ContactData } from '../../utils/testData';

/**
 * Everything the New contact dialog can be filled with. Only the first name is required. The
 * dialog has no address field (since the 2026-11-25 redesign), so `address` is ignored.
 */
export type NewContact = Partial<ContactData> & {
  firstName: string;
  /** A stage name, e.g. "Hot Lead". */
  lifecycle?: string;
  /** Who referred them: turns on the Referral switch and fills in "Who sent them". */
  referredBy?: string;
  /** Tag names. */
  tags?: string[];
};

/** The app posts new contacts to "/v1/contacts/", with a trailing slash. */
const CREATE_PATH = new RegExp(`^${ENDPOINTS.contacts}/?$`);

/** Contacts → Add Contact: the New contact dialog. */
export class CreateContactDialog {
  readonly root: Locator;
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly phoneInput: Locator;
  readonly emailInput: Locator;
  readonly noteInput: Locator;
  readonly referralSwitch: Locator;
  readonly referredByInput: Locator;
  readonly createButton: Locator;
  readonly cancelButton: Locator;
  readonly closeButton: Locator;
  readonly invalidFirstNameError: Locator;
  readonly invalidEmailError: Locator;
  readonly invalidPhoneError: Locator;

  constructor(private readonly page: Page) {
    this.root = page.getByRole('dialog', { name: 'New contact' });
    this.firstNameInput = this.root.getByRole('textbox', { name: 'First name' });
    this.lastNameInput = this.root.getByRole('textbox', { name: 'Last name' });
    this.phoneInput = this.root.getByRole('textbox', { name: 'Phone' });
    this.emailInput = this.root.getByRole('textbox', { name: 'Email' });
    this.noteInput = this.root.getByRole('textbox', { name: 'Note' });
    this.referralSwitch = this.root.getByRole('switch', { name: 'Referral' });
    this.referredByInput = this.root.getByRole('textbox', { name: 'Who sent them' });
    this.createButton = this.root.getByRole('button', { name: 'Add contact' });
    this.cancelButton = this.root.getByRole('button', { name: 'Cancel' });
    this.closeButton = this.root.getByRole('button', { name: 'Close' });
    this.invalidFirstNameError = this.root.getByText('Enter a valid first name');
    this.invalidEmailError = this.root.getByText('Enter a valid email');
    this.invalidPhoneError = this.root.getByText('Enter a valid phone number');
  }

  /** Press Add Contact and wait for the empty dialog. */
  async open(): Promise<void> {
    await this.page.getByRole('button', { name: 'Add Contact' }).click();
    await expect(this.root).toBeVisible();
  }

  /** Fill every field given in `contact`; fields left out keep their current value. */
  async fill(contact: Partial<NewContact>): Promise<void> {
    if (contact.firstName !== undefined) await this.firstNameInput.fill(contact.firstName);
    if (contact.lastName !== undefined) await this.lastNameInput.fill(contact.lastName);
    if (contact.phone !== undefined) {
      // The phone field formats the number as it is typed, so type it key by key like a user.
      await this.phoneInput.clear();
      await this.phoneInput.pressSequentially(contact.phone);
    }
    if (contact.email !== undefined) await this.emailInput.fill(contact.email);
    if (contact.lifecycle) await this.chooseLifecycle(contact.lifecycle);
    if (contact.referredBy !== undefined) {
      // The switch's input sits under its drawn thumb, which takes the click; check it directly.
      await this.referralSwitch.check({ force: true });
      await this.referredByInput.fill(contact.referredBy);
    }
    for (const tag of contact.tags ?? []) await this.addTag(tag);
  }

  /**
   * Press Add contact and wait for the server. Does not wait for the dialog to close, so the
   * caller can register cleanup first; check `root` is hidden afterwards.
   * @returns the new contact, as the server stored it.
   */
  async submit(): Promise<Contact> {
    const created = waitForApiResponse(this.page, 'POST', CREATE_PATH);
    await this.createButton.click();
    const response = await created;
    expect(response.status(), 'the server should create the contact').toBe(201);
    return (await response.json()).data;
  }

  /** Move focus out of the field just typed in, which is when the dialog checks it. */
  async leaveField(): Promise<void> {
    await this.noteInput.click();
  }

  private async chooseLifecycle(stage: string): Promise<void> {
    await this.root.getByRole('button', { name: 'Lifecycle', exact: true }).click();
    // Options carry the stage's emoji, e.g. "🔥 Hot Lead".
    await this.page
      .getByRole('dialog', { name: 'Lifecycle' })
      .getByRole('option', { name: new RegExp(`${escapeRegExp(stage)}$`) })
      .click();
    await expect(this.root.getByRole('button', { name: 'Lifecycle', exact: true })).toContainText(stage);
  }

  private async addTag(tag: string): Promise<void> {
    await this.root.getByRole('button', { name: 'Tags', exact: true }).click();
    const picker = this.page.getByRole('dialog', { name: 'Tags' });
    await picker.getByRole('option', { name: tag, exact: true }).click();
    // The picker may stay open for more tags; Escape closes the picker only, not the dialog.
    if (await picker.isVisible()) await this.page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await expect(this.root.getByRole('button', { name: 'Tags', exact: true })).toContainText(tag);
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
