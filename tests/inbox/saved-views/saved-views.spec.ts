import { test, expect } from '../../../fixtures/test';
import { toCustomViewPayload } from '../../../api/CustomViewsApi';
import { buildSavedView } from '../../../utils/testData';

test.describe('Inbox → Views', { tag: ['@inbox', '@saved-views'] }, () => {
  test(
    'should open the inbox from the sidebar with its Views section',
    { tag: '@smoke' },
    async ({ page, savedViewsPage }) => {
      await test.step('go to the inbox from the sidebar', () => savedViewsPage.openFromDashboard());
      await test.step('the sidebar has a Views section with New view', async () => {
        await expect(page.getByRole('button', { name: 'Views', exact: true })).toBeVisible();
        await expect(savedViewsPage.newViewButton).toBeVisible();
      });
    },
  );

  test('should keep Create view disabled until the view has a name', async ({ savedViewsPage }) => {
    const createButton = savedViewsPage.createDialog.getByRole('button', { name: 'Create view' });

    await test.step('open the New view dialog', async () => {
      await savedViewsPage.open();
      await savedViewsPage.openCreateDialog();
    });
    await test.step('Create view is disabled while the name is empty', async () => {
      await expect(createButton).toBeDisabled();
    });
    await test.step('typing a name enables it', async () => {
      await savedViewsPage.createDialog.getByRole('textbox', { name: 'Name' }).fill('VIP patients');
      await expect(createButton).toBeEnabled();
    });
  });

  test('should save every field when user creates a view', async ({
    page,
    savedViewsPage,
    customViewsApi,
    cleanup,
  }) => {
    const view = buildSavedView();

    await test.step('open the inbox', () => savedViewsPage.open());
    const id = await test.step('add a rule, then a name, icon and who can see it, and create', () =>
      savedViewsPage.createView(view));
    cleanup.add(`saved view ${view.name}`, () => customViewsApi.deleteIfExists(id));

    await test.step('the view is listed in the sidebar with its icon, and opens the inbox filtered by it', async () => {
      await savedViewsPage.sidebarLink(view).click();
      await expect(page).toHaveURL(new RegExp(`[?&]customView=${id}(&|$)`));
    });
    await test.step('after a reload, the edit dialog shows every field', () =>
      savedViewsPage.expectSavedValues(view));
    await test.step('the server stored every field', async () => {
      expect((await (await customViewsApi.get(id)).json()).data).toMatchObject(toCustomViewPayload(view));
    });
  });

  test('should save every change when user edits a view', async ({
    savedViewsPage,
    customViewsApi,
    cleanup,
  }) => {
    const original = buildSavedView();
    const existing = await test.step('create a view to edit (through the API)', () =>
      customViewsApi.createRecord(toCustomViewPayload(original)));
    cleanup.add(`saved view ${original.name}`, () => customViewsApi.deleteIfExists(existing.id));
    const updated = buildSavedView(original);

    await test.step('change its rule, name, icon and sharing, and save', () =>
      savedViewsPage.editView(original, updated));
    await test.step('the sidebar shows the new name and icon instead of the old ones', async () => {
      await expect(savedViewsPage.sidebarLink(updated)).toBeVisible();
      await expect(savedViewsPage.sidebarLink(original)).toHaveCount(0);
    });
    await test.step('after a reload, the edit dialog shows every new value', () =>
      savedViewsPage.expectSavedValues(updated));
    await test.step('the server stored every new value', async () => {
      expect((await (await customViewsApi.get(existing.id)).json()).data).toMatchObject(
        toCustomViewPayload(updated),
      );
    });
  });

  test('should remove the view when user deletes it', async ({ savedViewsPage, customViewsApi, cleanup }) => {
    const view = buildSavedView();
    const existing = await test.step('create a view to delete (through the API)', () =>
      customViewsApi.createRecord(toCustomViewPayload(view)));
    // Safety net only: does nothing if the test deleted it as expected.
    cleanup.add(`saved view ${view.name}`, () => customViewsApi.deleteIfExists(existing.id));

    await test.step('choose Delete in its Manage menu: it goes at once, with a "View deleted" message', () =>
      savedViewsPage.deleteView(view));
    await test.step('it is gone from the sidebar and the server', async () => {
      await expect(savedViewsPage.sidebarLink(view)).toHaveCount(0);
      expect((await customViewsApi.get(existing.id)).status()).toBe(404);
    });
  });

  test('should show the inbox when /inbox is opened without a workspace', async ({ page }) => {
    test.fail(
      true,
      'Known bug (2026-10-31): opening /inbox directly (e.g. from a bookmark) shows "Something went wrong" ' +
        'instead of the inbox; only /inbox/<workspace id>, which the sidebar links to, works. Remove this line once fixed.',
    );
    await test.step('open /inbox', () => page.goto('/inbox'));
    await test.step('the inbox is shown, not an error page', async () => {
      await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();
    });
  });
});
