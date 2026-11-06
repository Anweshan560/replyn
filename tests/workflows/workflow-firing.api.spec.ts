import { test as base, expect } from '../../fixtures/test';
import { toContactPayload, type Contact } from '../../api/ContactsApi';
import { ENDPOINTS } from '../../api/ResourceApi';
import { toWorkflowPayload, type WorkflowRecord } from '../../api/WorkflowsApi';
import { env } from '../../config/env';
import { buildContact, buildWorkflow } from '../../utils/testData';

/** An id in the right format that nothing has. */
const MISSING_ID = '00000000-0000-7000-8000-000000000000';

/**
 * Every test fires its own workflow at its own contact. The workflow is Manual trigger -> Exit, so
 * running it can never message or change anyone.
 */
const test = base.extend<{ contact: Contact; workflow: WorkflowRecord }>({
  contact: async ({ contactsApi }, use) => {
    const contact = await contactsApi.createRecord(toContactPayload(buildContact()));
    await use(contact);
    await contactsApi.deleteIfExists(contact.id);
  },
  workflow: async ({ workflowsApi }, use) => {
    const workflow = await workflowsApi.createRecord(toWorkflowPayload(buildWorkflow()));
    await use(workflow);
    await workflowsApi.deleteIfExists(workflow.id);
  },
});

test.describe('Workflow firing API', { tag: ['@workflows'] }, () => {
  test('should run an active workflow for a contact through to its last step', async ({
    workflowsApi,
    contactsApi,
    workflow,
    contact,
  }) => {
    await test.step('activate the workflow', async () => {
      expect((await workflowsApi.activate(workflow.id)).status()).toBe(201);
    });

    const response = await test.step('POST the trigger', () => workflowsApi.trigger(workflow.id, contact.id));
    const execution = (await response.json()).data;

    await test.step('responds 201 with a manual run of this workflow', () => {
      expect(response.status()).toBe(201);
      expect(execution).toMatchObject({ workflowId: workflow.id, source: 'manual' });
    });
    await test.step('the run reaches the Exit step, with every step done', async () => {
      await expect(async () => {
        const [run] = await workflowsApi.contactExecutions(contact.id);
        expect(run).toMatchObject({
          id: execution.id,
          workflowId: workflow.id,
          workflowName: workflow.name,
          status: 'exited',
          currentStepId: 'exit',
          totalSteps: 2,
          completedSteps: 2,
        });
      }).toPass({ timeout: 30_000 });
    });
    await test.step("the contact's timeline says the workflow started", async () => {
      const events = await contactsApi.eventRecords(contact.id);
      const started = events.find((event) => event.activity?.type === 'workflow_started');
      expect(started?.activity?.payload).toMatchObject({
        workflowId: workflow.id,
        workflowName: workflow.name,
        executionId: execution.id,
      });
    });
    await test.step("the workflow's activities list the run with the contact", async () => {
      const activities = await workflowsApi.activities(workflow.id);
      expect(activities.find((run) => run.id === execution.id)).toMatchObject({ contactId: contact.id });
    });
  });

  test('should run a workflow for several contacts at once', async ({
    workflowsApi,
    contactsApi,
    workflow,
    contact,
    cleanup,
  }) => {
    const second = await test.step('create a second contact', () =>
      contactsApi.createRecord(toContactPayload(buildContact())));
    cleanup.add(`contact ${second.id}`, () => contactsApi.deleteIfExists(second.id));
    await workflowsApi.activate(workflow.id);

    const response = await test.step('POST the bulk trigger', () =>
      workflowsApi.triggerBulk(workflow.id, [contact.id, second.id]));

    await test.step('responds 201 with both contacts triggered', async () => {
      expect(response.status()).toBe(201);
      const { triggered, skipped, failed } = (await response.json()).data;
      expect([...triggered].sort()).toEqual([contact.id, second.id].sort());
      expect(skipped).toEqual([]);
      expect(failed).toEqual([]);
    });
    await test.step('each contact has its own run', async () => {
      await expect(async () => {
        for (const id of [contact.id, second.id]) {
          expect(await workflowsApi.contactExecutions(id)).toHaveLength(1);
        }
      }).toPass({ timeout: 30_000 });
    });
  });

  test('should refuse to run a paused workflow', async ({ workflowsApi, workflow, contact }) => {
    const response = await test.step('POST the trigger for a paused workflow', () =>
      workflowsApi.trigger(workflow.id, contact.id));

    await test.step('responds 400, and the contact has no run', async () => {
      expect(response.status()).toBe(400);
      expect((await response.json()).message).toBe('Workflow is not active');
      expect(await workflowsApi.contactExecutions(contact.id)).toEqual([]);
    });
  });

  test('should reject a trigger without a contact with 422', async ({ workflowsApi, workflow }) => {
    await workflowsApi.activate(workflow.id);

    const response = await test.step('POST the trigger with no contact', () =>
      workflowsApi.trigger(workflow.id, undefined));

    await test.step('responds 422 with an error about the contact', async () => {
      expect(response.status()).toBe(422);
      expect((await response.json()).message.contactId).toBe('contactId must be a UUID');
    });
  });

  test('should answer 404 for a contact or workflow that does not exist', async ({
    workflowsApi,
    workflow,
    contact,
  }) => {
    await workflowsApi.activate(workflow.id);

    await test.step('an unknown contact: "No such contact"', async () => {
      const response = await workflowsApi.trigger(workflow.id, MISSING_ID);
      expect(response.status()).toBe(404);
      expect((await response.json()).message).toBe('No such contact');
    });
    await test.step('an unknown workflow: "Workflow not found"', async () => {
      const response = await workflowsApi.trigger(MISSING_ID, contact.id);
      expect(response.status()).toBe(404);
      expect((await response.json()).message).toBe('Workflow not found');
    });
  });

  test('should reject a trigger without a login token with 401', async ({
    request,
    apiHeaders,
    workflowsApi,
    workflow,
    contact,
  }) => {
    await workflowsApi.activate(workflow.id);
    const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();

    const response = await test.step('POST the trigger without a token', () =>
      request.post(`${env.apiUrl}${ENDPOINTS.workflows}/${workflow.id}/trigger`, {
        headers: headersWithoutToken,
        data: { contactId: contact.id },
      }));

    await test.step('responds 401, and the contact has no run', async () => {
      expect(response.status()).toBe(401);
      expect(await workflowsApi.contactExecutions(contact.id)).toEqual([]);
    });
  });
});
