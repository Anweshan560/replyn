import { test, expect } from '../../fixtures/test';
import { fullName, toContactPayload } from '../../api/ContactsApi';
import { toClosingNotePayload } from '../../api/SettingsApis';
import { buildClosingNote, buildContact, buildContactNote, pickRandom } from '../../utils/testData';

/** The More actions menu of the side panel, in order. */
const MORE_ACTIONS = [
  'Message',
  'Log call',
  'Set follow-up',
  'Open in inbox',
  'Open profile',
  'Opt out of broadcasts',
  'Block contact',
];

test.describe('Contacts → side panel', { tag: ['@contacts'] }, () => {
  test('should move the contact to a new stage when user changes it in the panel', async ({
    contactsPage,
    contactsApi,
    lifecyclesApi,
    cleanup,
  }) => {
    const stages = await lifecyclesApi.openStages();
    const from = pickRandom(stages);
    const target = pickRandom(stages.filter((stage) => stage.id !== from.id));
    const contact = buildContact();
    const name = fullName(contact);
    const created = await test.step(`create a contact in "${from.name}" (through the API)`, () =>
      contactsApi.createRecord({ ...toContactPayload(contact), lifecycleId: from.id }));
    cleanup.add(`contact "${name}"`, () => contactsApi.deleteIfExists(created.id));

    const panel = await test.step('find the contact and open its details', async () => {
      await contactsPage.open();
      await contactsPage.search(name);
      return contactsPage.openDetails(name);
    });
    await test.step(`change its stage to "${target.name}"`, () => panel.changeStage(created.id, target.name));

    await test.step('the server stored the new stage', async () => {
      expect((await (await contactsApi.get(created.id)).json()).data.lifecycleId).toBe(target.id);
    });
    await test.step(`the list shows the contact in "${target.name}"`, async () => {
      await panel.closeButton.click();
      await contactsPage.open();
      await contactsPage.search(name);
      expect(await contactsPage.columnValues('Lifecycle')).toEqual([expect.stringContaining(target.name)]);
    });
    await test.step(`in card view the contact is under "${target.name}", and the counts match the server`, async () => {
      await contactsPage.clearSearch();
      await contactsPage.cardViewButton.click();
      await expect(contactsPage.cardColumn(target.name, name)).toBeVisible();
      // Other tests add and remove contacts meanwhile, so compare both until they agree.
      await expect(async () => {
        for (const stage of await lifecyclesApi.openStages()) {
          expect(await contactsPage.cardCount(stage.name), `count of "${stage.name}"`).toBe(
            await contactsApi.listedInStage(stage.id),
          );
        }
      }).toPass({ timeout: 30_000 });
    });
  });

  test('should save a note and show it on the contact', async ({ contactsPage, contactsApi, cleanup }) => {
    const contact = buildContact();
    const name = fullName(contact);
    const note = buildContactNote();
    const created = await test.step('create a contact (through the API)', () =>
      contactsApi.createRecord(toContactPayload(contact)));
    cleanup.add(`contact "${name}"`, () => contactsApi.deleteIfExists(created.id));

    const panel = await test.step('find the contact and open its details', async () => {
      await contactsPage.open();
      await contactsPage.search(name);
      return contactsPage.openDetails(name);
    });
    await test.step('write a note and save it', () => panel.addNote(created.id, note));

    await test.step('the note shows in the Notes section', async () => {
      await expect(panel.note(note)).toBeVisible();
      await expect(panel.noteInput).toHaveValue('');
    });
    await test.step("the server has the note in the contact's timeline", async () => {
      const { data } = await (await contactsApi.events(created.id)).json();
      const notes = data.result.filter((event: any) => event.activity?.type === 'note');
      expect(notes.map((event: any) => event.activity.payload.text)).toContain(note);
    });
    await test.step('after a reload, the note is still there', async () => {
      await contactsPage.open();
      await contactsPage.search(name);
      const reopened = await contactsPage.openDetails(name);
      await expect(reopened.note(note)).toBeVisible();
    });
  });

  test('should load every tab of the panel', async ({ contactsPage, contactsApi, cleanup }) => {
    const contact = buildContact();
    const name = fullName(contact);
    const created = await test.step('create a contact (through the API)', () =>
      contactsApi.createRecord(toContactPayload(contact)));
    cleanup.add(`contact "${name}"`, () => contactsApi.deleteIfExists(created.id));

    const panel = await test.step('find the contact and open its details', async () => {
      await contactsPage.open();
      await contactsPage.search(name);
      return contactsPage.openDetails(name);
    });
    const root = panel.root;

    // A new contact has no messages, bookings or bills, so each tab shows its empty state.
    await test.step('Overview shows Highlights and Notes', async () => {
      await panel.openTab('Overview');
      await expect(root.getByRole('region', { name: 'Highlights' })).toBeVisible();
      await expect(panel.notes).toBeVisible();
    });
    await test.step('Messages shows the empty conversation', async () => {
      await panel.openTab('Messages');
      await expect(root.getByText('No messages yet')).toBeVisible();
    });
    await test.step('Visits shows "No visits yet" and owes nothing', async () => {
      await panel.openTab('Visits');
      await expect(root.getByRole('heading', { name: 'No visits yet' })).toBeVisible();
      await expect(root.getByRole('button', { name: /^Owes Nothing/ })).toBeVisible();
    });
    await test.step('History lists the contact being created', async () => {
      await panel.openTab('History');
      await expect(root.getByRole('radiogroup', { name: 'Filter history' })).toBeVisible();
      await expect(root.getByText('Contact created by you')).toBeVisible();
    });
    await test.step("Details shows the contact's fields", async () => {
      await panel.openTab('Details');
      await expect(panel.detailsField('First name')).toHaveValue(contact.firstName);
      await expect(panel.detailsField('Address')).toHaveValue(contact.address);
    });
  });

  // Since 2026-11-25 Resolve opens the new lead wrap-up flow, part of Lead stages, which the user
  // asked to test later. Rewrite this test then.
  test.fixme('should close the conversation when user resolves it with a closing note', async ({
    contactsPage,
    contactsApi,
    closingNotesApi,
    cleanup,
  }) => {
    // The Resolve dialog's categories are the workspace's closing notes; bring one of our own.
    const closingNote = await test.step('create a closing note category (through the API)', () =>
      closingNotesApi.createRecord(toClosingNotePayload(buildClosingNote())));
    cleanup.add(`closing note "${closingNote.category}"`, () =>
      closingNotesApi.deleteIfExists(closingNote.id),
    );
    const contact = buildContact();
    const name = fullName(contact);
    const created = await test.step('create a contact (through the API)', () =>
      contactsApi.createRecord(toContactPayload(contact)));
    cleanup.add(`contact "${name}"`, () => contactsApi.deleteIfExists(created.id));

    const panel = await test.step('find the contact and open its details', async () => {
      await contactsPage.open();
      await contactsPage.search(name);
      return contactsPage.openDetails(name);
    });
    await test.step('Resolve with the closing note and a summary', () =>
      panel.resolve(created.id, closingNote.category, `Resolved by the test: ${closingNote.description}`));

    await test.step('the server has the conversation closed with that closing note', async () => {
      expect((await (await contactsApi.get(created.id)).json()).data).toMatchObject({
        status: 'closed',
        lastClosingNoteId: closingNote.id,
      });
    });
    await test.step('the panel no longer offers Resolve', async () => {
      await expect(panel.resolveButton).toBeHidden();
    });
  });

  test("should list the panel's More actions", async ({ contactsPage, contactsApi, cleanup }) => {
    const contact = buildContact();
    const name = fullName(contact);
    const created = await test.step('create a contact (through the API)', () =>
      contactsApi.createRecord(toContactPayload(contact)));
    cleanup.add(`contact "${name}"`, () => contactsApi.deleteIfExists(created.id));

    const panel = await test.step('find the contact and open its details', async () => {
      await contactsPage.open();
      await contactsPage.search(name);
      return contactsPage.openDetails(name);
    });

    await test.step('More actions offers every action, in order', async () => {
      expect(await panel.moreActionsItems()).toEqual(MORE_ACTIONS);
    });
  });
});
