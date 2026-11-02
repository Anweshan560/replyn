import { test, expect } from '../../fixtures/test';
import { fullName, toContactPayload } from '../../api/ContactsApi';
import { ENDPOINTS } from '../../api/ResourceApi';
import { waitForApiResponse } from '../../utils/network';
import { buildContact, buildContactBatch } from '../../utils/testData';
import { knownBug } from '../../utils/knownBug';

// Every test works on a contact it creates through the API, so blocking, opting out and messaging
// never touch real contacts. Message only opens the conversation; it sends nothing.
test.describe('Contacts → row actions', { tag: ['@contacts'] }, () => {
  test('should save every change when user edits a contact', async ({
    contactsPage,
    contactsApi,
    cleanup,
  }) => {
    const original = buildContact();
    const created = await test.step('create a contact to edit (through the API)', () =>
      contactsApi.createRecord(toContactPayload(original)));
    cleanup.add(`contact "${fullName(original)}"`, () => contactsApi.deleteIfExists(created.id));
    const updated = buildContact();

    await test.step('find the contact and choose Edit in its row menu', async () => {
      await contactsPage.open();
      await contactsPage.search(fullName(original));
      await contactsPage.chooseRowAction(fullName(original), 'Edit');
    });
    const panel = contactsPage.panelFor(fullName(original));
    await test.step('the side panel opens on the Details tab with the current values', async () => {
      await expect(panel.tab('Details')).toHaveAttribute('aria-selected', 'true');
      await expect(panel.detailsField('First name')).toHaveValue(original.firstName);
      await expect(panel.detailsField('Email')).toHaveValue(original.email);
    });

    await test.step('change every field and press Save', () => panel.saveDetails(created.id, updated));

    await test.step('the server stored every new value', async () => {
      expect((await (await contactsApi.get(created.id)).json()).data).toMatchObject(updated);
    });
    await test.step('the list shows the new name instead of the old one', async () => {
      await contactsPage.open();
      await contactsPage.search(fullName(updated));
      await expect(contactsPage.rowFor(fullName(updated))).toBeVisible();
      await contactsPage.search(fullName(original));
      await expect(contactsPage.noMatches).toBeVisible();
    });
  });

  test("should open the contact's side panel from View details", async ({
    contactsPage,
    contactsApi,
    lifecyclesApi,
    cleanup,
  }) => {
    const contact = buildContact();
    const name = fullName(contact);
    const created = await test.step('create a contact (through the API)', () =>
      contactsApi.createRecord(toContactPayload(contact)));
    cleanup.add(`contact "${name}"`, () => contactsApi.deleteIfExists(created.id));
    const stage = (await lifecyclesApi.stagesWithCounts()).find((s) => s.id === created.lifecycleId)!;

    const panel = await test.step('find the contact and choose View details', async () => {
      await contactsPage.open();
      await contactsPage.search(name);
      return contactsPage.openDetails(name);
    });

    await test.step("the panel is titled with the contact's name and shows its stage", async () => {
      await expect(panel.root).toBeVisible();
      await expect(panel.stageButton).toContainText(stage.name);
      await expect(panel.tab('Overview')).toHaveAttribute('aria-selected', 'true');
    });
    await test.step("its Details tab holds this contact's fields", async () => {
      await panel.openTab('Details');
      await expect(panel.detailsField('Last name')).toHaveValue(contact.lastName);
      await expect(panel.detailsField('Email')).toHaveValue(contact.email);
    });
    await test.step('Close contact closes the panel', async () => {
      await panel.closeButton.click();
      await expect(panel.root).toBeHidden();
    });
  });

  test('should list a blocked contact under More → Blocked, and take it off when unblocked', async ({
    page,
    contactsPage,
    contactsApi,
    cleanup,
  }) => {
    const contact = buildContact();
    const name = fullName(contact);
    const created = await test.step('create a contact (through the API)', () =>
      contactsApi.createRecord(toContactPayload(contact)));
    cleanup.add(`contact "${name}"`, () => contactsApi.deleteIfExists(created.id));

    await test.step('find the contact, choose Block and confirm', async () => {
      await contactsPage.open();
      await contactsPage.search(name);
      await contactsPage.setBlocked(name, created.id, true);
    });
    await test.step('the server has it as blocked', async () => {
      expect((await (await contactsApi.get(created.id)).json()).data.blocked).toBe(true);
    });

    await test.step('open More → Blocked', () => contactsPage.openBlockedList());
    await test.step('the blocked list shows it', async () => {
      await expect(page).toHaveURL((url) => url.searchParams.get('blocked') === 'true');
      await expect(contactsPage.rowFor(name)).toBeVisible();
    });

    await test.step('choose Unblock and confirm', () => contactsPage.setBlocked(name, created.id, false));
    await test.step('the server has it unblocked, and the blocked list no longer shows it', async () => {
      expect((await (await contactsApi.get(created.id)).json()).data.blocked).toBe(false);
      await contactsPage.open(`?blocked=true&search=${encodeURIComponent(name)}`);
      await expect(contactsPage.noMatches).toBeVisible();
    });
  });

  test('should hide a blocked contact from the main contact list', async ({
    contactsPage,
    contactsApi,
    cleanup,
  }) => {
    knownBug('blocked-contacts-in-main-list');
    const contact = buildContact();
    const name = fullName(contact);
    const created = await test.step('create a contact and block it (through the API)', async () => {
      const record = await contactsApi.createRecord(toContactPayload(contact));
      expect((await contactsApi.update(record.id, { blocked: true })).ok()).toBe(true);
      return record;
    });
    cleanup.add(`contact "${name}"`, () => contactsApi.deleteIfExists(created.id));

    await test.step('open Contacts and search for it', async () => {
      await contactsPage.open();
      await contactsPage.search(name);
    });
    await test.step('it is not listed', async () => {
      await expect(contactsPage.noMatches).toBeVisible({ timeout: 5_000 });
    });
  });

  test('should save the opt-out when user opts a contact out of broadcasts, and undo it', async ({
    page,
    contactsPage,
    contactsApi,
    cleanup,
  }) => {
    const contact = buildContact();
    const name = fullName(contact);
    const created = await test.step('create a contact (through the API)', () =>
      contactsApi.createRecord(toContactPayload(contact)));
    cleanup.add(`contact "${name}"`, () => contactsApi.deleteIfExists(created.id));

    await test.step('find the contact and choose Opt out of broadcasts', async () => {
      await contactsPage.open();
      await contactsPage.search(name);
      const saved = waitForApiResponse(page, 'PATCH', `${ENDPOINTS.contacts}/${created.id}`);
      await contactsPage.chooseRowAction(name, 'Opt out of broadcasts');
      expect((await saved).ok(), 'the server should save the opt-out').toBe(true);
    });
    await test.step('the server stored when the contact opted out', async () => {
      expect((await (await contactsApi.get(created.id)).json()).data.optedOutAt).toEqual(expect.any(String));
    });

    await test.step('the row menu now offers Opt back in to broadcasts; choose it', async () => {
      const saved = waitForApiResponse(page, 'PATCH', `${ENDPOINTS.contacts}/${created.id}`);
      await contactsPage.chooseRowAction(name, 'Opt back in to broadcasts');
      expect((await saved).ok(), 'the server should save the opt-in').toBe(true);
    });
    await test.step('the server has the contact opted in again', async () => {
      expect((await (await contactsApi.get(created.id)).json()).data.optedOutAt).toBeNull();
    });
  });

  test("should copy the contact's id to the clipboard", async ({
    page,
    context,
    contactsPage,
    contactsApi,
    cleanup,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const contact = buildContact();
    const name = fullName(contact);
    const created = await test.step('create a contact (through the API)', () =>
      contactsApi.createRecord(toContactPayload(contact)));
    cleanup.add(`contact "${name}"`, () => contactsApi.deleteIfExists(created.id));

    await test.step('find the contact and choose Copy contact ID', async () => {
      await contactsPage.open();
      await contactsPage.search(name);
      await contactsPage.chooseRowAction(name, 'Copy contact ID');
    });
    await test.step('the app says "Contact ID copied" and the clipboard holds the id', async () => {
      await expect(page.getByRole('alert').filter({ hasText: 'Contact ID copied' })).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(created.id);
    });
  });

  test("should open the contact's conversation in the Inbox from Message", async ({
    page,
    contactsPage,
    contactsApi,
    workspaceId,
    cleanup,
  }) => {
    const contact = buildContact();
    const name = fullName(contact);
    const created = await test.step('create a contact (through the API)', () =>
      contactsApi.createRecord(toContactPayload(contact)));
    cleanup.add(`contact "${name}"`, () => contactsApi.deleteIfExists(created.id));

    await test.step('find the contact and choose Message', async () => {
      await contactsPage.open();
      await contactsPage.search(name);
      await contactsPage.chooseRowAction(name, 'Message');
    });
    await test.step("the Inbox opens on this contact's conversation", async () => {
      await expect(page).toHaveURL(`/inbox/${workspaceId}/${created.id}`);
    });
  });

  test('should show the bulk actions bar when user selects rows', async ({
    contactsPage,
    contactsApi,
    cleanup,
  }) => {
    const { tag, contacts } = buildContactBatch(2);
    const created = await test.step('create 2 contacts that share a search tag (through the API)', () =>
      Promise.all(contacts.map((contact) => contactsApi.createRecord(toContactPayload(contact)))));
    cleanup.add('2 contacts', async () => {
      for (const contact of created) await contactsApi.deleteIfExists(contact.id);
    });
    const bar = contactsPage.bulkActions;

    await test.step('open Contacts and search for the tag', async () => {
      await contactsPage.open();
      await contactsPage.search(tag);
      await expect(contactsPage.contactRows()).toHaveCount(2);
    });
    await test.step('no bar is shown while nothing is selected', async () => {
      await expect(bar).toBeHidden();
    });

    await test.step('select one row', () => contactsPage.selectRow(fullName(contacts[0])));
    await test.step('the bar says "1 selected" and offers the bulk actions', async () => {
      await expect(bar).toBeVisible();
      await expect(bar).toContainText('1 selected');
      for (const action of ['Transfer', 'Block', 'Unblock', 'Delete', 'Clear selection']) {
        await expect(bar.getByRole('button', { name: action, exact: true }).first()).toBeVisible();
      }
    });

    await test.step('select all', () => contactsPage.selectAll());
    await test.step('the bar says "2 selected"', async () => {
      await expect(bar).toContainText('2 selected');
    });

    await test.step('Clear selection hides the bar and unticks every row', async () => {
      await bar.getByRole('button', { name: 'Clear selection' }).click();
      await expect(bar).toBeHidden();
      for (const contact of contacts) {
        await expect(contactsPage.rowFor(fullName(contact)).getByRole('checkbox')).not.toBeChecked();
      }
    });
  });
});
