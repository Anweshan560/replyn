import { test, expect } from '../../../fixtures/test';
import { toContactFieldPayload } from '../../../api/ContactFieldsApi';
import { env } from '../../../config/env';
import { CONTACT_FIELD_TYPES, buildContactField, type ContactFieldTypeName } from '../../../utils/testData';
import { knownBug } from '../../../utils/knownBug';

// Every test archives and then permanently deletes what it creates, so no field is left behind.
test.describe('Contact Fields API', { tag: ['@settings', '@contact-fields'] }, () => {
  for (const type of Object.keys(CONTACT_FIELD_TYPES) as ContactFieldTypeName[]) {
    test(`should create a ${type.toLowerCase()} field and return every field that was sent`, async ({
      contactFieldsApi,
      cleanup,
    }) => {
      const payload = toContactFieldPayload(buildContactField(type));

      const response = await test.step(`POST a new ${type} field`, () => contactFieldsApi.create(payload));
      const body = await response.json();
      if (body.data?.id)
        cleanup.add(`contact field ${payload.key}`, () => contactFieldsApi.deleteIfExists(body.data.id));

      await test.step('responds 201 with every field, an id, and not archived', () => {
        expect(response.status()).toBe(201);
        expect(body.data).toMatchObject({ ...payload, id: expect.any(String), deletedAt: null });
      });
      await test.step('the list contains it with the same fields', async () => {
        expect(await contactFieldsApi.findRecord(body.data.id)).toMatchObject(payload);
      });
    });
  }

  test('should update the label, options, placeholder and visibility', async ({
    contactFieldsApi,
    cleanup,
  }) => {
    const original = buildContactField('Choice');
    const created = await test.step('create a Choice field', () =>
      contactFieldsApi.createRecord(toContactFieldPayload(original)));
    cleanup.add(`contact field ${original.key}`, () => contactFieldsApi.deleteIfExists(created.id));
    const { label, values, placeholder, isVisible } = toContactFieldPayload(
      buildContactField('Choice', original),
    );

    const response = await test.step('PATCH the label, options, placeholder and visibility', () =>
      contactFieldsApi.update(created.id, { label, values, placeholder, isVisible }));

    await test.step('responds 200, and the list shows the new values', async () => {
      expect(response.status()).toBe(200);
      expect(await contactFieldsApi.findRecord(created.id)).toMatchObject({
        label,
        values,
        placeholder,
        isVisible,
      });
    });
  });

  test('should archive a field so it moves to the archived list', async ({ contactFieldsApi, cleanup }) => {
    const created = await test.step('create a field', () =>
      contactFieldsApi.createRecord(toContactFieldPayload(buildContactField())));
    cleanup.add(`contact field ${created.key}`, () => contactFieldsApi.deleteIfExists(created.id));

    const response = await test.step('DELETE (archive) it', () => contactFieldsApi.archive(created.id));

    await test.step('responds 200', () => expect(response.status()).toBe(200));
    await test.step('it left the active list and is archived, with the time it was archived', async () => {
      expect(await contactFieldsApi.findRecord(created.id)).toBeUndefined();
      const archived = (await contactFieldsApi.listArchivedRecords()).find(
        (field) => field.id === created.id,
      );
      expect(archived).toMatchObject({ key: created.key, deletedAt: expect.any(String) });
    });
  });

  test('should restore an archived field', async ({ contactFieldsApi, cleanup }) => {
    const created = await test.step('create a field and archive it', async () => {
      const record = await contactFieldsApi.createRecord(toContactFieldPayload(buildContactField()));
      expect((await contactFieldsApi.archive(record.id)).ok()).toBe(true);
      return record;
    });
    cleanup.add(`contact field ${created.key}`, () => contactFieldsApi.deleteIfExists(created.id));

    const response = await test.step('POST restore', () => contactFieldsApi.restore(created.id));

    await test.step('responds 201 with the field no longer archived', async () => {
      expect(response.status()).toBe(201);
      expect((await response.json()).data).toMatchObject({ id: created.id, deletedAt: null });
    });
    await test.step('it is back in the active list and not in the archived one', async () => {
      expect(await contactFieldsApi.findRecord(created.id)).toBeDefined();
      expect((await contactFieldsApi.listArchivedRecords()).map((field) => field.id)).not.toContain(
        created.id,
      );
    });
  });

  test('should refuse to permanently delete a field that is not archived', async ({
    contactFieldsApi,
    cleanup,
  }) => {
    const created = await test.step('create a field', () =>
      contactFieldsApi.createRecord(toContactFieldPayload(buildContactField())));
    cleanup.add(`contact field ${created.key}`, () => contactFieldsApi.deleteIfExists(created.id));

    const response = await test.step('DELETE it permanently without archiving it first', () =>
      contactFieldsApi.deletePermanently(created.id));

    await test.step('responds 400 asking to archive it first, and the field is still there', async () => {
      expect(response.status()).toBe(400);
      expect((await response.json()).message).toBe(
        'Archive the contact field before deleting it permanently',
      );
      expect(await contactFieldsApi.findRecord(created.id)).toBeDefined();
    });
  });

  test('should permanently delete an archived field', async ({ contactFieldsApi, cleanup }) => {
    const created = await test.step('create a field and archive it', async () => {
      const record = await contactFieldsApi.createRecord(toContactFieldPayload(buildContactField()));
      expect((await contactFieldsApi.archive(record.id)).ok()).toBe(true);
      return record;
    });
    cleanup.add(`contact field ${created.key}`, () => contactFieldsApi.deleteIfExists(created.id));

    const response = await test.step('DELETE it permanently', () =>
      contactFieldsApi.deletePermanently(created.id));

    await test.step('responds 200, and it is in neither list', async () => {
      expect(response.status()).toBe(200);
      expect(await contactFieldsApi.findRecord(created.id)).toBeUndefined();
      expect((await contactFieldsApi.listArchivedRecords()).map((field) => field.id)).not.toContain(
        created.id,
      );
    });
  });

  test('should reject a second field with the same key with 409', async ({ contactFieldsApi, cleanup }) => {
    const payload = toContactFieldPayload(buildContactField());
    const first = await test.step('create a field', () => contactFieldsApi.createRecord(payload));
    cleanup.add(`contact field ${payload.key}`, () => contactFieldsApi.deleteIfExists(first.id));

    const response = await test.step('POST another field with the same key', () =>
      contactFieldsApi.create({ ...payload, label: `${payload.label} copy` }));
    const body = await response.json();
    if (body.data?.id)
      cleanup.add('duplicate contact field', () => contactFieldsApi.deleteIfExists(body.data.id));

    await test.step('responds 409 naming the key', () => {
      expect(response.status()).toBe(409);
      expect(body.message).toBe(`A contact field with the key "${payload.key}" already exists`);
    });
  });

  test('should reject an unknown type with 422 listing the allowed ones', async ({
    contactFieldsApi,
    cleanup,
  }) => {
    const payload = { ...toContactFieldPayload(buildContactField()), type: 'choice' };

    const response =
      await test.step('POST a field with type "choice" (the UI label, not the API value)', () =>
        contactFieldsApi.create(payload));
    const body = await response.json();
    if (body.data?.id) cleanup.add('contact field', () => contactFieldsApi.deleteIfExists(body.data.id));

    await test.step('responds 422 naming the four allowed types', () => {
      expect(response.status()).toBe(422);
      expect(body.message).toEqual({
        type: 'type must be one of the following values: string, number, select, phone',
      });
    });
  });

  test('should reject an empty field with 422 naming the label and type', async ({
    contactFieldsApi,
    cleanup,
  }) => {
    knownBug('misleading-required-field-messages');
    const response = await test.step('POST an empty body', () => contactFieldsApi.create({}));
    const body = await response.json();
    if (body.data?.id) cleanup.add('contact field', () => contactFieldsApi.deleteIfExists(body.data.id));

    await test.step('responds 422 saying the label is required and naming the allowed types', () => {
      expect(response.status()).toBe(422);
      expect(body.message).toEqual({
        label: 'label should not be empty',
        type: 'type must be one of the following values: string, number, select, phone',
      });
    });
  });

  test('should reject a request without a login token with 401', async ({
    request,
    contactFieldsApi,
    apiHeaders,
  }) => {
    const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();

    const response = await test.step('GET the list without a login token', () =>
      request.get(`${env.apiUrl}${contactFieldsApi.path}`, { headers: headersWithoutToken }));

    await test.step('responds 401', () => expect(response.status()).toBe(401));
  });
});
