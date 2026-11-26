import { test, expect } from '../../fixtures/test';
import type { Cleanup } from '../../fixtures/test';
import { toContactPayload, type Contact, type ContactsApi, type FilterRules } from '../../api/ContactsApi';
import type { InboxApi } from '../../api/InboxApi';
import { toTagPayload, type TagsApi } from '../../api/SettingsApis';
import { buildContactBatch, buildTag } from '../../utils/testData';
import { knownBug } from '../../utils/knownBug';

type Pair = { marker: string; tagged: Contact; other: Contact; tagId: string };

/**
 * Two new contacts whose last names share a unique marker. The first one has a new tag and a
 * follow-up due; the other has neither. Everything is deleted after the test.
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
    return { marker, tagged: created[0], other: created[1], tagId: tag.id };
  });
}

/** The marker rule: only the pair's two contacts have it in their last name. */
const markerRule = (marker: string) => ({ field: 'lastName', operator: 'contains', value: marker });

/**
 * POST /v1/contacts/search with the filter rules the Filter menu and Advanced rules build: one
 * field of each kind (text, choice, date, yes/no) and joining rules with "and" / "or".
 */
test.describe('Contacts filters API', { tag: ['@contacts'] }, () => {
  /** The ids the filter finds, sorted. */
  async function idsMatching(contactsApi: ContactsApi, rules: FilterRules): Promise<string[]> {
    const { result } = await contactsApi.searchRecords({ filter: { rules }, limit: 100 });
    return result.map((contact) => contact.id).sort();
  }

  test('should find contacts by text: contains and is equal to', async ({
    contactsApi,
    tagsApi,
    inboxApi,
    cleanup,
  }) => {
    const pair = await createPair({ contactsApi, tagsApi, inboxApi }, cleanup);

    await test.step('lastName contains the shared marker: both', async () => {
      expect(await idsMatching(contactsApi, [markerRule(pair.marker)])).toEqual(
        [pair.tagged.id, pair.other.id].sort(),
      );
    });
    await test.step("lastName contains the first one's whole last name: only that one", async () => {
      expect(
        await idsMatching(contactsApi, [
          { field: 'lastName', operator: 'contains', value: pair.tagged.lastName },
        ]),
      ).toEqual([pair.tagged.id]);
    });
    await test.step('lastName is equal to that last name: only that one', async () => {
      expect(
        await idsMatching(contactsApi, [
          { field: 'lastName', operator: 'isEqualTo', value: pair.tagged.lastName },
        ]),
      ).toEqual([pair.tagged.id]);
    });
    await test.step('lastName is equal to just the marker: nobody (it must be the whole name)', async () => {
      expect(
        await idsMatching(contactsApi, [{ field: 'lastName', operator: 'isEqualTo', value: pair.marker }]),
      ).toEqual([]);
    });
  });

  test('should find contacts with a tag (hasAnyOf)', async ({ contactsApi, tagsApi, inboxApi, cleanup }) => {
    const pair = await createPair({ contactsApi, tagsApi, inboxApi }, cleanup);

    const found = await test.step('filter by the new tag', () =>
      idsMatching(contactsApi, [{ field: 'tags', operator: 'hasAnyOf', value: [pair.tagId] }]));

    await test.step('only the tagged contact', () => expect(found).toEqual([pair.tagged.id]));
  });

  test('should find contacts with and without a follow-up (yes/no)', async ({
    contactsApi,
    tagsApi,
    inboxApi,
    cleanup,
  }) => {
    const pair = await createPair({ contactsApi, tagsApi, inboxApi }, cleanup);
    const withFollowUp = (value: boolean): FilterRules => [
      markerRule(pair.marker),
      { field: 'followUpRequired', operator: 'isEqualTo', value },
    ];

    await test.step('Has follow-up = yes: the first contact', async () => {
      expect(await idsMatching(contactsApi, withFollowUp(true))).toEqual([pair.tagged.id]);
    });
    await test.step('Has follow-up = no: the other one', async () => {
      expect(await idsMatching(contactsApi, withFollowUp(false))).toEqual([pair.other.id]);
    });
  });

  test('should find contacts created in the last hour, and only those (date)', async ({
    contactsApi,
    tagsApi,
    inboxApi,
    cleanup,
  }) => {
    const pair = await createPair({ contactsApi, tagsApi, inboxApi }, cleanup);
    const lastHour = { field: 'createdAt', operator: 'inTheLast', value: { amount: 1, unit: 'hours' } };

    const { result } = await test.step('filter by Created at in the last 1 hour', () =>
      contactsApi.searchRecords({ filter: { rules: [lastHour] }, limit: 100 }));

    await test.step('every contact found was created in the last hour, the new ones included', () => {
      const anHourAgo = Date.now() - 3_600_000 - 60_000; // a minute of slack for clock differences
      for (const contact of result) {
        const createdAt = (contact as Contact & { createdAt: string }).createdAt;
        expect(new Date(createdAt).getTime(), `${contact.id} created ${createdAt}`).toBeGreaterThan(
          anHourAgo,
        );
      }
      expect(result.map((contact) => contact.id)).toEqual(
        expect.arrayContaining([pair.tagged.id, pair.other.id]),
      );
    });
    await test.step('with the marker: exactly the two new contacts', async () => {
      expect(await idsMatching(contactsApi, [markerRule(pair.marker), lastHour])).toEqual(
        [pair.tagged.id, pair.other.id].sort(),
      );
    });
  });

  test('should join rules with "and" (all must match) or "or" (either may match)', async ({
    contactsApi,
    tagsApi,
    inboxApi,
    cleanup,
  }) => {
    const pair = await createPair({ contactsApi, tagsApi, inboxApi }, cleanup);
    const first = { field: 'lastName', operator: 'contains', value: pair.tagged.lastName };
    const second = { field: 'lastName', operator: 'contains', value: pair.other.lastName };

    await test.step('two rules side by side: both must match, so nobody', async () => {
      expect(await idsMatching(contactsApi, [first, second])).toEqual([]);
    });
    await test.step('joined by "and": nobody', async () => {
      expect(await idsMatching(contactsApi, [first, 'and', second])).toEqual([]);
    });
    await test.step('joined by "or": both contacts', async () => {
      expect(await idsMatching(contactsApi, [first, 'or', second])).toEqual(
        [pair.tagged.id, pair.other.id].sort(),
      );
    });
  });

  test('should combine the search box with a filter', async ({ contactsApi, tagsApi, inboxApi, cleanup }) => {
    const pair = await createPair({ contactsApi, tagsApi, inboxApi }, cleanup);

    const { result } = await test.step('search the marker and filter by Has follow-up = no', () =>
      contactsApi.searchRecords({
        search: pair.marker,
        filter: { rules: [{ field: 'followUpRequired', operator: 'isEqualTo', value: false }] },
      }));

    await test.step('only the contact without a follow-up', () => {
      expect(result.map((contact) => contact.id)).toEqual([pair.other.id]);
    });
  });

  test.describe('validation', () => {
    for (const { name, rules } of [
      { name: 'an unknown field', rules: [{ field: 'shoeSize', operator: 'contains', value: '42' }] },
      { name: 'an unknown operator', rules: [{ field: 'firstName', operator: 'soundsLike', value: 'Ann' }] },
      {
        name: 'an unknown time unit',
        rules: [{ field: 'createdAt', operator: 'inTheLast', value: { amount: 1, unit: 'fortnights' } }],
      },
      {
        name: 'a join word other than "and" or "or"',
        rules: [
          { field: 'firstName', operator: 'contains', value: 'a' },
          'xor',
          { field: 'lastName', operator: 'contains', value: 'b' },
        ],
      },
    ]) {
      test(`should reject ${name} with 422 "Invalid filter structure"`, async ({ contactsApi }) => {
        const response = await test.step('search with it', () =>
          contactsApi.search({ filter: { rules: rules as FilterRules } }));

        await test.step('responds 422 naming the filter rules', async () => {
          expect(response.status()).toBe(422);
          expect((await response.json()).message).toEqual({ 'filter.rules': 'Invalid filter structure' });
        });
      });
    }

    test('should reject a tag id that is not a UUID with 422', async ({ contactsApi }) => {
      knownBug('contact-filter-bad-tag-id-500');
      const response = await test.step('filter by the tag "not-a-uuid"', () =>
        contactsApi.search({
          filter: { rules: [{ field: 'tags', operator: 'hasAnyOf', value: ['not-a-uuid'] }] },
        }));

      await test.step('responds 422, not 500', () => expect(response.status()).toBe(422));
    });
  });
});
