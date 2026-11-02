import { test, expect } from '../../../fixtures/test';
import { toCustomViewPayload } from '../../../api/CustomViewsApi';
import { env } from '../../../config/env';
import { buildSavedView } from '../../../utils/testData';
import { knownBug } from '../../../utils/knownBug';

test.describe('Saved Views API', { tag: ['@inbox', '@saved-views'] }, () => {
  test('should create a view and return every field that was sent', async ({ customViewsApi, cleanup }) => {
    const payload = toCustomViewPayload(buildSavedView());

    const response = await test.step('POST a new view', () => customViewsApi.create(payload));
    const body = await response.json();
    if (body.data?.id)
      cleanup.add(`saved view ${payload.name}`, () => customViewsApi.deleteIfExists(body.data.id));

    await test.step('responds 201 with every field and an id', () => {
      expect(response.status()).toBe(201);
      expect(body.data).toMatchObject({ ...payload, id: expect.any(String) });
    });
  });

  test('should list and return a view by its id', async ({ customViewsApi, cleanup }) => {
    const payload = toCustomViewPayload(buildSavedView());
    const created = await test.step('create a view', () => customViewsApi.createRecord(payload));
    cleanup.add(`saved view ${payload.name}`, () => customViewsApi.deleteIfExists(created.id));

    await test.step('the list contains it with the same fields', async () => {
      expect(await customViewsApi.findRecord(created.id)).toMatchObject(payload);
    });
    await test.step('GET by id responds 200 with the same fields', async () => {
      const response = await customViewsApi.get(created.id);
      expect(response.status()).toBe(200);
      expect((await response.json()).data).toMatchObject({ id: created.id, ...payload });
    });
  });

  test('should replace every field of a view with PUT', async ({ customViewsApi, cleanup }) => {
    const original = buildSavedView();
    const created = await test.step('create a view', () =>
      customViewsApi.createRecord(toCustomViewPayload(original)));
    cleanup.add(`saved view ${original.name}`, () => customViewsApi.deleteIfExists(created.id));
    const updated = toCustomViewPayload(buildSavedView(original));

    const response = await test.step('PUT every field', () => customViewsApi.update(created.id, updated));

    await test.step('responds 200, and GET returns the new values', async () => {
      expect(response.status()).toBe(200);
      expect((await (await customViewsApi.get(created.id)).json()).data).toMatchObject(updated);
    });
  });

  test('should delete a view so it can no longer be found', async ({ customViewsApi, cleanup }) => {
    const created = await test.step('create a view', () =>
      customViewsApi.createRecord(toCustomViewPayload(buildSavedView())));
    cleanup.add(`saved view ${created.name}`, () => customViewsApi.deleteIfExists(created.id));

    const response = await test.step('DELETE it', () => customViewsApi.delete(created.id));

    await test.step('responds 200', () => expect(response.status()).toBe(200));
    await test.step('GET by id now responds 404 "No custom view found", and the list does not contain it', async () => {
      const get = await customViewsApi.get(created.id);
      expect(get.status()).toBe(404);
      expect((await get.json()).message).toBe('No custom view found');
      expect(await customViewsApi.findRecord(created.id)).toBeUndefined();
    });
  });

  test('should reject an unknown visibility with 422 naming the allowed ones', async ({
    customViewsApi,
    cleanup,
  }) => {
    const payload = { ...toCustomViewPayload(buildSavedView()), visibility: 'team' as never };

    const response = await test.step('POST a view shared with "team"', () => customViewsApi.create(payload));
    const body = await response.json();
    if (body.data?.id) cleanup.add('saved view', () => customViewsApi.deleteIfExists(body.data.id));

    await test.step('responds 422 naming private and workspace', () => {
      expect(response.status()).toBe(422);
      expect(body.message).toEqual({
        visibility: 'visibility must be one of the following values: private, workspace',
      });
    });
  });

  test('should reject an empty view with 422 saying the name and icon are required', async ({
    customViewsApi,
    cleanup,
  }) => {
    knownBug('misleading-required-field-messages');
    const response = await test.step('POST an empty body', () => customViewsApi.create({}));
    const body = await response.json();
    if (body.data?.id) cleanup.add('saved view', () => customViewsApi.deleteIfExists(body.data.id));

    await test.step('responds 422 saying the name and icon are required', () => {
      expect(response.status()).toBe(422);
      expect(body.message).toEqual({ name: 'name should not be empty', icon: 'icon should not be empty' });
    });
  });

  test('should reject a request without a login token with 401', async ({
    request,
    customViewsApi,
    apiHeaders,
  }) => {
    const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();

    const response = await test.step('GET the list without a login token', () =>
      request.get(`${env.apiUrl}${customViewsApi.path}`, { headers: headersWithoutToken }));

    await test.step('responds 401', () => expect(response.status()).toBe(401));
  });
});
