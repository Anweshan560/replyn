import { test, expect } from '../../../fixtures/test';
import { toOutcomeReasonPayload } from '../../../api/OutcomeReasonsApi';
import { env } from '../../../config/env';
import { buildOutcomeReason } from '../../../utils/testData';
import { knownBug } from '../../../utils/knownBug';

const ALLOWED_ANSWERS =
  'each value in answers must be one of the following values: wont_come, not_interested, nothing_booked, all_done';

test.describe('Outcome Reasons API', { tag: ['@settings', '@outcome-reasons'] }, () => {
  test('should create a reason and return every field that was sent', async ({
    outcomeReasonsApi,
    cleanup,
  }) => {
    const payload = toOutcomeReasonPayload(buildOutcomeReason());

    const response = await test.step('POST a new reason', () => outcomeReasonsApi.create(payload));
    const body = await response.json();
    if (body.data?.id)
      cleanup.add(`outcome reason ${payload.label}`, () => outcomeReasonsApi.deleteIfExists(body.data.id));

    await test.step('responds 201 with the label, answers, an id and no built-in key', () => {
      expect(response.status()).toBe(201);
      expect(body.data).toMatchObject({ id: expect.any(String), label: payload.label, key: null });
      expect([...body.data.answers].sort()).toEqual([...payload.answers!].sort());
    });
    await test.step('the list contains it', async () => {
      expect(await outcomeReasonsApi.findRecord(body.data.id)).toMatchObject({ label: payload.label });
    });
  });

  test('should list the built-in reasons with their keys', async ({ outcomeReasonsApi }) => {
    const reasons = await test.step('GET the list', () => outcomeReasonsApi.listRecords());

    await test.step('it contains built-in reasons, which have a key', () => {
      expect(reasons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: 'Price too high', key: 'price_too_high' }),
          expect.objectContaining({
            label: 'Treatment complete',
            key: 'treatment_complete',
            answers: ['all_done'],
          }),
        ]),
      );
    });
  });

  test('should update the label and answers of a reason', async ({ outcomeReasonsApi, cleanup }) => {
    const original = buildOutcomeReason();
    const created = await test.step('create a reason', () =>
      outcomeReasonsApi.createRecord(toOutcomeReasonPayload(original)));
    cleanup.add(`outcome reason ${original.label}`, () => outcomeReasonsApi.deleteIfExists(created.id));
    const updated = toOutcomeReasonPayload(buildOutcomeReason(original));

    const response = await test.step('PATCH the label and answers', () =>
      outcomeReasonsApi.update(created.id, updated));

    await test.step('responds 200, and the list shows the new values', async () => {
      expect(response.status()).toBe(200);
      const stored = await outcomeReasonsApi.findRecord(created.id);
      expect(stored?.label).toBe(updated.label);
      expect([...stored!.answers].sort()).toEqual([...updated.answers!].sort());
    });
  });

  test('should delete a reason so it leaves the list', async ({ outcomeReasonsApi, cleanup }) => {
    const created = await test.step('create a reason', () =>
      outcomeReasonsApi.createRecord(toOutcomeReasonPayload(buildOutcomeReason())));
    cleanup.add(`outcome reason ${created.label}`, () => outcomeReasonsApi.deleteIfExists(created.id));

    const response = await test.step('DELETE it', () => outcomeReasonsApi.delete(created.id));

    await test.step('responds 200, and the list no longer contains it', async () => {
      expect(response.status()).toBe(200);
      expect(await outcomeReasonsApi.findRecord(created.id)).toBeUndefined();
    });
  });

  test('should reject an unknown answer with 422 listing the allowed ones', async ({
    outcomeReasonsApi,
    cleanup,
  }) => {
    const payload = { ...toOutcomeReasonPayload(buildOutcomeReason()), answers: ['maybe_later'] };

    const response = await test.step('POST a reason shown under "maybe_later"', () =>
      outcomeReasonsApi.create(payload));
    const body = await response.json();
    if (body.data?.id) cleanup.add('outcome reason', () => outcomeReasonsApi.deleteIfExists(body.data.id));

    await test.step('responds 422 naming the four allowed answers', () => {
      expect(response.status()).toBe(422);
      expect(body.message).toEqual({ answers: ALLOWED_ANSWERS });
    });
  });

  test('should reject an empty reason with 422 naming the label and answers', async ({
    outcomeReasonsApi,
    cleanup,
  }) => {
    knownBug('misleading-required-field-messages');
    const response = await test.step('POST an empty body', () => outcomeReasonsApi.create({}));
    const body = await response.json();
    if (body.data?.id) cleanup.add('outcome reason', () => outcomeReasonsApi.deleteIfExists(body.data.id));

    await test.step('responds 422 saying the label is required and naming the allowed answers', () => {
      expect(response.status()).toBe(422);
      expect(body.message).toEqual({ label: 'label should not be empty', answers: ALLOWED_ANSWERS });
    });
  });

  test('should reject a request without a login token with 401', async ({
    request,
    outcomeReasonsApi,
    apiHeaders,
  }) => {
    const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();

    const response = await test.step('GET the list without a login token', () =>
      request.get(`${env.apiUrl}${outcomeReasonsApi.path}`, { headers: headersWithoutToken }));

    await test.step('responds 401', () => expect(response.status()).toBe(401));
  });
});
