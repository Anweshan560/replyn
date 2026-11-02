import { test, expect } from '../../fixtures/test';
import { firstNameContains, fullName, toContactPayload, type Contact } from '../../api/ContactsApi';
import { toTreatmentPayload } from '../../api/TreatmentsApi';
import {
  buildContact,
  buildContactBatch,
  buildSegmentName,
  buildTreatment,
  pickRandom,
} from '../../utils/testData';
import { knownBug } from '../../utils/knownBug';

/** The columns a new session shows, in order. */
const DEFAULT_COLUMNS = [
  'Name',
  'Phone',
  'Lifecycle',
  'Treatments',
  'Last visit',
  'Next visit',
  'Paid to date',
  'Assignee',
  'Last Activity',
];

/** The "N contacts" total under the list. */
const TOTAL = /^(\d+) contacts?$/;

// Every test creates its own contacts (the workspace has almost none) and deletes them afterwards.
// Lists are narrowed with a search for the test's own contacts, as other tests run in parallel.
test.describe('Contacts list', { tag: ['@contacts'] }, () => {
  test(
    'should open Contacts from the sidebar with the list and its columns',
    { tag: '@smoke' },
    async ({ page, contactsPage }) => {
      await test.step('go to Contacts from the main sidebar', () => contactsPage.openFromSidebar());

      await test.step('the address is /contacts and the table is shown', async () => {
        await expect(page).toHaveURL(/\/contacts(\?|$)/);
        await expect(contactsPage.table).toBeVisible();
      });
      await test.step('the table has the default columns, in order', async () => {
        const headers = (await contactsPage.table.getByRole('columnheader').allInnerTexts())
          .map((header) => header.trim())
          // The first header holds only the "Select all" checkbox, the last one the row menus.
          .filter(Boolean);
        expect(headers).toEqual(DEFAULT_COLUMNS);
      });
    },
  );

  test('should find a contact by name, put the search in the address, and clear it', async ({
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

    await test.step('open Contacts', () => contactsPage.open());
    await test.step('search for the contact by name', () => contactsPage.search(name));

    await test.step('only that contact is listed', async () => {
      await expect(contactsPage.rowFor(name)).toBeVisible();
      await expect(contactsPage.contactRows()).toHaveCount(1);
    });
    await test.step('the address has ?search= with the name', async () => {
      await expect(page).toHaveURL((url) => url.searchParams.get('search') === name);
    });

    await test.step('clear the search', () => contactsPage.clearSearch());

    await test.step('the search box is empty, the address has no search, and other contacts are back', async () => {
      await expect(contactsPage.searchBox).toHaveValue('');
      await expect(page).toHaveURL((url) => !url.searchParams.has('search'));
      await expect(contactsPage.contactRows().nth(1)).toBeVisible();
    });
  });

  test('should show only the contacts of a stage when user clicks it, and everyone again after', async ({
    page,
    contactsPage,
    contactsApi,
    lifecyclesApi,
    cleanup,
  }) => {
    // Any stage but the default one, so the contact's stage is one the test chose on purpose.
    const stage = pickRandom((await lifecyclesApi.openStages()).filter((s) => !s.isDefault));
    const contact = buildContact();
    const name = fullName(contact);
    const created = await test.step(`create a contact in "${stage.name}" (through the API)`, () =>
      contactsApi.createRecord({ ...toContactPayload(contact), lifecycleId: stage.id }));
    cleanup.add(`contact "${name}"`, () => contactsApi.deleteIfExists(created.id));

    await test.step('open Contacts', () => contactsPage.open());
    await test.step(`click "${stage.name}" in the left panel`, () =>
      contactsPage.openSidebarLink(stage.name));

    await test.step('the address has the stage, and the contact is listed', async () => {
      await expect(page).toHaveURL((url) => url.searchParams.get('lifecycle') === stage.id);
      await expect(contactsPage.rowFor(name)).toBeVisible();
    });
    const stageTotal = await test.step(`every listed contact is in "${stage.name}"`, async () => {
      for (const lifecycle of await contactsPage.columnValues('Lifecycle')) {
        expect(lifecycle).toContain(stage.name);
      }
      return Number((await page.getByText(TOTAL).innerText()).match(TOTAL)![1]);
    });

    await test.step('click Everyone', () => contactsPage.openSidebarLink('Everyone'));

    await test.step('the address has no stage and the list holds more than that stage', async () => {
      await expect(page).toHaveURL((url) => !url.searchParams.has('lifecycle'));
      // The workspace's own "contaact1" is a New Lead, so Everyone always has more.
      const everyoneTotal = Number((await page.getByText(TOTAL).innerText()).match(TOTAL)![1]);
      expect(everyoneTotal).toBeGreaterThan(stageTotal);
    });
  });

  test('should show only the contacts of a segment when user clicks it', async ({
    page,
    contactsPage,
    contactsApi,
    segmentsApi,
    cleanup,
  }) => {
    const match = buildContact({ uniqueFirstName: true });
    const other = buildContact();
    const [matching, notMatching] = await test.step('create two contacts (through the API)', () =>
      Promise.all([match, other].map((contact) => contactsApi.createRecord(toContactPayload(contact)))));
    cleanup.add('contacts', async () => {
      await contactsApi.deleteIfExists(matching.id);
      await contactsApi.deleteIfExists(notMatching.id);
    });
    const segment = await test.step('create a segment matching only the first one (through the API)', () =>
      segmentsApi.createRecord({
        name: buildSegmentName(),
        filter: { rules: [firstNameContains(match.firstName)] },
      }));
    cleanup.add(`segment "${segment.name}"`, () => segmentsApi.deleteIfExists(segment.id));

    await test.step('open Contacts', () => contactsPage.open());
    await test.step(`click the segment "${segment.name}"`, () => contactsPage.openSidebarLink(segment.name));

    await test.step('the address has the segment, and only the matching contact is listed', async () => {
      await expect(page).toHaveURL((url) => url.searchParams.get('segment') === segment.id);
      await expect(contactsPage.rowFor(fullName(match))).toBeVisible();
      await expect(contactsPage.contactRows()).toHaveCount(1);
    });
  });

  test('should show only the contacts with a treatment when user clicks it', async ({
    page,
    contactsPage,
    contactsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const treatment = await test.step('create a treatment (through the API)', () =>
      treatmentsApi.createRecord(toTreatmentPayload(buildTreatment())));
    cleanup.add(`treatment "${treatment.name}"`, () => treatmentsApi.deleteIfExists(treatment.id));
    const contact = buildContact();
    const created = await test.step('create a contact with that treatment (through the API)', () =>
      contactsApi.createRecord({ ...toContactPayload(contact), treatmentIds: [treatment.id] }));
    cleanup.add(`contact "${fullName(contact)}"`, () => contactsApi.deleteIfExists(created.id));

    await test.step('open Contacts', () => contactsPage.open());
    await test.step(`click the treatment "${treatment.name}"`, () =>
      contactsPage.openSidebarLink(treatment.name));

    await test.step('the address has the treatment, and only that contact is listed with it', async () => {
      await expect(page).toHaveURL((url) => url.searchParams.get('treatments') === treatment.id);
      await expect(contactsPage.rowFor(fullName(contact))).toBeVisible();
      await expect(contactsPage.contactRows()).toHaveCount(1);
      expect(await contactsPage.columnValues('Treatments')).toEqual([treatment.name]);
    });
  });

  test('should split the list into pages of the chosen size', async ({
    page,
    contactsPage,
    contactsApi,
    cleanup,
  }) => {
    // 11 contacts with 10 per page: a full first page and one contact on the second.
    const { tag, contacts } = buildContactBatch(11);
    const created = await test.step('create 11 contacts that share a search tag (through the API)', () =>
      Promise.all(contacts.map((contact) => contactsApi.createRecord(toContactPayload(contact)))));
    cleanup.add('11 contacts', async () => {
      for (const contact of created) await contactsApi.deleteIfExists(contact.id);
    });

    await test.step('open Contacts and search for the tag', async () => {
      await contactsPage.open();
      await contactsPage.search(tag);
    });
    await test.step('all 11 fit on one page of 25', async () => {
      await expect(contactsPage.contactRows()).toHaveCount(11);
      await expect(page.getByText(TOTAL)).toHaveText('11 contacts');
    });

    await test.step('choose 10 per page', () => contactsPage.setPageSize(10));
    const firstPage = await test.step('page 1 shows 10, and the address has limit=10', async () => {
      await expect(contactsPage.contactRows()).toHaveCount(10);
      await expect(page).toHaveURL((url) => url.searchParams.get('limit') === '10');
      await expect(contactsPage.perPageButton).toHaveText('10');
      return contactsPage.contactNames();
    });

    await test.step('go to page 2', () => contactsPage.goToPage(2));
    await test.step('page 2 shows the one remaining contact', async () => {
      await expect(contactsPage.contactRows()).toHaveCount(1);
      await expect(page).toHaveURL((url) => url.searchParams.get('page') === '2');
      const [secondPageName] = await contactsPage.contactNames();
      expect(firstPage).not.toContain(secondPageName);
    });
  });

  test('should sort by Last Activity in both directions', async ({ contactsPage, contactsApi, cleanup }) => {
    const { tag, contacts } = buildContactBatch(3);
    // One after another, so each has a later activity time than the one before.
    const created: Contact[] = [];
    await test.step('create 3 contacts, one after another (through the API)', async () => {
      for (const contact of contacts) created.push(await contactsApi.createRecord(toContactPayload(contact)));
    });
    cleanup.add('3 contacts', async () => {
      for (const contact of created) await contactsApi.deleteIfExists(contact.id);
    });
    const newestFirst = contacts.map(fullName).reverse();

    await test.step('open Contacts and search for the tag', async () => {
      await contactsPage.open();
      await contactsPage.search(tag);
    });
    await test.step('by default the most recent activity comes first', async () => {
      await expect.poll(() => contactsPage.contactNames()).toEqual(newestFirst);
    });

    await test.step('click Last Activity', () => contactsPage.sortBy('Last Activity', 'asc'));
    await test.step('the oldest activity comes first', async () => {
      await expect(contactsPage.sortHeader()).toHaveAttribute('aria-sort', 'ascending');
      await expect.poll(() => contactsPage.contactNames()).toEqual([...newestFirst].reverse());
    });

    await test.step('click Last Activity again', () => contactsPage.sortBy('Last Activity', 'desc'));
    await test.step('the most recent activity comes first again', async () => {
      await expect(contactsPage.sortHeader()).toHaveAttribute('aria-sort', 'descending');
      await expect.poll(() => contactsPage.contactNames()).toEqual(newestFirst);
    });
  });

  test('should show and hide a column when user turns it on and off', async ({
    contactsPage,
    contactsApi,
    cleanup,
  }) => {
    const contact = buildContact();
    const created = await test.step('create a contact with an email (through the API)', () =>
      contactsApi.createRecord(toContactPayload(contact)));
    cleanup.add(`contact "${fullName(contact)}"`, () => contactsApi.deleteIfExists(created.id));

    await test.step('open Contacts and search for the contact', async () => {
      await contactsPage.open();
      await contactsPage.search(fullName(contact));
    });
    await test.step('the Email column is off by default', async () => {
      await expect(contactsPage.columnHeader('Email')).toHaveCount(0);
    });

    await test.step('turn Email on in Columns', () => contactsPage.toggleColumn('Email'));
    await test.step("the Email column appears with the contact's email", async () => {
      await expect(contactsPage.columnHeader('Email')).toBeVisible();
      expect(await contactsPage.columnValues('Email')).toEqual([contact.email]);
    });

    await test.step('turn Email off again', () => contactsPage.toggleColumn('Email'));
    await test.step('the Email column is gone', async () => {
      await expect(contactsPage.columnHeader('Email')).toHaveCount(0);
    });
  });

  test('should keep the column choice after a reload', async ({ page, contactsPage }) => {
    knownBug('contacts-column-choice-not-saved');

    await test.step('open Contacts and turn Email on', async () => {
      await contactsPage.open();
      await contactsPage.toggleColumn('Email');
      await expect(contactsPage.columnHeader('Email')).toBeVisible();
    });
    await test.step('reload the page', () => contactsPage.open(new URL(page.url()).search));
    await test.step('the Email column is still on', async () => {
      await expect(contactsPage.columnHeader('Email')).toBeVisible({ timeout: 5_000 });
    });
  });

  test('should show a column per stage with the right counts in card view', async ({
    page,
    contactsPage,
    contactsApi,
    lifecyclesApi,
    cleanup,
  }) => {
    const stages = await lifecyclesApi.openStages();
    const stage = pickRandom(stages);
    const contact = buildContact();
    const name = fullName(contact);
    const created = await test.step(`create a contact in "${stage.name}" (through the API)`, () =>
      contactsApi.createRecord({ ...toContactPayload(contact), lifecycleId: stage.id }));
    cleanup.add(`contact "${name}"`, () => contactsApi.deleteIfExists(created.id));

    await test.step('open Contacts and switch to card view', async () => {
      await contactsPage.open();
      await contactsPage.cardViewButton.click();
    });

    await test.step('the address has view=card and there is a column for every open stage', async () => {
      await expect(page).toHaveURL((url) => url.searchParams.get('view') === 'card');
      await expect(contactsPage.cardViewButton).toHaveAttribute('aria-checked', 'true');
      for (const { name: stageName } of stages)
        await expect(contactsPage.stageHeading(stageName)).toBeVisible();
    });
    await test.step(`the new contact's card is in the "${stage.name}" column`, async () => {
      await expect(contactsPage.cardColumn(stage.name, name)).toBeVisible();
    });
    await test.step("every column's count matches the server's count for that stage", async () => {
      // Other tests add and remove contacts meanwhile, so compare both until they agree.
      await expect(async () => {
        const fromServer = await lifecyclesApi.openStages();
        for (const { name: stageName, contactCount } of fromServer) {
          expect(await contactsPage.cardCount(stageName), `count of "${stageName}"`).toBe(contactCount);
        }
      }).toPass({ timeout: 30_000 });
    });

    await test.step('switch back to list view: the table returns', async () => {
      await contactsPage.listViewButton.click();
      await expect(contactsPage.table).toBeVisible();
      await expect(page).toHaveURL((url) => url.searchParams.get('view') !== 'card');
    });
  });
});
