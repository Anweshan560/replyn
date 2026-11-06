import { test, expect } from '../../fixtures/test';
import { fullName, toContactPayload } from '../../api/ContactsApi';
import { toWorkflowPayload } from '../../api/WorkflowsApi';
import { buildContact, buildWorkflow } from '../../utils/testData';

// The workflow is Manual trigger -> Exit, so running it can never message or change anyone.
test.describe('Workflow firing', { tag: ['@workflows'] }, () => {
  test('should show a finished run on the contact and on the workflow', async ({
    page,
    contactsPage,
    contactsApi,
    workflowsApi,
    cleanup,
  }) => {
    const contact = buildContact();
    const name = fullName(contact);
    const created = await test.step('create a contact (through the API)', () =>
      contactsApi.createRecord(toContactPayload(contact)));
    cleanup.add(`contact "${name}"`, () => contactsApi.deleteIfExists(created.id));
    const workflow = await test.step('create and activate a workflow (through the API)', async () => {
      const record = await workflowsApi.createRecord(toWorkflowPayload(buildWorkflow()));
      expect((await workflowsApi.activate(record.id)).status()).toBe(201);
      return record;
    });
    cleanup.add(`workflow "${workflow.name}"`, () => workflowsApi.deleteIfExists(workflow.id));

    await test.step('run it for the contact and wait until it ends (through the API)', async () => {
      expect((await workflowsApi.trigger(workflow.id, created.id)).status()).toBe(201);
      await expect(async () => {
        const [run] = await workflowsApi.contactExecutions(created.id);
        expect(run?.status).toBe('exited');
      }).toPass({ timeout: 30_000 });
    });

    await test.step("the contact's History > Automations lists the run", async () => {
      await contactsPage.open();
      await contactsPage.search(name);
      const panel = await contactsPage.openDetails(name);
      await panel.openTab('History');
      await panel.filterHistory('Automations');
      await expect(panel.root.getByText(workflow.name)).toBeVisible();
    });
    await test.step("the workflow's activities page lists the contact", async () => {
      await page.goto(`/workflows/${workflow.id}/activities`);
      await expect(page.getByRole('main').getByText(name)).toBeVisible();
    });
  });
});
