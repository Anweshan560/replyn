import { test, expect } from '../../../fixtures/test';
import { toWidgetPayload } from '../../../api/WidgetsApi';
import { buildWidget } from '../../../utils/testData';

// UI tests: what a user sees and does. Arrange through the API (fast), act and check in the page.
test.describe('<Area> → Widgets', { tag: ['@area', '@widgets'] }, () => {
  // Tag the one test that proves the page works with @smoke (the quick check on every push).
  test('should open Widgets from the menu with the list', { tag: '@smoke' }, async ({ widgetsPage }) => {
    await test.step('go to <Area> → Widgets', () => widgetsPage.openFromDashboard());
    await test.step('the widgets list is shown', async () => {
      await expect(widgetsPage.table).toBeVisible();
    });
  });

  test('should show a new widget in the list when user creates one', async ({
    widgetsPage,
    widgetsApi,
    cleanup,
  }) => {
    const widget = buildWidget();

    await test.step('go to <Area> → Widgets', () => widgetsPage.openFromDashboard());
    const id = await test.step('fill in and save the new-widget dialog', () =>
      widgetsPage.createRecord(widget));
    // Register cleanup as soon as there is something to clean up.
    cleanup.add(`widget ${id}`, () => widgetsApi.deleteIfExists(id));

    await test.step('the widget is listed', async () => {
      await expect(widgetsPage.rowFor(widget.name)).toBeVisible();
    });
    await test.step('the server stored every field', async () => {
      expect((await (await widgetsApi.get(id)).json()).data).toMatchObject(toWidgetPayload(widget));
    });
  });
});
