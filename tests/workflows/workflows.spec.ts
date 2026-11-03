import { test, expect } from '../../fixtures/test';
import { toWorkflowPayload, type WorkflowAnalytics } from '../../api/WorkflowsApi';
import { ENDPOINTS } from '../../api/ResourceApi';
import { buildWorkflow } from '../../utils/testData';
import { waitForApiResponse } from '../../utils/network';

// Arrange through the API: each test gets its own paused workflow that starts by hand only and
// whose one step ends it, so switching it on never messages anyone. Cleanup archives it.
test.describe('Workflows', { tag: ['@workflows'] }, () => {
  test(
    'should open Workflows from the menu with the same numbers as the API',
    { tag: '@smoke' },
    async ({ page, workflowsPage }) => {
      const analyticsLoaded = waitForApiResponse(page, 'GET', `${ENDPOINTS.workflows}/analytics`);
      await test.step('go to Workflows', () => workflowsPage.openFromDashboard());
      const analytics: WorkflowAnalytics = (await (await analyticsLoaded).json()).data;

      await test.step('the tiles show the numbers the page loaded', async () => {
        await expect(workflowsPage.tile('Active').getByRole('heading')).toHaveText(
          String(analytics.activeWorkflows),
        );
        await expect(workflowsPage.tile('Active')).toContainText(`of ${analytics.totalWorkflows}`);
        await expect(workflowsPage.tile('Runs · 7 days')).toContainText(String(analytics.totalExecutions));
        await expect(workflowsPage.tile('Success rate')).toContainText(`${analytics.successRate}%`);
        await expect(workflowsPage.tile('Failed')).toContainText(String(analytics.failedExecutions));
      });
      await test.step('the status tabs, search and trigger filter are there', async () => {
        for (const tab of ['All', 'Active', 'Paused', 'Archived'] as const) {
          await expect(workflowsPage.statusTab(tab)).toBeVisible();
        }
        await expect(workflowsPage.searchBox).toBeVisible();
        await expect(workflowsPage.triggerFilter).toHaveText('All triggers');
      });
    },
  );

  test('should find a workflow by name and show its trigger and steps', async ({
    workflowsPage,
    workflowsApi,
    cleanup,
  }) => {
    const workflow = await workflowsApi.createRecord(toWorkflowPayload(buildWorkflow()));
    cleanup.add(`workflow ${workflow.id}`, () => workflowsApi.deleteIfExists(workflow.id));

    await test.step('go to Workflows and search for its name', async () => {
      await workflowsPage.openFromDashboard();
      await workflowsPage.search(workflow.name);
    });
    await test.step('only that workflow is listed, as "Manual trigger · Exit", paused', async () => {
      await expect(workflowsPage.rowFor(workflow.name)).toHaveCount(1);
      await expect(workflowsPage.rowFor(workflow.name)).toContainText('Manual trigger · Exit');
      await expect(workflowsPage.liveSwitch(workflow.name, 'Activate')).toBeVisible();
      await expect(workflowsPage.rowFor('Untitled workflow')).toHaveCount(0);
    });
  });

  test('should list a paused workflow under Paused but not under Active', async ({
    workflowsPage,
    workflowsApi,
    cleanup,
  }) => {
    const workflow = await workflowsApi.createRecord(toWorkflowPayload(buildWorkflow()));
    cleanup.add(`workflow ${workflow.id}`, () => workflowsApi.deleteIfExists(workflow.id));
    await workflowsPage.openFromDashboard();
    await workflowsPage.search(workflow.name);

    await test.step('Paused lists it (the page asks for isActive=false)', async () => {
      await workflowsPage.showTab('Paused');
      await expect(workflowsPage.rowFor(workflow.name)).toBeVisible();
    });
    await test.step('Active does not (isActive=true)', async () => {
      await workflowsPage.showTab('Active');
      await expect(workflowsPage.rowFor(workflow.name)).toHaveCount(0);
    });
    await test.step('the trigger filter "Manual trigger" (triggerType=manual_trigger) lists it under All', async () => {
      await workflowsPage.showTab('All');
      await workflowsPage.filterByTrigger('Manual trigger');
      await expect(workflowsPage.rowFor(workflow.name)).toBeVisible();
    });
    await test.step('the trigger filter "Contact created" (triggerType=contact_created) does not', async () => {
      await workflowsPage.filterByTrigger('Contact created');
      await expect(workflowsPage.rowFor(workflow.name)).toHaveCount(0);
    });
  });

  test('should switch a workflow on and pause it again with the Live switch', async ({
    workflowsPage,
    workflowsApi,
    cleanup,
  }) => {
    const workflow = await workflowsApi.createRecord(toWorkflowPayload(buildWorkflow()));
    cleanup.add(`workflow ${workflow.id}`, () => workflowsApi.deleteIfExists(workflow.id));
    await workflowsPage.openFromDashboard();
    await workflowsPage.search(workflow.name);

    await test.step('Activate and confirm: the server activates it and the switch offers Pause', async () => {
      expect(await workflowsPage.setLive(workflow.name, 'Activate')).toBe(201);
      await expect(workflowsPage.liveSwitch(workflow.name, 'Pause')).toBeVisible();
      expect((await (await workflowsApi.get(workflow.id)).json()).data.isActive).toBe(true);
    });
    await test.step('Pause and confirm: the server pauses it and the switch offers Activate', async () => {
      expect(await workflowsPage.setLive(workflow.name, 'Pause')).toBe(201);
      await expect(workflowsPage.liveSwitch(workflow.name, 'Activate')).toBeVisible();
      expect((await (await workflowsApi.get(workflow.id)).json()).data.isActive).toBe(false);
    });
  });

  test('should explain why a workflow with validation errors cannot be activated', async ({
    workflowsPage,
    workflowsApi,
    cleanup,
  }) => {
    const workflow = await workflowsApi.createRecord(
      toWorkflowPayload(buildWorkflow(), { actionStep: false }),
    );
    cleanup.add(`workflow ${workflow.id}`, () => workflowsApi.deleteIfExists(workflow.id));
    await workflowsPage.openFromDashboard();
    await workflowsPage.search(workflow.name);

    await test.step('the row is flagged with 1 problem', async () => {
      await expect(
        workflowsPage.rowFor(workflow.name).getByRole('button', { name: '1', exact: true }),
      ).toBeVisible();
    });
    await test.step('Activate and confirm: the server refuses with 400', async () => {
      expect(await workflowsPage.setLive(workflow.name, 'Activate')).toBe(400);
    });
    await test.step('"Couldn\'t update: Workflow validation failed" is shown and it stays paused', async () => {
      await expect(workflowsPage.toast("Couldn't update")).toContainText('Workflow validation failed');
      await expect(workflowsPage.liveSwitch(workflow.name, 'Activate')).toBeVisible();
      expect((await (await workflowsApi.get(workflow.id)).json()).data.isActive).toBe(false);
    });
  });

  test('should move an archived workflow to Archived, and restore it from there', async ({
    workflowsPage,
    workflowsApi,
    cleanup,
  }) => {
    const workflow = await workflowsApi.createRecord(toWorkflowPayload(buildWorkflow()));
    cleanup.add(`workflow ${workflow.id}`, () => workflowsApi.deleteIfExists(workflow.id));
    await workflowsPage.openFromDashboard();
    await workflowsPage.search(workflow.name);

    await test.step('Archive: the confirmation names the workflow and says it can be restored', async () => {
      const confirm = await workflowsPage.archive(workflow.name);
      await expect(confirm).toBeHidden();
    });
    await test.step('it leaves the list, and the Archived tab (archived=true) lists it with Restore', async () => {
      await expect(workflowsPage.rowFor(workflow.name)).toHaveCount(0);
      await workflowsPage.showTab('Archived');
      await expect(workflowsPage.archivedRowFor(workflow.name)).toBeVisible();
    });
    await test.step('Restore: "Workflow restored", and it comes back paused', async () => {
      await workflowsPage.restore(workflow.name);
      await expect(workflowsPage.toast('Workflow restored')).toContainText('stays paused');
      await workflowsPage.showTab('All');
      await expect(workflowsPage.liveSwitch(workflow.name, 'Activate')).toBeVisible();
      expect((await workflowsApi.get(workflow.id)).status()).toBe(200);
    });
  });

  test('should ask before archiving and keep the workflow when cancelled', async ({
    page,
    workflowsPage,
    workflowsApi,
    cleanup,
  }) => {
    const workflow = await workflowsApi.createRecord(toWorkflowPayload(buildWorkflow()));
    cleanup.add(`workflow ${workflow.id}`, () => workflowsApi.deleteIfExists(workflow.id));
    await workflowsPage.openFromDashboard();
    await workflowsPage.search(workflow.name);

    const confirm = page.getByRole('alertdialog', { name: 'Archive workflow?' });
    await test.step('Archive opens a confirmation that names it', async () => {
      await workflowsPage
        .rowFor(workflow.name)
        .getByRole('button', { name: 'Archive workflow' })
        .first()
        .click();
      await expect(confirm).toContainText(`${workflow.name} stops running and moves to Archived`);
    });
    await test.step('Cancel closes it and the workflow is still listed and on the server', async () => {
      await confirm.getByRole('button', { name: 'Cancel' }).click();
      await expect(confirm).toBeHidden();
      await expect(workflowsPage.rowFor(workflow.name)).toBeVisible();
      expect((await workflowsApi.get(workflow.id)).status()).toBe(200);
    });
  });

  test('should open the activity log of a workflow', async ({
    page,
    workflowsPage,
    workflowsApi,
    cleanup,
  }) => {
    const workflow = await workflowsApi.createRecord(toWorkflowPayload(buildWorkflow()));
    cleanup.add(`workflow ${workflow.id}`, () => workflowsApi.deleteIfExists(workflow.id));
    await workflowsPage.openFromDashboard();
    await workflowsPage.search(workflow.name);

    await test.step('View activities opens /workflows/<id>/activities', async () => {
      await workflowsPage
        .rowFor(workflow.name)
        .getByRole('button', { name: 'View activities' })
        .first()
        .click();
      await expect(page).toHaveURL(`/workflows/${workflow.id}/activities`);
    });
  });

  test('should duplicate a workflow under a new name, with the same steps, paused', async ({
    page,
    workflowsPage,
    workflowsApi,
    cleanup,
  }) => {
    const workflow = await workflowsApi.createRecord(toWorkflowPayload(buildWorkflow()));
    cleanup.add(`workflow ${workflow.id}`, () => workflowsApi.deleteIfExists(workflow.id));
    const copyName = buildWorkflow().name;
    await workflowsPage.openFromDashboard();
    await workflowsPage.search(workflow.name);

    const copy =
      await test.step('Duplicate suggests "Copy of <name>"; save it under a new name', async () => {
        const result = await workflowsPage.duplicate(workflow.name, copyName);
        cleanup.add(`workflow copy ${result.id}`, () => workflowsApi.deleteIfExists(result.id));
        expect(result.suggestedName).toBe(`Copy of ${workflow.name}`);
        return result;
      });
    await test.step('the copy opens in the editor', async () => {
      await expect(page).toHaveURL(new RegExp(`/workflows/${copy.id}`));
      await expect(page.getByRole('textbox', { name: 'Untitled workflow' })).toHaveValue(copyName);
    });
    await test.step('back on the list, the copy is listed, paused, with the same trigger and steps', async () => {
      await workflowsPage.openFromDashboard();
      await workflowsPage.search(copyName);
      await expect(workflowsPage.rowFor(copyName)).toContainText('Manual trigger · Exit');
      await expect(workflowsPage.liveSwitch(copyName, 'Activate')).toBeVisible();
      const stored = (await (await workflowsApi.get(copy.id)).json()).data;
      expect(stored).toMatchObject({
        name: copyName,
        isActive: false,
        triggerStrategy: workflow.triggerStrategy,
      });
      expect(stored.steps.map((step: { nodeType: string }) => step.nodeType)).toEqual([
        'manual_trigger',
        'exit',
      ]);
    });
    await test.step('the original is unchanged', async () => {
      expect((await (await workflowsApi.get(workflow.id)).json()).data.name).toBe(workflow.name);
    });
  });
});
