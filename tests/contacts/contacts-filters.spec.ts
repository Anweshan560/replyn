import { test, expect } from '../../fixtures/test';
import type { Cleanup } from '../../fixtures/test';
import { toContactPayload, type Contact, type ContactsApi } from '../../api/ContactsApi';
import type { InboxApi } from '../../api/InboxApi';
import { toTagPayload, type TagsApi } from '../../api/SettingsApis';
import { buildContactBatch, buildTag } from '../../utils/testData';

/** The name the list shows: first and last name. */
const nameOf = (contact: Contact) => [contact.firstName, contact.lastName].filter(Boolean).join(' ');

type Pair = { marker: string; tagged: Contact; other: Contact; tag: { id: string; name: string } };

/**
 * Two new contacts whose last names share a unique marker; the first has a new tag and a
 * follow-up due, the other has neither. Everything is deleted after the test.
 */
async function createPair(
  apis: { contactsApi: ContactsApi; tagsApi: TagsApi; inboxApi: InboxApi },
  cleanup: Cleanup,
): Promise<Pair> {
  return test.step('create two contacts; tag the first and give it a follow-up (through the API)', async () => {
    const { tag: marker, contacts } = buildContactBatch(2);
    const tag = await apis.tagsApi.createRecord(toTagPayload(buildTag()));
    cleanup.add(`tag "${tag.name}"`, () => apis.tagsApi.deleteIfExists(tag.id));
    const created: Contact[] = [];
    for (const contact of contacts) {
      const record = await apis.contactsApi.createRecord(toContactPayload(contact));
      cleanup.add(`contact ${record.id}`, () => apis.contactsApi.deleteIfExists(record.id));
      created.push(record);
    }
    await apis.inboxApi.updateRecord(created[0].id, { tags: [tag.id] } as never);
    const followUp = await apis.inboxApi.setFollowUp(created[0].id, {
      reason: 'Call back about the visit',
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(followUp.ok(), 'the follow-up should be saved').toBe(true);
    return { marker, tagged: created[0], other: created[1], tag };
  });
}

/**
 * Contacts → Filter: one field of each kind (text, choice, date, yes/no), Advanced rules with
 * "and" / "or", and Clear filters. Each test makes its own two contacts and narrows the list to
 * them with the search box, so other contacts never get in the way.
 */
test.describe('Contacts → Filter', { tag: ['@contacts'] }, () => {
  test('should filter by a text field, show the count on Filter, and clear it', async ({
    contactsPage,
    contactsApi,
    tagsApi,
    inboxApi,
    cleanup,
  }) => {
    const pair = await createPair({ contactsApi, tagsApi, inboxApi }, cleanup);
    await contactsPage.open();

    await contactsPage.filterMenu.addTextFilter('Last name', pair.tagged.lastName!);

    await test.step('only the matching contact is listed', async () => {
      await expect(contactsPage.rowFor(nameOf(pair.tagged))).toBeVisible();
      await expect(contactsPage.contactRows()).toHaveCount(1);
    });
    await test.step('the button says "Filter 1" and the rule is in the address', async () => {
      await expect(contactsPage.filterMenu.activeFiltersButton).toHaveAccessibleName('Filter 1');
      expect(await contactsPage.filterMenu.rulesInAddress()).toEqual([
        { field: 'lastName', operator: 'contains', value: pair.tagged.lastName },
      ]);
    });
    await test.step('Clear filters brings back the full list and empties the address', async () => {
      await contactsPage.filterMenu.clearFilters();
      expect(await contactsPage.filterMenu.rulesInAddress()).toEqual([]);
      await expect(contactsPage.filterMenu.activeFiltersButton).toBeHidden();
      await expect(contactsPage.contactRows().first()).toBeVisible();
      expect(await contactsPage.contactRows().count()).toBeGreaterThan(1);
    });
  });

  test('should filter by a tag (a choice field)', async ({
    contactsPage,
    contactsApi,
    tagsApi,
    inboxApi,
    cleanup,
  }) => {
    const pair = await createPair({ contactsApi, tagsApi, inboxApi }, cleanup);
    await contactsPage.open();
    await contactsPage.search(pair.marker);
    await test.step('the search finds both new contacts', async () => {
      await expect(contactsPage.contactRows()).toHaveCount(2);
    });

    await contactsPage.filterMenu.addTagFilter(pair.tag.name, pair.tag.id);

    await test.step('only the tagged contact is left', async () => {
      await expect(contactsPage.rowFor(nameOf(pair.tagged))).toBeVisible();
      await expect(contactsPage.rowFor(nameOf(pair.other))).toHaveCount(0);
    });
  });

  test('should filter by a yes/no field: Follow-up is set', async ({
    contactsPage,
    contactsApi,
    tagsApi,
    inboxApi,
    cleanup,
  }) => {
    const pair = await createPair({ contactsApi, tagsApi, inboxApi }, cleanup);
    await contactsPage.open();
    await contactsPage.search(pair.marker);

    await contactsPage.filterMenu.addYesFilter('Follow-up', 'followUpRequired');

    await test.step('only the contact with a follow-up is left', async () => {
      await expect(contactsPage.rowFor(nameOf(pair.tagged))).toBeVisible();
      await expect(contactsPage.rowFor(nameOf(pair.other))).toHaveCount(0);
      expect(await contactsPage.filterMenu.rulesInAddress()).toEqual([
        { field: 'followUpRequired', operator: 'isEqualTo', value: true },
      ]);
    });
  });

  test('should filter by a date field: Created at in the last 1 hour', async ({
    contactsPage,
    contactsApi,
    tagsApi,
    inboxApi,
    cleanup,
  }) => {
    const pair = await createPair({ contactsApi, tagsApi, inboxApi }, cleanup);
    await contactsPage.open();
    await contactsPage.search(pair.marker);

    await contactsPage.filterMenu.addCreatedInTheLast(1, 'Hours');

    await test.step('both new contacts are still listed, and the rule is in the address', async () => {
      await expect(contactsPage.rowFor(nameOf(pair.tagged))).toBeVisible();
      await expect(contactsPage.rowFor(nameOf(pair.other))).toBeVisible();
      expect(await contactsPage.filterMenu.rulesInAddress()).toEqual([
        { field: 'createdAt', operator: 'inTheLast', value: { amount: 1, unit: 'hours' } },
      ]);
    });
  });

  test('should match either rule with "or" and both with "and" in Advanced rules', async ({
    contactsPage,
    contactsApi,
    tagsApi,
    inboxApi,
    cleanup,
  }) => {
    const pair = await createPair({ contactsApi, tagsApi, inboxApi }, cleanup);
    await contactsPage.open();
    const menu = contactsPage.filterMenu;
    await menu.openAdvanced();
    await test.step("add a rule for each contact's last name", async () => {
      await menu.addAdvancedTextRule('Last name', pair.tagged.lastName!);
      await menu.addAdvancedTextRule('Last name', pair.other.lastName!);
    });

    await test.step('joined by "and" (the default): 0 contacts match', async () => {
      await expect(menu.advancedMatchCount).toHaveText('0 contacts match');
    });
    await test.step('joined by "or": 2 contacts match', async () => {
      await menu.joinAdvancedRulesWith('or');
      await expect(menu.advancedMatchCount).toHaveText('2 contacts match');
    });
    await test.step('Apply lists both, with "or" between the rules in the address', async () => {
      await menu.applyAdvanced();
      await expect(contactsPage.rowFor(nameOf(pair.tagged))).toBeVisible();
      await expect(contactsPage.rowFor(nameOf(pair.other))).toBeVisible();
      await expect(contactsPage.contactRows()).toHaveCount(2);
      expect(await menu.rulesInAddress()).toEqual([
        { field: 'lastName', operator: 'contains', value: pair.tagged.lastName },
        'or',
        { field: 'lastName', operator: 'contains', value: pair.other.lastName },
      ]);
    });
  });

  test('should keep a filter from the address after a reload', async ({
    page,
    contactsPage,
    contactsApi,
    tagsApi,
    inboxApi,
    cleanup,
  }) => {
    const pair = await createPair({ contactsApi, tagsApi, inboxApi }, cleanup);
    const rules = [{ field: 'tags', operator: 'hasAnyOf', value: [pair.tag.id] }];

    await contactsPage.open(`?filter=${encodeURIComponent(JSON.stringify({ rules }))}`);

    await test.step('the list is filtered to the tagged contact, and Filter shows 1', async () => {
      await expect(contactsPage.rowFor(nameOf(pair.tagged))).toBeVisible();
      await expect(contactsPage.contactRows()).toHaveCount(1);
      await expect(contactsPage.filterMenu.activeFiltersButton).toHaveAccessibleName('Filter 1');
    });
    await test.step('after a reload it is still filtered', async () => {
      await page.reload();
      await expect(contactsPage.rowFor(nameOf(pair.tagged))).toBeVisible();
      await expect(contactsPage.contactRows()).toHaveCount(1);
    });
  });
});
