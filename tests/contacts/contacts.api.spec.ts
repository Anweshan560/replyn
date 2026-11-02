import { test, expect } from '../../fixtures/test';
import { fullName, toContactPayload, type Contact } from '../../api/ContactsApi';
import { ENDPOINTS } from '../../api/ResourceApi';
import { env } from '../../config/env';
import { measureResponseTimes, median } from '../../utils/timing';
import { buildContact, buildContactBatch, pickRandom } from '../../utils/testData';
import { knownBug } from '../../utils/knownBug';

/** An id in the right format that no contact has. */
const MISSING_ID = '00000000-0000-7000-8000-000000000000';

test.describe('Contacts API', { tag: ['@contacts'] }, () => {
  test.describe('POST /v1/contacts/search', () => {
    test('should find a contact by name, email or phone', async ({ contactsApi, cleanup }) => {
      const contact = buildContact();
      const created = await test.step('create a contact', () =>
        contactsApi.createRecord(toContactPayload(contact)));
      cleanup.add(`contact ${created.id}`, () => contactsApi.deleteIfExists(created.id));

      for (const [field, text] of [
        ['full name', fullName(contact)],
        ['email', contact.email],
        ['phone', contact.phone],
      ] as const) {
        await test.step(`searching by ${field} responds 201 with exactly that contact`, async () => {
          const response = await contactsApi.search({ search: text });
          expect(response.status()).toBe(201);
          const { result, meta } = (await response.json()).data;
          expect(meta.count).toBe(1);
          expect(result.map((found: Contact) => found.id)).toEqual([created.id]);
        });
      }
    });

    test('should return only the contacts of a stage when filtered by lifecycle', async ({
      contactsApi,
      lifecyclesApi,
      cleanup,
    }) => {
      const stage = pickRandom(await lifecyclesApi.openStages());
      const created = await test.step(`create a contact in "${stage.name}"`, () =>
        contactsApi.createRecord({ ...toContactPayload(buildContact()), lifecycleId: stage.id }));
      cleanup.add(`contact ${created.id}`, () => contactsApi.deleteIfExists(created.id));

      // The same rule the list sends when a stage is clicked in the left panel.
      const { result } = await test.step('search with the lifecycle rule', () =>
        contactsApi.searchRecords({
          limit: 100,
          filter: { rules: [{ field: 'lifecycle', operator: 'isEqualTo', value: stage.id }] },
        }));

      await test.step('the new contact is in the results, and every result is in that stage', () => {
        expect(result.map((contact) => contact.id)).toContain(created.id);
        for (const contact of result) expect(contact.lifecycleId).toBe(stage.id);
      });
    });

    test('should split the results into pages', async ({ contactsApi, cleanup }) => {
      const { tag, contacts } = buildContactBatch(3);
      // One after another: contacts created at the same moment tie on the sort order, and on
      // 2026-10-30 one run returned the same contact on both pages (not seen again since).
      const created: Contact[] = [];
      await test.step('create 3 contacts that share a search tag, one after another', async () => {
        for (const contact of contacts)
          created.push(await contactsApi.createRecord(toContactPayload(contact)));
      });
      cleanup.add('3 contacts', async () => {
        for (const contact of created) await contactsApi.deleteIfExists(contact.id);
      });
      // Sorted the way the Contacts page sorts, so the pages follow a fixed order.
      const query = { search: tag, limit: 2, sortBy: 'lastBumpedAt', sortDirection: 'desc' } as const;

      const first = await test.step('page 1 with 2 per page', () =>
        contactsApi.searchRecords({ ...query, page: 1 }));
      await test.step('has 2 contacts, a total of 3, and points to page 2', () => {
        expect(first.result).toHaveLength(2);
        expect(first.meta).toMatchObject({ count: 3, currentPage: 1, nextPage: 2, previousPage: null });
      });

      const second = await test.step('page 2 with 2 per page', () =>
        contactsApi.searchRecords({ ...query, page: 2 }));
      await test.step('has the last contact and points back to page 1', () => {
        expect(second.result).toHaveLength(1);
        expect(second.meta).toMatchObject({ count: 3, currentPage: 2, nextPage: null, previousPage: 1 });
      });

      await test.step('the two pages together hold each contact exactly once', () => {
        const ids = [...first.result, ...second.result].map((contact) => contact.id);
        expect(ids.sort()).toEqual(created.map((contact) => contact.id).sort());
      });
    });

    test('should answer within the response-time budget', async ({ contactsApi }) => {
      const durations = await test.step('search 5 times in a row', () =>
        measureResponseTimes(() => contactsApi.search({ page: 1, limit: 25 }), 5));

      await test.step(`the median response time is under ${env.apiResponseBudgetMs} ms`, () => {
        expect(median(durations), `response times (ms): ${durations.join(', ')}`).toBeLessThan(
          env.apiResponseBudgetMs,
        );
      });
    });
  });

  test.describe('create, get, update and delete', () => {
    test('should create a contact and return every field that was sent', async ({
      contactsApi,
      lifecyclesApi,
      cleanup,
    }) => {
      const stage = pickRandom(await lifecyclesApi.openStages());
      const payload = {
        ...toContactPayload(buildContact()),
        lifecycleId: stage.id,
        origin: 'referral' as const,
        referredByName: buildContact().firstName,
      };

      const response = await test.step('POST a new contact', () => contactsApi.create(payload));
      const body = await response.json();
      if (body.data?.id)
        cleanup.add(`contact ${body.data.id}`, () => contactsApi.deleteIfExists(body.data.id));

      await test.step('responds 201 with every field and an id', () => {
        expect(response.status()).toBe(201);
        expect(body.data).toMatchObject(payload);
        expect(body.data.id).toEqual(expect.any(String));
      });
    });

    test('should update a contact', async ({ contactsApi, cleanup }) => {
      const created = await test.step('create a contact', () =>
        contactsApi.createRecord(toContactPayload(buildContact())));
      cleanup.add(`contact ${created.id}`, () => contactsApi.deleteIfExists(created.id));
      const updated = toContactPayload(buildContact());

      const response = await test.step('PATCH every field', () => contactsApi.update(created.id, updated));

      await test.step('responds 200, and GET returns the new values', async () => {
        expect(response.status()).toBe(200);
        expect((await (await contactsApi.get(created.id)).json()).data).toMatchObject(updated);
      });
    });

    test('should delete a contact so it can no longer be found', async ({ contactsApi, cleanup }) => {
      const contact = buildContact();
      const created = await test.step('create a contact', () =>
        contactsApi.createRecord(toContactPayload(contact)));
      cleanup.add(`contact ${created.id}`, () => contactsApi.deleteIfExists(created.id));

      const response = await test.step('DELETE it', () => contactsApi.delete(created.id));

      await test.step('responds 200', () => expect(response.status()).toBe(200));
      await test.step('GET by id now responds 404 "No such contact"', async () => {
        const getAfterDelete = await contactsApi.get(created.id);
        expect(getAfterDelete.status()).toBe(404);
        expect((await getAfterDelete.json()).message).toBe('No such contact');
      });
      await test.step('searching for it finds nothing', async () => {
        expect((await contactsApi.searchRecords({ search: fullName(contact) })).meta.count).toBe(0);
      });
    });

    test('should reject an invalid email with 422', async ({ contactsApi, cleanup }) => {
      const payload = { ...toContactPayload(buildContact()), email: 'not-an-email' };

      const response = await test.step('POST a contact with an invalid email', () =>
        contactsApi.create(payload));
      const body = await response.json();
      // Only if the server wrongly accepts it: don't leave it behind.
      if (body.data?.id)
        cleanup.add(`contact ${body.data.id}`, () => contactsApi.deleteIfExists(body.data.id));

      await test.step('responds 422 "email must be an email"', () => {
        expect(response.status()).toBe(422);
        expect(body.message).toEqual({ email: 'email must be an email' });
      });
    });

    test('should reject an invalid email on update with 422 and keep the old one', async ({
      contactsApi,
      cleanup,
    }) => {
      const contact = buildContact();
      const created = await test.step('create a contact', () =>
        contactsApi.createRecord(toContactPayload(contact)));
      cleanup.add(`contact ${created.id}`, () => contactsApi.deleteIfExists(created.id));

      const response = await test.step('PATCH an invalid email', () =>
        contactsApi.update(created.id, { email: 'not-an-email' }));

      await test.step('responds 422, and the stored email is unchanged', async () => {
        expect(response.status()).toBe(422);
        expect((await response.json()).message).toEqual({ email: 'email must be an email' });
        expect((await (await contactsApi.get(created.id)).json()).data.email).toBe(contact.email);
      });
    });

    test('should reject an invalid phone number', async ({ contactsApi, cleanup }) => {
      const payload = { ...toContactPayload(buildContact()), phone: '123' };

      const response = await test.step('POST a contact with the phone "123"', () =>
        contactsApi.create(payload));
      const body = await response.json();
      if (body.data?.id)
        cleanup.add(`contact ${body.data.id}`, () => contactsApi.deleteIfExists(body.data.id));

      // Unlike the email, a bad phone answers 400, not 422, with a plain-text message.
      await test.step('responds 400 "Please provide a valid phone number"', () => {
        expect(response.status()).toBe(400);
        expect(body.message).toBe('Please provide a valid phone number');
      });
    });

    test('should reject a contact without a first name with 422', async ({ contactsApi, cleanup }) => {
      knownBug('contact-without-first-name');
      const { firstName: _omitted, ...payloadWithoutFirstName } = toContactPayload(buildContact());

      const response = await test.step('POST a contact with no first name', () =>
        contactsApi.create(payloadWithoutFirstName));
      const body = await response.json();
      if (body.data?.id)
        cleanup.add(`contact ${body.data.id}`, () => contactsApi.deleteIfExists(body.data.id));

      await test.step('responds 422 with an error about the first name', () => {
        expect(response.status()).toBe(422);
        expect(body.message).toHaveProperty('firstName');
      });
    });

    test('should reject requests without a login token with 401', async ({ request, apiHeaders }) => {
      const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();

      await test.step('search without a token responds 401', async () => {
        const response = await request.post(`${env.apiUrl}${ENDPOINTS.contacts}/search`, {
          headers: headersWithoutToken,
          data: {},
        });
        expect(response.status()).toBe(401);
      });
      await test.step('create without a token responds 401', async () => {
        const response = await request.post(`${env.apiUrl}${ENDPOINTS.contacts}`, {
          headers: headersWithoutToken,
          data: toContactPayload(buildContact()),
        });
        expect(response.status()).toBe(401);
      });
    });
  });

  test.describe('one contact: get, events and origin', () => {
    test('should return a contact by its id', async ({ contactsApi, cleanup }) => {
      const payload = toContactPayload(buildContact());
      const created = await test.step('create a contact', () => contactsApi.createRecord(payload));
      cleanup.add(`contact ${created.id}`, () => contactsApi.deleteIfExists(created.id));

      const response = await test.step('GET it by id', () => contactsApi.get(created.id));

      await test.step('responds 200 with the same contact', async () => {
        expect(response.status()).toBe(200);
        expect((await response.json()).data).toMatchObject({ id: created.id, ...payload });
      });
    });

    test('should answer 404 "No such contact" for an unknown id, and 400 for a malformed one', async ({
      contactsApi,
    }) => {
      await test.step('an id no contact has: 404', async () => {
        const response = await contactsApi.get(MISSING_ID);
        expect(response.status()).toBe(404);
        expect((await response.json()).message).toBe('No such contact');
      });
      await test.step('an id that is not a UUID: 400', async () => {
        const response = await contactsApi.get('not-a-uuid');
        expect(response.status()).toBe(400);
        expect((await response.json()).message).toBe('Validation failed (uuid is expected)');
      });
    });

    test("should return the contact's timeline", async ({ contactsApi, lifecyclesApi, cleanup }) => {
      const stage = pickRandom(await lifecyclesApi.openStages());
      const created = await test.step(`create a contact in "${stage.name}"`, () =>
        contactsApi.createRecord({ ...toContactPayload(buildContact()), lifecycleId: stage.id }));
      cleanup.add(`contact ${created.id}`, () => contactsApi.deleteIfExists(created.id));

      const response = await test.step('GET its events', () => contactsApi.events(created.id));

      await test.step('responds 200 with the contact being created and given its stage', async () => {
        expect(response.status()).toBe(200);
        const events: { contactId: string; activity?: { type: string; payload: any } }[] = (
          await response.json()
        ).data.result;
        for (const event of events) expect(event.contactId).toBe(created.id);
        const types = events.map((event) => event.activity?.type);
        expect(types).toContain('created');
        const stageChange = events.find((event) => event.activity?.type === 'lifecycle_change');
        expect(stageChange?.activity?.payload).toEqual({ lifecycleId: stage.id });
      });
    });

    test('should return where a referred contact came from', async ({ contactsApi, cleanup }) => {
      const referredBy = buildContact().firstName;
      const created = await test.step('create a referred contact', () =>
        contactsApi.createRecord({
          ...toContactPayload(buildContact()),
          origin: 'referral',
          referredByName: referredBy,
        }));
      cleanup.add(`contact ${created.id}`, () => contactsApi.deleteIfExists(created.id));

      const response = await test.step('GET its origin', () => contactsApi.origin(created.id));

      await test.step('responds 200: a referral, with who referred them, added by a user', async () => {
        expect(response.status()).toBe(200);
        expect((await response.json()).data).toMatchObject({
          origin: 'referral',
          sourceDetail: referredBy,
          createdBy: 'user',
        });
      });
    });
  });

  test('GET /v1/contacts/segment-counts should answer 200', async ({ request, apiHeaders }) => {
    knownBug('segment-counts-always-400');

    const response = await test.step('GET segment-counts as the page does', async () =>
      request.get(`${env.apiUrl}${ENDPOINTS.contacts}/segment-counts`, { headers: await apiHeaders() }));

    await test.step('responds 200', () => expect(response.status()).toBe(200));
  });
});
