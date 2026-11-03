import { test, expect } from '../../fixtures/test';
import { toWorkflowPayload } from '../../api/WorkflowsApi';
import { ENDPOINTS } from '../../api/ResourceApi';
import { env } from '../../config/env';
import { buildWorkflow } from '../../utils/testData';
import { knownBug } from '../../utils/knownBug';

// Every workflow here starts by hand only and its one step ends it, so nothing ever runs.
// DELETE archives (there is no real delete); cleanup archives what a test made.
test.describe('Workflows API', { tag: ['@workflows'] }, () => {
  test('should create a workflow and return every field that was sent', async ({ workflowsApi, cleanup }) => {
    const payload = toWorkflowPayload(buildWorkflow());

    const response = await test.step('POST a new workflow', () => workflowsApi.create(payload));
    const body = await response.json();
    if (body.data?.id)
      cleanup.add(`workflow ${body.data.id}`, () => workflowsApi.deleteIfExists(body.data.id));

    await test.step('responds 201 with every field, a new id and no validation errors', () => {
      expect(response.status()).toBe(201);
      expect(body.data).toMatchObject(payload);
      expect(body.data.id).toEqual(expect.any(String));
      expect(body.data.validationErrors ?? []).toEqual([]);
    });
  });

  test('should save a workflow without an action step but list that as a validation error', async ({
    workflowsApi,
    cleanup,
  }) => {
    const payload = toWorkflowPayload(buildWorkflow(), { actionStep: false });

    const response = await test.step('POST a workflow that has only a trigger', () =>
      workflowsApi.create(payload));
    const body = await response.json();
    if (body.data?.id)
      cleanup.add(`workflow ${body.data.id}`, () => workflowsApi.deleteIfExists(body.data.id));

    await test.step('responds 201, paused, with "at least one action step" in validationErrors', () => {
      expect(response.status()).toBe(201);
      expect(body.data.isActive).toBe(false);
      expect(body.data.validationErrors).toContainEqual({
        message: 'Workflow must have at least one action step',
      });
    });
  });

  test('should reject an empty workflow with 422 naming the name, steps and trigger', async ({
    workflowsApi,
    cleanup,
  }) => {
    const response = await test.step('POST an empty body', () => workflowsApi.create({}));
    const body = await response.json();
    if (body.data?.id) cleanup.add('workflow', () => workflowsApi.deleteIfExists(body.data.id));

    await test.step('responds 422 naming each missing field', () => {
      expect(response.status()).toBe(422);
      expect(body.message).toEqual({
        name: 'name should not be empty',
        steps: 'steps should not be empty',
        triggerStrategy: 'triggerStrategy should not be empty',
      });
    });
  });

  test('should get a workflow by id and find it with the list search', async ({ workflowsApi, cleanup }) => {
    const workflow = buildWorkflow();
    const created = await test.step('create a workflow', () =>
      workflowsApi.createRecord(toWorkflowPayload(workflow)));
    cleanup.add(`workflow ${created.id}`, () => workflowsApi.deleteIfExists(created.id));

    await test.step('GET by id answers 200 with the workflow', async () => {
      const response = await workflowsApi.get(created.id);
      expect(response.status()).toBe(200);
      expect((await response.json()).data).toMatchObject({ id: created.id, name: workflow.name });
    });
    await test.step('?search= with its name lists only that workflow', async () => {
      const found = await workflowsApi.listFilteredRecords({ search: workflow.name });
      expect(found.map((record) => record.id)).toEqual([created.id]);
    });
  });

  test('should filter the list by status, archived and trigger as the page tabs do', async ({
    workflowsApi,
    cleanup,
  }) => {
    const created = await test.step('create a paused workflow', () =>
      workflowsApi.createRecord(toWorkflowPayload(buildWorkflow())));
    cleanup.add(`workflow ${created.id}`, () => workflowsApi.deleteIfExists(created.id));
    const ids = async (filters: Parameters<typeof workflowsApi.listFilteredRecords>[0]) =>
      (await workflowsApi.listFilteredRecords(filters)).map((record) => record.id);

    await test.step('Paused (?isActive=false) lists it; every workflow listed is paused', async () => {
      const paused = await workflowsApi.listFilteredRecords({ isActive: false });
      expect(paused.map((record) => record.id)).toContain(created.id);
      expect(paused.every((record) => record.isActive === false)).toBe(true);
    });
    await test.step('Active (?isActive=true) does not list it', async () => {
      expect(await ids({ isActive: true })).not.toContain(created.id);
    });
    await test.step('?triggerType=manual_trigger lists it, ?triggerType=contact_created does not', async () => {
      expect(await ids({ triggerType: 'manual_trigger' })).toContain(created.id);
      expect(await ids({ triggerType: 'contact_created' })).not.toContain(created.id);
    });
    await test.step('Archived (?archived=true) does not list it while it is not archived', async () => {
      expect(await ids({ archived: true })).not.toContain(created.id);
    });
  });

  test('should rename a workflow', async ({ workflowsApi, cleanup }) => {
    const created = await workflowsApi.createRecord(toWorkflowPayload(buildWorkflow()));
    cleanup.add(`workflow ${created.id}`, () => workflowsApi.deleteIfExists(created.id));
    const { name } = buildWorkflow();

    const response = await test.step('PATCH a new name', () => workflowsApi.update(created.id, { name }));
    await test.step('responds 200 and stores it', async () => {
      expect(response.status()).toBe(200);
      expect((await (await workflowsApi.get(created.id)).json()).data.name).toBe(name);
    });
  });

  test('should reject an empty name with 422', async ({ workflowsApi, cleanup }) => {
    const created = await workflowsApi.createRecord(toWorkflowPayload(buildWorkflow()));
    cleanup.add(`workflow ${created.id}`, () => workflowsApi.deleteIfExists(created.id));

    const response = await test.step('PATCH name ""', () => workflowsApi.update(created.id, { name: '' }));
    await test.step('responds 422 and keeps the old name', async () => {
      expect(response.status()).toBe(422);
      expect((await response.json()).message).toEqual({ name: 'name should not be empty' });
      expect((await (await workflowsApi.get(created.id)).json()).data.name).toBe(created.name);
    });
  });

  test('should activate and pause a valid workflow', async ({ workflowsApi, cleanup }) => {
    const created = await workflowsApi.createRecord(toWorkflowPayload(buildWorkflow()));
    cleanup.add(`workflow ${created.id}`, () => workflowsApi.deleteIfExists(created.id));

    await test.step('POST /activate responds 201 and the workflow is active', async () => {
      const response = await workflowsApi.activate(created.id);
      expect(response.status()).toBe(201);
      expect((await response.json()).data.isActive).toBe(true);
    });
    await test.step('POST /deactivate responds 201 and the workflow is paused', async () => {
      const response = await workflowsApi.deactivate(created.id);
      expect(response.status()).toBe(201);
      expect((await response.json()).data.isActive).toBe(false);
    });
  });

  test('should refuse to activate a workflow that has validation errors', async ({
    workflowsApi,
    cleanup,
  }) => {
    const created = await workflowsApi.createRecord(
      toWorkflowPayload(buildWorkflow(), { actionStep: false }),
    );
    cleanup.add(`workflow ${created.id}`, () => workflowsApi.deleteIfExists(created.id));

    const response = await test.step('POST /activate', () => workflowsApi.activate(created.id));
    await test.step('responds 400 "Workflow validation failed" and the workflow stays paused', async () => {
      expect(response.status()).toBe(400);
      expect(await response.json()).toMatchObject({
        message: 'Workflow validation failed',
        errors: [{ message: 'Workflow must have at least one action step' }],
      });
      expect((await (await workflowsApi.get(created.id)).json()).data.isActive).toBe(false);
    });
  });

  test('should not let PATCH activate a workflow that has validation errors', async ({
    workflowsApi,
    cleanup,
  }) => {
    knownBug('workflow-patch-skips-validation');
    const created = await workflowsApi.createRecord(
      toWorkflowPayload(buildWorkflow(), { actionStep: false }),
    );
    cleanup.add(`workflow ${created.id}`, () => workflowsApi.deleteIfExists(created.id));

    const response = await test.step('PATCH { isActive: true }', () =>
      workflowsApi.update(created.id, { isActive: true }));
    await test.step('is refused, as POST /activate is, and the workflow stays paused', async () => {
      // Put it back before checking, so a failure here never leaves a broken workflow switched on.
      const isActive = (await (await workflowsApi.get(created.id)).json()).data.isActive;
      if (isActive) await workflowsApi.deactivate(created.id);
      expect(response.status()).toBe(400);
      expect(isActive).toBe(false);
    });
  });

  test('should archive a workflow with DELETE and bring it back with restore', async ({
    workflowsApi,
    cleanup,
  }) => {
    const created = await workflowsApi.createRecord(toWorkflowPayload(buildWorkflow()));
    cleanup.add(`workflow ${created.id}`, () => workflowsApi.deleteIfExists(created.id));

    await test.step('DELETE responds 200 "Workflow archived successfully"', async () => {
      const response = await workflowsApi.delete(created.id);
      expect(response.status()).toBe(200);
      expect((await response.json()).data.message).toBe('Workflow archived successfully');
    });
    await test.step('GET answers 404, and ?archived=true lists it', async () => {
      expect((await workflowsApi.get(created.id)).status()).toBe(404);
      const archived = await workflowsApi.listFilteredRecords({ archived: true });
      expect(archived.find((record) => record.id === created.id)?.deletedAt).toEqual(expect.any(String));
    });
    await test.step('DELETE again answers 404: there is nothing more to delete', async () => {
      expect((await workflowsApi.delete(created.id)).status()).toBe(404);
    });
    await test.step('POST /restore responds 201 and the workflow is back, paused', async () => {
      const response = await workflowsApi.restore(created.id);
      expect(response.status()).toBe(201);
      expect((await response.json()).data).toMatchObject({
        id: created.id,
        isActive: false,
        deletedAt: null,
      });
      expect((await workflowsApi.get(created.id)).status()).toBe(200);
    });
  });

  test('should answer 404 for a workflow that does not exist', async ({ workflowsApi }) => {
    const response = await workflowsApi.get('00000000-0000-0000-0000-000000000000');
    expect(response.status()).toBe(404);
    expect((await response.json()).message).toBe('Workflow not found');
  });

  test('should report the analytics shown at the top of the page', async ({ workflowsApi }) => {
    const response = await test.step('GET /analytics', () => workflowsApi.analytics());
    await test.step('responds 200 with whole, consistent numbers', async () => {
      expect(response.status()).toBe(200);
      const data = (await response.json()).data;
      for (const key of ['totalExecutions', 'activeWorkflows', 'totalWorkflows', 'failedExecutions']) {
        expect(Number.isInteger(data[key]) && data[key] >= 0, `${key} = ${data[key]}`).toBe(true);
      }
      expect(data.activeWorkflows).toBeLessThanOrEqual(data.totalWorkflows);
      expect(data.failedExecutions).toBeLessThanOrEqual(data.totalExecutions);
      expect(data.successRate).toBeGreaterThanOrEqual(0);
      expect(data.successRate).toBeLessThanOrEqual(100);
    });
  });

  test('should list the canvas building blocks and templates', async ({ workflowsApi }) => {
    await test.step('GET /nodes has the triggers and actions the tests use', async () => {
      const response = await workflowsApi.nodes();
      expect(response.status()).toBe(200);
      const nodes = (await response.json()).data;
      expect(Object.keys(nodes)).toEqual(expect.arrayContaining(['triggers', 'conditions', 'actions']));
      expect(nodes.triggers).toHaveProperty('manual_trigger');
      expect(nodes.actions).toHaveProperty('exit');
    });
    await test.step('GET /templates lists templates with a key, name and steps', async () => {
      const response = await workflowsApi.templates();
      expect(response.status()).toBe(200);
      const templates = (await response.json()).data.templates;
      expect(templates.length).toBeGreaterThan(0);
      for (const template of templates) {
        expect(template).toMatchObject({
          key: expect.any(String),
          name: expect.any(String),
          steps: expect.any(Array),
        });
      }
    });
  });

  test('should reject a request without a login token with 401', async ({ request, apiHeaders }) => {
    const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();

    const response = await test.step('GET the list without a login token', () =>
      request.get(`${env.apiUrl}${ENDPOINTS.workflows}`, { headers: headersWithoutToken }));
    await test.step('responds 401', () => expect(response.status()).toBe(401));
  });
});
