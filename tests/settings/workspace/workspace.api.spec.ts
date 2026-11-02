import { test, expect } from '../../../fixtures/test';
import { runOnlyOnItsOwn } from '../../exclusive';
import { env } from '../../../config/env';
import { buildFollowUpCreditDays, buildWorkspaceName } from '../../../utils/testData';
import { knownBug } from '../../../utils/knownBug';

// The test workspace itself: every test puts its name and settings back afterwards.
test.describe('Workspace API', { tag: ['@settings', '@workspace'] }, () => {
  runOnlyOnItsOwn();

  test.beforeEach(async ({ workspaceApi, cleanup }) => {
    cleanup.add('restore the workspace', await workspaceApi.rememberCurrent());
  });

  test('should return the workspace with its name and settings', async ({ workspaceApi, workspaceId }) => {
    const response = await test.step('GET the workspace', () => workspaceApi.get());

    await test.step('responds 200 with its id, name and settings', async () => {
      expect(response.status()).toBe(200);
      expect((await response.json()).data).toMatchObject({
        id: workspaceId,
        name: expect.any(String),
        config: expect.any(Object),
        offDays: expect.any(Array),
      });
    });
  });

  test('should rename the workspace', async ({ workspaceApi }) => {
    const name = buildWorkspaceName();

    const response = await test.step('PATCH a new name', () => workspaceApi.update({ name }));

    await test.step('responds 200, and GET returns the new name', async () => {
      expect(response.status()).toBe(200);
      expect((await workspaceApi.current()).name).toBe(name);
    });
  });

  test('should change one setting without touching the others', async ({ workspaceApi }) => {
    const before = await workspaceApi.current();
    const days = buildFollowUpCreditDays(before.config.followUpCreditWindowDays ?? 30);

    const response = await test.step('PATCH only the follow-up credit', () =>
      workspaceApi.update({ config: { followUpCreditWindowDays: days } }));

    await test.step('responds 200; the credit changed and every other setting kept its value', async () => {
      expect(response.status()).toBe(200);
      const after = await workspaceApi.current();
      expect(after.config).toEqual({ ...before.config, followUpCreditWindowDays: days });
      expect(after.name).toBe(before.name);
    });
  });

  for (const days of [1, 365]) {
    test(`should accept a follow-up credit of ${days} day${days > 1 ? 's' : ''}, the ${days === 1 ? 'lowest' : 'highest'} allowed`, async ({
      workspaceApi,
    }) => {
      const response = await test.step(`PATCH a credit of ${days}`, () =>
        workspaceApi.update({ config: { followUpCreditWindowDays: days } }));

      await test.step('responds 200 and stores it', async () => {
        expect(response.status()).toBe(200);
        expect((await workspaceApi.current()).config.followUpCreditWindowDays).toBe(days);
      });
    });
  }

  for (const [days, message] of [
    [0, 'followUpCreditWindowDays must not be less than 1'],
    [366, 'followUpCreditWindowDays must not be greater than 365'],
  ] as const) {
    test(`should reject a follow-up credit of ${days} days with 422`, async ({ workspaceApi }) => {
      const before = (await workspaceApi.current()).config.followUpCreditWindowDays;

      const response = await test.step(`PATCH a credit of ${days}`, () =>
        workspaceApi.update({ config: { followUpCreditWindowDays: days } }));

      await test.step('responds 422 naming the limit, and the credit is unchanged', async () => {
        expect(response.status()).toBe(422);
        expect((await response.json()).message).toEqual({ 'config.followUpCreditWindowDays': message });
        expect((await workspaceApi.current()).config.followUpCreditWindowDays).toBe(before);
      });
    });
  }

  test('should reject an empty workspace name with 422', async ({ workspaceApi }) => {
    knownBug('workspace-empty-name');
    const response = await test.step('PATCH an empty name', () => workspaceApi.update({ name: '' }));

    await test.step('responds 422', () => expect(response.status()).toBe(422));
  });

  test('should reject a request without a login token with 401', async ({
    request,
    workspaceApi,
    apiHeaders,
  }) => {
    const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();

    const response = await test.step('GET the workspace without a login token', () =>
      request.get(`${env.apiUrl}${workspaceApi.path}`, { headers: headersWithoutToken }));

    await test.step('responds 401', () => expect(response.status()).toBe(401));
  });
});
