import { test, expect } from '../../fixtures/test';
import { fullName } from '../../api/ContactsApi';
import { ENDPOINTS } from '../../api/ResourceApi';
import { toTagPayload } from '../../api/SettingsApis';
import { recordApiCalls } from '../../utils/network';
import { buildContact, buildTag, pickRandom } from '../../utils/testData';

/** The app posts new contacts to "/v1/contacts/", with a trailing slash. */
const CREATE_PATH = new RegExp(`^${ENDPOINTS.contacts}/?$`);

test.describe('Contacts → Create contact', { tag: ['@contacts'] }, () => {
  test('should save every field when user creates a contact', async ({
    contactsPage,
    contactsApi,
    lifecyclesApi,
    tagsApi,
    cleanup,
  }) => {
    // The dialog lists the workspace's inbox tags, and the workspace may have none: bring one.
    const tag = await test.step('create a tag to give the contact (through the API)', () =>
      tagsApi.createRecord(toTagPayload(buildTag())));
    cleanup.add(`tag "${tag.name}"`, () => tagsApi.deleteIfExists(tag.id));
    // Any stage but the default, so the saved stage can only be the one chosen in the dialog.
    const stage = pickRandom((await lifecyclesApi.openStages()).filter((s) => !s.isDefault));
    // The dialog has no address field.
    const { address: _noAddressField, ...contact } = buildContact();
    const referredBy = buildContact().firstName;

    await test.step('open Contacts → Add Contact', async () => {
      await contactsPage.open();
      await contactsPage.createDialog.open();
    });
    const created = await test.step('fill in every field and create', async () => {
      await contactsPage.createDialog.fill({
        ...contact,
        lifecycle: stage.name,
        referredBy,
        tags: [tag.name],
      });
      return contactsPage.createDialog.submit();
    });
    cleanup.add(`contact "${fullName(contact)}"`, () => contactsApi.deleteIfExists(created.id));
    await test.step('the dialog closes', async () => {
      await expect(contactsPage.createDialog.root).toBeHidden();
    });

    await test.step('the contact is listed with its phone and stage', async () => {
      await contactsPage.search(fullName(contact));
      const row = contactsPage.rowFor(fullName(contact));
      await expect(row).toBeVisible();
      await expect(row).toContainText(contact.phone);
      await expect(row).toContainText(stage.name);
    });
    await test.step('the server stored every value', async () => {
      const response = await contactsApi.get(created.id);
      expect(response.status()).toBe(200);
      expect((await response.json()).data).toMatchObject({
        ...contact,
        lifecycleId: stage.id,
        source: 'referral',
        referredByName: referredBy,
        tags: [tag.id],
      });
    });
  });

  test('should create a contact from the first name alone', async ({
    contactsPage,
    contactsApi,
    lifecyclesApi,
    cleanup,
  }) => {
    // The first name carries the unique number here, as it is the only name the contact has.
    const { firstName } = buildContact({ uniqueFirstName: true });
    const defaultStage = (await lifecyclesApi.stagesWithCounts()).find((stage) => stage.isDefault)!;

    await test.step('open Contacts → Add Contact', async () => {
      await contactsPage.open();
      await contactsPage.createDialog.open();
    });
    const created = await test.step('type only the first name and create', async () => {
      await contactsPage.createDialog.fill({ firstName });
      return contactsPage.createDialog.submit();
    });
    cleanup.add(`contact "${firstName}"`, () => contactsApi.deleteIfExists(created.id));
    await test.step('the dialog closes', async () => {
      await expect(contactsPage.createDialog.root).toBeHidden();
    });

    await test.step('the contact is listed', async () => {
      await contactsPage.search(firstName);
      await expect(contactsPage.rowFor(firstName)).toBeVisible();
    });
    await test.step(`the server stored it as a manual contact in "${defaultStage.name}"`, async () => {
      const stored = (await (await contactsApi.get(created.id)).json()).data;
      expect(stored).toMatchObject({ firstName, source: 'manual', lifecycleId: defaultStage.id });
      // The empty fields are sent as "" or null; either way they hold nothing.
      for (const field of ['lastName', 'phone', 'email'] as const) expect(stored[field] || null).toBeNull();
    });
  });

  test('should not create a contact without a first name', async ({ page, contactsPage }) => {
    const createCalls = recordApiCalls(page, 'POST', CREATE_PATH);
    // Every other field is valid, so only the missing first name can stop the save.
    const { firstName: _omitted, ...rest } = buildContact();

    await test.step('open Contacts → Add Contact', async () => {
      await contactsPage.open();
      await contactsPage.createDialog.open();
    });
    await test.step('fill in everything except the first name and press Add contact', async () => {
      await contactsPage.createDialog.fill(rest);
      await contactsPage.createDialog.createButton.click();
    });
    await test.step('the first name shows "Enter a valid first name" and the dialog stays open', async () => {
      await expect(contactsPage.createDialog.invalidFirstNameError).toBeVisible();
      await expect(contactsPage.createDialog.root).toBeVisible();
      await expect(contactsPage.createDialog.emailInput).toHaveValue(rest.email);
    });
    await test.step('nothing is sent to the server', () => {
      expect(createCalls, 'no create-contact request should be sent').toEqual([]);
    });
  });

  test('should refuse an invalid email', async ({ page, contactsPage }) => {
    const createCalls = recordApiCalls(page, 'POST', CREATE_PATH);
    const contact = { ...buildContact(), email: 'not-an-email' };

    await test.step('open Contacts → Add Contact', async () => {
      await contactsPage.open();
      await contactsPage.createDialog.open();
    });
    await test.step('fill in the form with an invalid email and press Add contact', async () => {
      await contactsPage.createDialog.fill(contact);
      await contactsPage.createDialog.createButton.click();
    });
    await test.step('the email shows "Enter a valid email" and the dialog stays open', async () => {
      await expect(contactsPage.createDialog.invalidEmailError).toBeVisible();
      await expect(contactsPage.createDialog.emailInput).toHaveAttribute('aria-invalid', 'true');
      await expect(contactsPage.createDialog.root).toBeVisible();
    });
    await test.step('nothing is sent to the server', () => {
      expect(createCalls, 'no create-contact request should be sent').toEqual([]);
    });
  });

  test('should refuse an invalid phone number', async ({ page, contactsPage }) => {
    const createCalls = recordApiCalls(page, 'POST', CREATE_PATH);
    // A US number needs 10 digits; this one has 7.
    const contact = { ...buildContact(), phone: '+15551234' };

    await test.step('open Contacts → Add Contact', async () => {
      await contactsPage.open();
      await contactsPage.createDialog.open();
    });
    await test.step('fill in the form with a too-short phone number and press Add contact', async () => {
      await contactsPage.createDialog.fill(contact);
      await contactsPage.createDialog.createButton.click();
    });
    await test.step('the phone shows "Enter a valid phone number" and the dialog stays open', async () => {
      await expect(contactsPage.createDialog.invalidPhoneError).toBeVisible();
      await expect(contactsPage.createDialog.phoneInput).toHaveAttribute('aria-invalid', 'true');
      await expect(contactsPage.createDialog.root).toBeVisible();
    });
    await test.step('nothing is sent to the server', () => {
      expect(createCalls, 'no create-contact request should be sent').toEqual([]);
    });
  });

  for (const button of ['Cancel', 'Close'] as const) {
    test(`should save nothing when user presses ${button}`, async ({ page, contactsPage }) => {
      const createCalls = recordApiCalls(page, 'POST', CREATE_PATH);
      const contact = buildContact();
      const dialog = contactsPage.createDialog;

      await test.step('open Contacts → Add Contact and fill in every field', async () => {
        await contactsPage.open();
        await dialog.open();
        await dialog.fill(contact);
      });
      await test.step(`press ${button}`, async () => {
        await (button === 'Cancel' ? dialog.cancelButton : dialog.closeButton).click();
        await expect(dialog.root).toBeHidden();
      });

      await test.step('nothing was sent, and searching for the name finds nothing', async () => {
        expect(createCalls, 'no create-contact request should be sent').toEqual([]);
        await contactsPage.search(fullName(contact));
        await expect(contactsPage.noMatches).toBeVisible();
      });
      // Not checked: reopening the dialog still shows what was typed (as of 2026-10-30). Whether
      // Cancel should discard that draft is a product decision.
    });
  }
});
