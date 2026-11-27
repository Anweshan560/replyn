import { test, expect } from '../../../fixtures/test';
import { CustomViewsApi, toCustomViewPayload } from '../../../api/CustomViewsApi';
import { buildSavedView } from '../../../utils/testData';

/**
 * The built-in Agent role's defaults (Settings → Roles → Agent) where the admin has to make
 * something first: a view shared with everyone. (Payments are recorded only in the workspace
 * without an EMR: tests/clinic/no-emr/agent-payments-no-emr.api.spec.ts.) The admin works
 * through the usual fixtures, the Agent through `agent.headers`.
 */
test.describe('Roles: the Agent role on records others made', { tag: ['@roles', '@permissions'] }, () => {
  test('should show an Agent a view shared with everyone, but not let them change or delete it', async ({
    request,
    customViewsApi,
    agent,
    cleanup,
  }) => {
    const shared = await customViewsApi.createRecord(
      toCustomViewPayload({ ...buildSavedView(), share: 'Everyone' }),
    );
    cleanup.add(`view ${shared.name}`, () => customViewsApi.deleteIfExists(shared.id));
    const agentViews = new CustomViewsApi(request, agent.headers);
    const refusal = 'Only whoever made this, or an Admin when it is shared, can change it.';

    await test.step("the Agent's list has it", async () => {
      expect((await agentViews.listRecords()).map((view) => view.id)).toContain(shared.id);
    });
    await test.step('rename it: responds 403', async () => {
      const response = await agentViews.update(shared.id, { name: buildSavedView().name });
      expect(response.status()).toBe(403);
      expect((await response.json()).message).toBe(refusal);
    });
    await test.step('delete it: responds 403, and it is still there', async () => {
      const response = await agentViews.delete(shared.id);
      expect(response.status()).toBe(403);
      expect((await response.json()).message).toBe(refusal);
      expect((await customViewsApi.get(shared.id)).status()).toBe(200);
    });
  });
});
