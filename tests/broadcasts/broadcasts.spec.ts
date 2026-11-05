import { test, expect } from '../../fixtures/test';
import { BROADCAST_COLUMNS, BROADCAST_STATUS_LABELS } from '../../pages/broadcasts/BroadcastsPage';
import { ENDPOINTS } from '../../api/ResourceApi';
import { mockApiFailure, recordApiCalls, waitForApiResponse } from '../../utils/network';
import { buildSegmentName } from '../../utils/testData';

// Never create or send a broadcast: the test workspace has no WhatsApp channel, and a broadcast
// messages real contacts. The form is only checked up to its validation, with the create call
// blocked in the browser as a safety net.
test.describe('Broadcasts', { tag: ['@broadcasts'] }, () => {
  test(
    'should open Broadcasts from the menu with the list and its total',
    { tag: '@smoke' },
    async ({ page, broadcastsPage }) => {
      const listLoaded = waitForApiResponse(page, 'GET', ENDPOINTS.broadcasts);
      await test.step('go to Broadcasts', () => broadcastsPage.openFromDashboard());
      const { meta } = (await (await listLoaded).json()).data;

      await test.step('the list has its columns', async () => {
        for (const column of BROADCAST_COLUMNS)
          await expect(broadcastsPage.columnHeader(column)).toBeVisible();
      });
      await test.step('the total under the list matches the API', async () => {
        await expect(broadcastsPage.total).toHaveText(
          `${meta.count} broadcast${meta.count === 1 ? '' : 's'}`,
        );
      });
      await test.step('with no broadcasts, it says "No broadcasts yet"', async () => {
        test.skip(meta.count > 0, 'the workspace has broadcasts');
        await expect(page.getByText('No broadcasts yet')).toBeVisible();
        await expect(page.getByText('Broadcasts you send show up here.')).toBeVisible();
      });
    },
  );

  test('should search the list and say when nothing matches', async ({ page, broadcastsPage }) => {
    await broadcastsPage.openFromDashboard();

    await test.step('type a name no broadcast has (the page asks for ?search=)', () =>
      broadcastsPage.search('qa000000'));
    await test.step('"No broadcasts match" and a total of 0', async () => {
      await expect(page.getByText('No broadcasts match')).toBeVisible();
      await expect(broadcastsPage.total).toHaveText('0 broadcasts');
    });
  });

  test('should offer every status in Filters and filter the list by it', async ({ page, broadcastsPage }) => {
    await broadcastsPage.openFromDashboard();

    await test.step('Filters → Status lists all statuses', async () => {
      await broadcastsPage.openStatusFilter();
      for (const label of BROADCAST_STATUS_LABELS) {
        await expect(page.getByRole('option', { name: label, exact: true })).toBeVisible();
      }
    });
    await test.step('pick Failed (the page asks for ?statuses=failed)', () =>
      broadcastsPage.pickStatus('Failed'));
    await test.step('Reset becomes available', async () => {
      await expect(broadcastsPage.filtersDialog.getByRole('button', { name: 'Reset' })).toBeEnabled();
    });
  });

  test("should show the New broadcast form with this workspace's segments", async ({
    page,
    broadcastsPage,
    newBroadcastForm,
    segmentsApi,
    cleanup,
  }) => {
    const segment = await segmentsApi.createRecord({ name: buildSegmentName() });
    cleanup.add(`segment "${segment.name}"`, () => segmentsApi.deleteIfExists(segment.id));

    await broadcastsPage.openFromDashboard();

    await test.step('New broadcast opens /broadcasts/create', async () => {
      await broadcastsPage.newButton.click();
      await expect(page).toHaveURL('/broadcasts/create');
      await expect(newBroadcastForm.heading).toBeVisible();
    });
    await test.step('the sections and required fields are there', async () => {
      for (const section of ['Configuration', 'Message', 'When to send']) {
        await expect(page.getByRole('heading', { name: section })).toBeVisible();
      }
      await expect(newBroadcastForm.nameBox).toBeVisible();
      await expect(page.getByRole('button', { name: /^Schedule for later/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Send immediately/ })).toBeVisible();
    });
    await test.step('a template can only be picked once a channel is chosen', async () => {
      await expect(newBroadcastForm.templatePicker).toBeDisabled();
      await expect(page.getByText('Select a channel first to see templates')).toBeVisible();
    });
    await test.step("the Segment list offers the workspace's segment", async () => {
      expect(await newBroadcastForm.segmentOptions()).toContain(segment.name);
    });
  });

  test('should not send anything when the empty form is submitted', async ({
    page,
    broadcastsPage,
    newBroadcastForm,
  }) => {
    // Safety net: even if validation let it through, the request never reaches the server.
    await mockApiFailure(page, 'POST', ENDPOINTS.broadcasts, 500, 'Blocked by the test');
    const creates = recordApiCalls(page, 'POST', ENDPOINTS.broadcasts);
    await broadcastsPage.openFromDashboard();
    await broadcastsPage.newButton.click();
    await expect(newBroadcastForm.heading).toBeVisible();

    await test.step('press Create Broadcast with nothing filled in', () =>
      newBroadcastForm.createButton.click());
    await test.step('the form stays open, marks the required fields, and sends nothing', async () => {
      await expect(page).toHaveURL('/broadcasts/create');
      await expect(newBroadcastForm.nameBox).toHaveAttribute('aria-invalid', 'true');
      expect(creates).toEqual([]);
    });
  });

  test('should go back to the list when the form is cancelled', async ({
    page,
    broadcastsPage,
    newBroadcastForm,
  }) => {
    const creates = recordApiCalls(page, 'POST', ENDPOINTS.broadcasts);
    await broadcastsPage.openFromDashboard();
    await broadcastsPage.newButton.click();
    await newBroadcastForm.nameBox.fill('Cancelled broadcast qa000000');

    await test.step('Cancel returns to /broadcasts without creating anything', async () => {
      await newBroadcastForm.cancelButton.click();
      await expect(page).toHaveURL('/broadcasts');
      expect(creates).toEqual([]);
    });
  });
});
