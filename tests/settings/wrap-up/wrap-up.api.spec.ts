import { test, expect } from '../../../fixtures/test';
import { toClosingNotePayload } from '../../../api/SettingsApis';
import { WRAP_UP_NAME, toWrapUpOutcomePayload, toWrapUpPayload } from '../../../api/WrapUpApi';
import { env } from '../../../config/env';
import { buildClosingNote, buildWrapUpOutcome } from '../../../utils/testData';
import { knownBug } from '../../../utils/knownBug';

// The workspace has one wrap-up, so these tests run one at a time in the workspace-settings
// project, and each puts the wrap-ups back as it found them.
test.describe('Wrap-Up API', { tag: ['@settings', '@wrap-up'] }, () => {
  let closingNoteId: string;

  test.beforeEach(async ({ wrapUpApi, closingNotesApi, cleanup }) => {
    // Cleanup runs in reverse: the wrap-ups are restored first, then this closing note is deleted.
    closingNoteId = (await closingNotesApi.createRecord(toClosingNotePayload(buildClosingNote()))).id;
    cleanup.add('closing note', () => closingNotesApi.deleteIfExists(closingNoteId));
    cleanup.add('restore the wrap-ups', await wrapUpApi.rememberCurrent());
  });

  test('should create a wrap-up and return every outcome that was sent', async ({ wrapUpApi }) => {
    const payload = toWrapUpPayload([toWrapUpOutcomePayload(buildWrapUpOutcome(), closingNoteId)]);

    const response = await test.step('POST a wrap-up with one outcome', () => wrapUpApi.create(payload));
    const body = await response.json();

    await test.step('responds 201 with an id, the name and the outcome', () => {
      expect(response.status()).toBe(201);
      expect(body.data).toMatchObject({ id: expect.any(String), name: WRAP_UP_NAME, config: payload.config });
    });
    await test.step('GET by id responds 200 with the same outcome', async () => {
      const get = await wrapUpApi.get(body.data.id);
      expect(get.status()).toBe(200);
      expect((await get.json()).data).toMatchObject({ id: body.data.id, config: payload.config });
    });
  });

  test('should replace the outcomes when a wrap-up is updated', async ({ wrapUpApi }) => {
    const original = buildWrapUpOutcome();
    const created = await test.step('create a wrap-up with one outcome', () =>
      wrapUpApi.createRecord(toWrapUpPayload([toWrapUpOutcomePayload(original, closingNoteId)])));
    const replacements = [buildWrapUpOutcome(original), buildWrapUpOutcome(original)].map((outcome) =>
      toWrapUpOutcomePayload(outcome, closingNoteId),
    );

    const response = await test.step('PATCH two different outcomes', () =>
      wrapUpApi.update(created.id, { config: replacements }));

    await test.step('responds 200, and GET returns exactly the two new outcomes', async () => {
      expect(response.status()).toBe(200);
      expect((await (await wrapUpApi.get(created.id)).json()).data.config).toMatchObject(replacements);
    });
  });

  test('should delete a wrap-up so it can no longer be found', async ({ wrapUpApi }) => {
    const created = await test.step('create a wrap-up', () =>
      wrapUpApi.createRecord(toWrapUpPayload([toWrapUpOutcomePayload(buildWrapUpOutcome(), closingNoteId)])));

    const response = await test.step('DELETE it', () => wrapUpApi.delete(created.id));

    await test.step('responds 200', () => expect(response.status()).toBe(200));
    await test.step('GET by id now responds 404 "Wrap-up not found", and the list does not contain it', async () => {
      const get = await wrapUpApi.get(created.id);
      expect(get.status()).toBe(404);
      expect((await get.json()).message).toBe('Wrap-up not found');
      expect((await wrapUpApi.listRecords()).map((record) => record.id)).not.toContain(created.id);
    });
  });

  test('should reject a wrap-up without a name with 422', async ({ wrapUpApi }) => {
    const response = await test.step('POST an empty body', () => wrapUpApi.create({}));

    await test.step('responds 422 saying the name is required', async () => {
      expect(response.status()).toBe(422);
      expect((await response.json()).message).toEqual({ name: 'name must be a string' });
    });
  });

  test('should reject an outcome with an unknown result with 422', async ({ wrapUpApi }) => {
    knownBug('wrap-up-result-not-validated');
    const outcome = { ...toWrapUpOutcomePayload(buildWrapUpOutcome(), closingNoteId), category: 'pending' };

    const response = await test.step('POST an outcome whose result is "pending"', () =>
      wrapUpApi.create(toWrapUpPayload([outcome])));

    await test.step('responds 422', () => expect(response.status()).toBe(422));
  });

  test('should reject a request without a login token with 401', async ({
    request,
    wrapUpApi,
    apiHeaders,
  }) => {
    const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();

    const response = await test.step('GET the list without a login token', () =>
      request.get(`${env.apiUrl}${wrapUpApi.path}`, { headers: headersWithoutToken }));

    await test.step('responds 401', () => expect(response.status()).toBe(401));
  });
});
