import { test, expect } from '../../fixtures/test';
import { firstNameContains, toContactPayload, type SegmentPayload } from '../../api/ContactsApi';
import { ENDPOINTS } from '../../api/ResourceApi';
import { env } from '../../config/env';
import { buildContact, buildSegmentName } from '../../utils/testData';
import { knownBug } from '../../utils/knownBug';

/** An id in the right format that no segment has. */
const MISSING_ID = '00000000-0000-7000-8000-000000000000';

/** A segment with a rule that matches nobody, so it stays out of the way of other tests. */
function buildSegment(): SegmentPayload {
  return { name: buildSegmentName(), filter: { rules: [firstNameContains(buildSegmentName())] } };
}

test.describe('Segments API', { tag: ['@contacts'] }, () => {
  test.describe('create, get, update and delete', () => {
    test('should create a segment and return every field that was sent', async ({
      segmentsApi,
      workspaceId,
      cleanup,
    }) => {
      const payload = buildSegment();

      const response = await test.step('POST a new segment', () => segmentsApi.create(payload));
      const body = await response.json();
      if (body.data?.id) cleanup.add(`segment ${payload.name}`, () => segmentsApi.deleteIfExists(body.data.id));

      await test.step('responds 201 with the segment, in this workspace', () => {
        expect(response.status()).toBe(201);
        expect(body.data).toMatchObject({ ...payload, id: expect.any(String), workspaceId });
      });
      await test.step('GET by id returns the same segment', async () => {
        const saved = await segmentsApi.get(body.data.id);
        expect(saved.status()).toBe(200);
        expect((await saved.json()).data).toMatchObject(payload);
      });
      await test.step('the list includes it', async () => {
        expect(await segmentsApi.findRecord(body.data.id)).toMatchObject(payload);
      });
    });

    test('should create a segment with only a name, as New segment does', async ({ segmentsApi, cleanup }) => {
      const name = buildSegmentName();

      const response = await test.step('POST a name and no filter', () => segmentsApi.create({ name }));
      const body = await response.json();
      if (body.data?.id) cleanup.add(`segment ${name}`, () => segmentsApi.deleteIfExists(body.data.id));

      await test.step('responds 201 with no filter', () => {
        expect(response.status()).toBe(201);
        expect(body.data).toMatchObject({ name, filter: null });
      });
    });

    test('should rename a segment and keep its filter', async ({ segmentsApi, cleanup }) => {
      const payload = buildSegment();
      const created = await test.step('create a segment', () => segmentsApi.createRecord(payload));
      cleanup.add(`segment ${payload.name}`, () => segmentsApi.deleteIfExists(created.id));
      const name = buildSegmentName();

      const response = await test.step('PUT a new name', () => segmentsApi.update(created.id, { name }));

      await test.step('responds 200, and the server stored the name with the same filter', async () => {
        expect(response.status()).toBe(200);
        expect((await (await segmentsApi.get(created.id)).json()).data).toMatchObject({
          name,
          filter: payload.filter,
        });
      });
    });

    test('should replace the filter of a segment', async ({ segmentsApi, cleanup }) => {
      const payload = buildSegment();
      const created = await test.step('create a segment', () => segmentsApi.createRecord(payload));
      cleanup.add(`segment ${payload.name}`, () => segmentsApi.deleteIfExists(created.id));
      const filter = buildSegment().filter;

      const response = await test.step('PUT a new filter', () => segmentsApi.update(created.id, { filter }));

      await test.step('responds 200, and the server stored the new filter', async () => {
        expect(response.status()).toBe(200);
        expect((await (await segmentsApi.get(created.id)).json()).data).toMatchObject({
          name: payload.name,
          filter,
        });
      });
    });

    test('should delete a segment so it can no longer be found', async ({ segmentsApi, cleanup }) => {
      const payload = buildSegment();
      const created = await test.step('create a segment', () => segmentsApi.createRecord(payload));
      cleanup.add(`segment ${payload.name}`, () => segmentsApi.deleteIfExists(created.id));

      const response = await test.step('DELETE it', () => segmentsApi.delete(created.id));

      await test.step('responds 200', () => expect(response.status()).toBe(200));
      await test.step('GET by id answers 404, and the list no longer has it', async () => {
        expect((await segmentsApi.get(created.id)).status()).toBe(404);
        expect(await segmentsApi.findRecord(created.id)).toBeUndefined();
      });
      await test.step('deleting it again answers 404', async () => {
        expect((await segmentsApi.delete(created.id)).status()).toBe(404);
      });
    });

    test("should find exactly the matching contacts with a segment's filter", async ({
      contactsApi,
      segmentsApi,
      cleanup,
    }) => {
      // The first name carries a unique number, so the rule matches this contact and nothing else.
      const contact = buildContact({ uniqueFirstName: true });
      const created = await test.step('create a contact', () =>
        contactsApi.createRecord(toContactPayload(contact)));
      cleanup.add(`contact ${created.id}`, () => contactsApi.deleteIfExists(created.id));
      const name = buildSegmentName();
      const segment = await test.step('create a segment for its first name', () =>
        segmentsApi.createRecord({ name, filter: { rules: [firstNameContains(contact.firstName)] } }));
      cleanup.add(`segment ${name}`, () => segmentsApi.deleteIfExists(segment.id));

      const found = await test.step("search contacts with the segment's stored filter", () =>
        contactsApi.searchRecords({ filter: segment.filter }));

      await test.step('the search returns just this contact', () => {
        expect(found.result.map((record) => record.id)).toEqual([created.id]);
      });
    });
  });

  test.describe('validation', () => {
    for (const [label, name] of [
      ['no name', undefined],
      ['an empty name', ''],
    ] as const) {
      test(`should reject a segment with ${label} with 422`, async ({ segmentsApi }) => {
        const response = await test.step('POST the segment', () =>
          segmentsApi.create({ ...buildSegment(), name }));

        await test.step('responds 422 with an error about the name', async () => {
          expect(response.status()).toBe(422);
          expect((await response.json()).message.name).toBe('name should not be empty');
        });
      });
    }

    test('should reject a name of only spaces with 422', async ({ segmentsApi, cleanup }) => {
      knownBug('segment-blank-name');

      const response = await test.step('POST a name of spaces', () =>
        segmentsApi.create({ ...buildSegment(), name: '   ' }));
      const body = await response.json();
      if (body.data?.id) cleanup.add('blank segment', () => segmentsApi.deleteIfExists(body.data.id));

      await test.step('responds 422', () => expect(response.status()).toBe(422));
    });

    test('should reject a filter that is not an object with 422', async ({ segmentsApi }) => {
      const response = await test.step('POST a text filter', () =>
        segmentsApi.create({ name: buildSegmentName(), filter: 'nope' as unknown as SegmentPayload['filter'] }));

      await test.step('responds 422 with an error about the filter', async () => {
        expect(response.status()).toBe(422);
        expect((await response.json()).message.filter).toBe('filter must be an object');
      });
    });

    for (const [label, rule] of [
      ['field', { field: 'nope', operator: 'contains', value: 'x' }],
      ['operator', { field: 'firstName', operator: 'nope', value: 'x' }],
    ] as const) {
      test(`should reject a rule with an unknown ${label} with 422`, async ({ segmentsApi, cleanup }) => {
        knownBug('segment-invalid-rule');

        const response = await test.step('POST the rule', () =>
          segmentsApi.create({ name: buildSegmentName(), filter: { rules: [rule] } }));
        const body = await response.json();
        if (body.data?.id) cleanup.add('invalid segment', () => segmentsApi.deleteIfExists(body.data.id));

        await test.step('responds 422', () => expect(response.status()).toBe(422));
      });
    }

    test('should refuse a second segment with the same name with 409', async ({ segmentsApi, cleanup }) => {
      const payload = buildSegment();
      const created = await test.step('create a segment', () => segmentsApi.createRecord(payload));
      cleanup.add(`segment ${payload.name}`, () => segmentsApi.deleteIfExists(created.id));

      const response = await test.step('POST the same name again', () => segmentsApi.create(payload));
      const body = await response.json();
      if (body.data?.id) cleanup.add('duplicate segment', () => segmentsApi.deleteIfExists(body.data.id));

      await test.step('responds 409 and says it already exists', () => {
        expect(response.status()).toBe(409);
        expect(body.message).toContain('Segment already exists');
      });
    });

    test('should answer 404 "Segment not found" for an id no segment has', async ({ segmentsApi }) => {
      for (const [method, send] of [
        ['GET', () => segmentsApi.get(MISSING_ID)],
        ['DELETE', () => segmentsApi.delete(MISSING_ID)],
      ] as const) {
        await test.step(`${method} responds 404`, async () => {
          const response = await send();
          expect(response.status()).toBe(404);
          expect((await response.json()).message).toBe('Segment not found');
        });
      }
    });

    test('should answer 400 for a malformed id', async ({ segmentsApi }) => {
      knownBug('segment-malformed-id-500');

      const response = await test.step('GET an id that is not a UUID', () => segmentsApi.get('not-a-uuid'));

      await test.step('responds 400', () => expect(response.status()).toBe(400));
    });

    test('should reject requests without a login token with 401', async ({ request, apiHeaders }) => {
      const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();

      await test.step('list without a token responds 401', async () => {
        const response = await request.get(`${env.apiUrl}${ENDPOINTS.segments}`, { headers: headersWithoutToken });
        expect(response.status()).toBe(401);
      });
      await test.step('create without a token responds 401', async () => {
        const response = await request.post(`${env.apiUrl}${ENDPOINTS.segments}`, {
          headers: headersWithoutToken,
          data: buildSegment(),
        });
        expect(response.status()).toBe(401);
      });
    });
  });
});
