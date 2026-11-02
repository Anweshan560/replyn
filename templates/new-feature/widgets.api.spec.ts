import { test, expect } from '../../../fixtures/test';
import { toWidgetPayload } from '../../../api/WidgetsApi';
import { ENDPOINTS } from '../../../api/ResourceApi';
import { env } from '../../../config/env';
import { buildWidget } from '../../../utils/testData';

// API tests: for each endpoint, create, list, get, update, delete, validation (422) and no token (401).
test.describe('Widgets API', { tag: ['@area', '@widgets'] }, () => {
  test('should create a widget and return every field that was sent', async ({ widgetsApi, cleanup }) => {
    const payload = toWidgetPayload(buildWidget());

    const response = await test.step('POST a new widget', () => widgetsApi.create(payload));
    const body = await response.json();
    if (body.data?.id) cleanup.add(`widget ${body.data.id}`, () => widgetsApi.deleteIfExists(body.data.id));

    await test.step('responds 201 with every field and a new id', () => {
      expect(response.status()).toBe(201);
      expect(body.data).toMatchObject(payload);
      expect(body.data.id).toEqual(expect.any(String));
    });
  });

  test('should include a new widget in the list', async ({ widgetsApi, cleanup }) => {
    const created = await test.step('create a widget', () =>
      widgetsApi.createRecord(toWidgetPayload(buildWidget())));
    cleanup.add(`widget ${created.id}`, () => widgetsApi.deleteIfExists(created.id));

    await test.step('the list contains it', async () => {
      expect(await widgetsApi.listRecords()).toContainEqual(expect.objectContaining({ id: created.id }));
    });
  });

  test('should update a widget', async ({ widgetsApi, cleanup }) => {
    const created = await widgetsApi.createRecord(toWidgetPayload(buildWidget()));
    cleanup.add(`widget ${created.id}`, () => widgetsApi.deleteIfExists(created.id));
    const changes = toWidgetPayload(buildWidget());

    const response = await test.step('update every field', () => widgetsApi.update(created.id, changes));
    await test.step('responds 200 and stores the new values', async () => {
      expect(response.status()).toBe(200);
      expect((await (await widgetsApi.get(created.id)).json()).data).toMatchObject(changes);
    });
  });

  test('should delete a widget so it can no longer be found', async ({ widgetsApi, cleanup }) => {
    const created = await widgetsApi.createRecord(toWidgetPayload(buildWidget()));
    // Safety net only: does nothing if the test deleted it as expected.
    cleanup.add(`widget ${created.id}`, () => widgetsApi.deleteIfExists(created.id));

    const response = await test.step('DELETE it', () => widgetsApi.delete(created.id));
    await test.step('responds 200, and a GET afterwards responds 404', async () => {
      expect(response.status()).toBe(200);
      expect((await widgetsApi.get(created.id)).status()).toBe(404);
    });
  });

  test('should reject a widget without a name with 422', async ({ widgetsApi, cleanup }) => {
    const response = await test.step('POST an empty body', () => widgetsApi.create({}));
    const body = await response.json();
    if (body.data?.id) cleanup.add('widget', () => widgetsApi.deleteIfExists(body.data.id));

    await test.step('responds 422 saying the name is required', () => {
      expect(response.status()).toBe(422);
      expect(body.message).toHaveProperty('name');
    });
  });

  test('should reject a request without a login token with 401', async ({ request, apiHeaders }) => {
    const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();

    const response = await test.step('GET the list without a login token', () =>
      request.get(`${env.apiUrl}${ENDPOINTS.widgets}`, { headers: headersWithoutToken }));
    await test.step('responds 401', () => expect(response.status()).toBe(401));
  });
});
