import { test, expect } from '../../../fixtures/test';
import { runOnlyOnItsOwn } from '../../exclusive';
import { env } from '../../../config/env';
import { buildLifecycleStage } from '../../../utils/testData';
import { knownBug } from '../../../utils/knownBug';

// New stages go at the end of the lost stages, where they don't move the pipeline the contacts
// tests use; the tests still run on their own, and remove what they add.
test.describe('Lifecycle stages API', { tag: ['@settings', '@lifecycle'] }, () => {
  runOnlyOnItsOwn();

  test('should create a stage and return every field that was sent', async ({ lifecyclesApi, cleanup }) => {
    const lost = (await lifecyclesApi.listRecords()).filter((stage) => stage.type === 'lost');
    const payload = { ...buildLifecycleStage(), type: 'lost' as const, stage: lost.length + 1 };

    const response = await test.step('POST a new lost stage', () => lifecyclesApi.create(payload));
    const body = await response.json();
    if (body.data?.id)
      cleanup.add(`lifecycle stage ${payload.name}`, () => lifecyclesApi.deleteIfExists(body.data.id));

    await test.step('responds 201 with every field, and none of the special flags', () => {
      expect(response.status()).toBe(201);
      expect(body.data).toMatchObject({
        ...payload,
        id: expect.any(String),
        isDefault: false,
        isWon: false,
        isLost: false,
        isSpam: false,
      });
    });
    await test.step('the list contains it with no contacts', async () => {
      expect(await lifecyclesApi.findRecord(body.data.id)).toMatchObject({
        name: payload.name,
        contactCount: 0,
      });
    });
  });

  test('should rename a stage and change its emoji and description', async ({ lifecyclesApi, cleanup }) => {
    const lost = (await lifecyclesApi.listRecords()).filter((stage) => stage.type === 'lost');
    const created = await test.step('create a stage', () =>
      lifecyclesApi.createRecord({ ...buildLifecycleStage(), type: 'lost', stage: lost.length + 1 }));
    cleanup.add(`lifecycle stage ${created.name}`, () => lifecyclesApi.deleteIfExists(created.id));
    const changes = { ...buildLifecycleStage(), description: 'Patients who stopped replying.' };

    const response = await test.step('PATCH the name, emoji and description', () =>
      lifecyclesApi.update(created.id, changes));

    await test.step('responds 200 with the new values, in the same place', async () => {
      expect(response.status()).toBe(200);
      expect((await response.json()).data).toMatchObject({ ...changes, stage: created.stage, type: 'lost' });
    });
  });

  test('should delete a stage so it leaves the list', async ({ lifecyclesApi, cleanup }) => {
    const lost = (await lifecyclesApi.listRecords()).filter((stage) => stage.type === 'lost');
    const created = await test.step('create a stage', () =>
      lifecyclesApi.createRecord({ ...buildLifecycleStage(), type: 'lost', stage: lost.length + 1 }));
    cleanup.add(`lifecycle stage ${created.name}`, () => lifecyclesApi.deleteIfExists(created.id));

    const response = await test.step('DELETE it', () => lifecyclesApi.delete(created.id));

    await test.step('responds 200, and the list no longer contains it', async () => {
      expect(response.status()).toBe(200);
      expect(await lifecyclesApi.findRecord(created.id)).toBeUndefined();
    });
  });

  test('should reject an empty stage with 422 naming the name, position and type', async ({
    lifecyclesApi,
    cleanup,
  }) => {
    const response = await test.step('POST an empty body', () => lifecyclesApi.create({}));
    const body = await response.json();
    if (body.data?.id) cleanup.add('lifecycle stage', () => lifecyclesApi.deleteIfExists(body.data.id));

    await test.step('responds 422 with a message for each', () => {
      expect(response.status()).toBe(422);
      expect(body.message).toEqual({
        name: 'name must be a string',
        stage: 'stage must be a number conforming to the specified constraints',
        type: 'type must be one of the following values: lead, lost',
      });
    });
  });

  test('should list the stages without asking for contact counts', async ({
    request,
    lifecyclesApi,
    apiHeaders,
  }) => {
    knownBug('lifecycles-contactcount-required');
    const response = await test.step('GET the list with no query', async () =>
      request.get(`${env.apiUrl}${lifecyclesApi.path}`, { headers: await apiHeaders() }));

    await test.step('responds 200', () => expect(response.status()).toBe(200));
  });

  test('should reject a request without a login token with 401', async ({
    request,
    lifecyclesApi,
    apiHeaders,
  }) => {
    const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();

    const response = await test.step('GET the list without a login token', () =>
      request.get(`${env.apiUrl}${lifecyclesApi.path}`, {
        headers: headersWithoutToken,
        params: { contactCount: false },
      }));

    await test.step('responds 401', () => expect(response.status()).toBe(401));
  });
});
